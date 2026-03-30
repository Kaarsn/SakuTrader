import express from 'express';
import { Parser } from 'json2csv';
import { fetchTechnicalAnalysis } from '../services/pythonClient.js';
import { fetchNewsForTicker } from '../services/newsService.js';
import { generateAiInsight } from '../services/aiService.js';
import { fetchLiveQuote, isIdxMarketOpen } from '../services/liveMarketService.js';
import { analysisCache, makeCacheKey } from '../services/cache.js';
import { mapTimeframeToPeriod, validateTimeframe } from '../utils/timeframe.js';
import { IDX_MARKET_UNIVERSE } from '../data/idxMarketUniverse.js';
import {
  buildRecommendation,
  buildTradePlan,
  isValidStrategyPreset,
  normalizeStrategyPreset
} from '../utils/recommendation.js';
import { normalizeIdxTicker, normalizeIdxTickers } from '../utils/ticker.js';

const router = express.Router();

const MULTI_WINDOW_PERIODS = [
  { key: '6m', label: '6 months', period: '6mo' },
  { key: '3m', label: '3 months', period: '3mo' },
  { key: '1m', label: '1 month', period: '1mo' },
  { key: '7d', label: '7 days', period: '7d' }
];

async function runInBatches(items, batchSize, runner) {
  const output = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    // Keep outbound requests under control to avoid Yahoo throttling.
    const results = await Promise.allSettled(batch.map((item) => runner(item)));
    output.push(...results);
  }
  return output;
}

async function buildMarketRankSnapshot({ limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 10), 100);
  const universe = IDX_MARKET_UNIVERSE.slice(0, safeLimit).map((ticker) => normalizeIdxTicker(ticker));

  const settled = await runInBatches(universe, 12, async (ticker) => {
    const live = await fetchLiveQuote(ticker);
    if (!live || typeof live.price !== 'number' || typeof live.changePct !== 'number') {
      return null;
    }
    return {
      ticker: ticker.replace(/\.JK$/i, ''),
      price: live.price,
      changePct: live.changePct,
      previousClose: live.previousClose,
      asOf: live.asOf
    };
  });

  const rows = settled
    .filter((item) => item.status === 'fulfilled' && item.value)
    .map((item) => item.value);

  const gainers = [...rows]
    .filter((row) => row.changePct >= 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 100)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  const losers = [...rows]
    .filter((row) => row.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, 100)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  return {
    generatedAt: new Date().toISOString(),
    marketOpen: isIdxMarketOpen(),
    universeSize: universe.length,
    sampled: rows.length,
    gainers,
    losers
  };
}

function buildIndicatorStatus({ technical, latestPrice }) {
  const rsi = Number(technical?.indicators?.rsi);
  const ma20 = Number(technical?.indicators?.ma20);
  const ma50 = Number(technical?.indicators?.ma50);
  const macdSignal = technical?.signals?.macdSignal;
  const crossSignal = technical?.signals?.crossSignal;
  const crossTrend = technical?.signals?.crossTrend;

  const rsiStatus = rsi < 30 ? 'BULLISH' : rsi > 70 ? 'BEARISH' : 'NEUTRAL';
  const ma20Status = Number.isFinite(latestPrice) && Number.isFinite(ma20)
    ? (latestPrice >= ma20 ? 'BULLISH' : 'BEARISH')
    : 'NEUTRAL';
  const ma50Status = Number.isFinite(latestPrice) && Number.isFinite(ma50)
    ? (latestPrice >= ma50 ? 'BULLISH' : 'BEARISH')
    : 'NEUTRAL';
  const macdStatus = macdSignal === 'bullish' ? 'BULLISH' : macdSignal === 'bearish' ? 'BEARISH' : 'NEUTRAL';
  const crossStatus = crossSignal === 'golden_cross'
    ? 'BULLISH'
    : crossSignal === 'death_cross'
      ? 'BEARISH'
      : crossTrend === 'bullish'
        ? 'BULLISH'
        : crossTrend === 'bearish'
          ? 'BEARISH'
          : 'NEUTRAL';

  return {
    rsi: rsiStatus,
    macd: macdStatus,
    ma20: ma20Status,
    ma50: ma50Status,
    cross: crossStatus
  };
}

function buildTradeConclusion({ indicatorStatus, recommendation, sentiment }) {
  const toScore = (value) => {
    if (value === 'BULLISH' || value === 'BUY' || value === 'Positive') return 1;
    if (value === 'BEARISH' || value === 'SELL' || value === 'Negative') return -1;
    return 0;
  };

  const score =
    toScore(indicatorStatus.rsi)
    + toScore(indicatorStatus.macd)
    + toScore(indicatorStatus.ma20)
    + toScore(indicatorStatus.ma50)
    + toScore(indicatorStatus.cross)
    + toScore(recommendation)
    + toScore(sentiment);

  return score >= 1 ? 'GOOD' : 'BAD';
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeVolatilityPct(candles = []) {
  const recent = candles.slice(-12);
  if (recent.length < 2) return 1.8;

  let total = 0;
  let count = 0;
  for (let i = 1; i < recent.length; i += 1) {
    const prev = Number(recent[i - 1]?.close);
    const curr = Number(recent[i]?.close);
    if (Number.isFinite(prev) && Number.isFinite(curr) && prev !== 0) {
      total += Math.abs((curr - prev) / prev) * 100;
      count += 1;
    }
  }

  if (!count) return 1.8;
  return total / count;
}

function buildDecisionIntelligence({ technical, latestPrice, recommendation, sentiment, tradePlan }) {
  const indicators = technical?.indicators || {};
  const signals = technical?.signals || {};
  const candles = technical?.candles || [];

  const rsi = Number(indicators.rsi);
  const ma20 = Number(indicators.ma20);
  const ma50 = Number(indicators.ma50);
  const volumeRatio = Number(signals.volumeRatio);
  const macdSignal = signals.macdSignal;
  const trendSignal = signals.trendSignal;
  const normalizedSentiment = String(sentiment || 'Neutral').toLowerCase();

  const recentCandles = candles.slice(-20);
  const support = recentCandles.length
    ? Math.min(...recentCandles.map((c) => Number(c?.low)).filter((v) => Number.isFinite(v)))
    : Number(latestPrice);
  const resistance = recentCandles.length
    ? Math.max(...recentCandles.map((c) => Number(c?.high)).filter((v) => Number.isFinite(v)))
    : Number(latestPrice);

  const nearSupport = Number.isFinite(support) && support > 0
    ? Math.abs(((Number(latestPrice) - support) / support) * 100) <= 1.8
    : false;
  const nearResistance = Number.isFinite(resistance) && resistance > 0
    ? Math.abs(((resistance - Number(latestPrice)) / resistance) * 100) <= 1.8
    : false;

  const rsiStrength = !Number.isFinite(rsi)
    ? 50
    : (rsi <= 30 || rsi >= 70)
      ? 85
      : (rsi <= 40 || rsi >= 60)
        ? 70
        : 55;
  const macdStrength = macdSignal === 'bullish' || macdSignal === 'bearish' ? 78 : 52;
  const maAlignmentStrength = Number.isFinite(ma20) && Number.isFinite(ma50)
    ? (ma20 > ma50 ? 78 : ma20 < ma50 ? 72 : 55)
    : 55;
  const volumeStrength = Number.isFinite(volumeRatio)
    ? clampNumber(50 + (volumeRatio - 1) * 60, 35, 95)
    : (signals.volumeStrong === 'yes' ? 75 : 55);

  const confidenceScore = Math.round(clampNumber(
    (rsiStrength * 0.25) + (macdStrength * 0.25) + (maAlignmentStrength * 0.3) + (volumeStrength * 0.2),
    40,
    97
  ));

  let riskRaw = 50;
  const volatilityPct = computeVolatilityPct(candles);
  riskRaw += volatilityPct * 8;
  if (rsi >= 72 || rsi <= 28) riskRaw += 8;
  if (signals.bbSqueeze === 'squeeze') riskRaw += 6;
  if (Number.isFinite(volumeRatio) && volumeRatio < 0.9) riskRaw += 6;
  if (tradePlan?.cutLoss && latestPrice && tradePlan.cutLoss > latestPrice * 0.98) riskRaw += 4;
  const riskScore = Math.round(clampNumber(riskRaw, 20, 95));
  const riskLevel = riskScore < 40 ? 'Low' : riskScore < 68 ? 'Medium' : 'High';

  let bullishProbability = 50;
  if (recommendation === 'BUY') bullishProbability += 14;
  if (recommendation === 'SELL') bullishProbability -= 14;
  if (trendSignal === 'uptrend') bullishProbability += 10;
  if (trendSignal === 'downtrend') bullishProbability -= 10;
  if (macdSignal === 'bullish') bullishProbability += 10;
  if (macdSignal === 'bearish') bullishProbability -= 10;
  if (Number.isFinite(ma20) && Number.isFinite(ma50) && ma20 > ma50) bullishProbability += 8;
  if (Number.isFinite(ma20) && Number.isFinite(ma50) && ma20 < ma50) bullishProbability -= 8;
  if (Number.isFinite(rsi) && rsi < 30 && nearSupport) bullishProbability += 8;
  if (Number.isFinite(rsi) && rsi > 70 && nearResistance) bullishProbability -= 8;
  if (normalizedSentiment.includes('positive')) bullishProbability += 5;
  if (normalizedSentiment.includes('negative')) bullishProbability -= 5;
  bullishProbability = Math.round(clampNumber(bullishProbability, 5, 95));
  const bearishProbability = 100 - bullishProbability;

  let quickCall = 'WAIT';
  if (bullishProbability >= 76 && riskLevel !== 'High') quickCall = 'STRONG BUY';
  else if (bullishProbability >= 60) quickCall = 'BUY';
  else if (bearishProbability >= 76 && riskLevel !== 'Low') quickCall = 'AVOID';
  else if (bearishProbability >= 60) quickCall = 'SELL';

  const quickReasons = {
    'STRONG BUY': 'Momentum bullish terkonfirmasi volume, peluang lanjut naik lebih dominan.',
    BUY: 'Struktur teknikal mendukung entry bertahap dengan risiko terukur.',
    WAIT: 'Sinyal campuran, tunggu breakout atau retest level kunci dulu.',
    SELL: 'Tekanan bearish dominan, peluang turun masih lebih besar.',
    AVOID: 'Risiko tinggi dan arah lemah, sebaiknya hindari entry dulu.'
  };

  const entryDisplay = tradePlan?.entryZone
    ? `${Math.round(tradePlan.entryZone.low)}-${Math.round(tradePlan.entryZone.high)}`
    : 'market';

  const scenarios = [
    `Jika harga tembus ${Math.round(resistance)} dengan volume kuat, bias lanjut bullish.` ,
    `Jika harga gagal bertahan di ${Math.round(support)}, bias lanjut bearish.` ,
    `Jika sideway di antara level kunci, fokus buy di ${entryDisplay} dengan risiko ketat.`
  ];

  const edgeSmartMoney = Math.round(clampNumber((bullishProbability * 0.55) + (volumeStrength * 0.45), 0, 100));
  const fakeBreakoutRisk = Math.round(clampNumber(
    (nearResistance ? 25 : 10) + (rsi > 68 ? 20 : 8) + (Number.isFinite(volumeRatio) && volumeRatio < 1 ? 25 : 10),
    0,
    100
  ));

  const oneLineInsight = quickCall === 'SELL' || quickCall === 'AVOID'
    ? 'Tren melemah, utamakan proteksi modal dan hindari entry agresif.'
    : quickCall === 'WAIT'
      ? 'Saham netral, tunggu konfirmasi breakout sebelum ambil posisi baru.'
      : 'Saham berpeluang lanjut naik, cocok untuk entry bertahap terukur.';

  return {
    quickCall,
    quickReason: quickReasons[quickCall],
    confidenceScore,
    riskLevel,
    bullishProbability,
    bearishProbability,
    scenarios,
    oneLineInsight,
    edgeIndicators: {
      smartMoneyFlowScore: edgeSmartMoney,
      fakeBreakoutRisk,
      volumeSpikeAlert: signals.volumeStrong === 'yes' || (Number.isFinite(volumeRatio) && volumeRatio >= 1.4)
    }
  };
}

function buildTechnicalConclusion(indicatorStatus) {
  const toScore = (value) => {
    if (value === 'BULLISH') return 1;
    if (value === 'BEARISH') return -1;
    return 0;
  };

  const score =
    toScore(indicatorStatus.rsi)
    + toScore(indicatorStatus.macd)
    + toScore(indicatorStatus.ma20)
    + toScore(indicatorStatus.ma50)
    + toScore(indicatorStatus.cross);

  if (score > 0) return 'BULLISH';
  if (score < 0) return 'BEARISH';
  return 'NEUTRAL';
}

function buildWindowAiInsight({ technical, indicatorStatus, conclusion }) {
  const candles = technical?.candles || [];
  const latest = candles[candles.length - 1];
  const lookback = Math.min(5, candles.length - 1);
  const past = lookback > 0 ? candles[candles.length - 1 - lookback] : undefined;

  const latestClose = Number(latest?.close);
  const pastClose = Number(past?.close);
  const momentumPct = Number.isFinite(latestClose) && Number.isFinite(pastClose) && pastClose !== 0
    ? ((latestClose - pastClose) / pastClose) * 100
    : 0;

  const latestSlice = candles.slice(-5);
  const previousSlice = candles.slice(-10, -5);
  const avg = (arr) => {
    if (!arr.length) return 0;
    return arr.reduce((sum, item) => sum + Number(item.volume || 0), 0) / arr.length;
  };
  const latestAvgVol = avg(latestSlice);
  const previousAvgVol = avg(previousSlice);
  const volumeRatio = previousAvgVol > 0 ? latestAvgVol / previousAvgVol : 1;

  const bullishCount = [indicatorStatus.rsi, indicatorStatus.macd, indicatorStatus.ma20, indicatorStatus.ma50, indicatorStatus.cross]
    .filter((value) => value === 'BULLISH').length;
  const bearishCount = [indicatorStatus.rsi, indicatorStatus.macd, indicatorStatus.ma20, indicatorStatus.ma50, indicatorStatus.cross]
    .filter((value) => value === 'BEARISH').length;

  const crossSignal = technical?.signals?.crossSignal;
  const crossTrend = technical?.signals?.crossTrend;
  const crossLabel = crossSignal === 'golden_cross'
    ? 'golden cross (bullish)'
    : crossSignal === 'death_cross'
      ? 'death cross (bearish)'
      : crossTrend === 'bullish'
        ? 'belum ada cross baru, tapi MA20 masih di atas MA50 (bullish structure)'
        : crossTrend === 'bearish'
          ? 'belum ada cross baru, tapi MA20 masih di bawah MA50 (bearish structure)'
          : 'belum ada cross baru';

  const buyingPressure = volumeRatio >= 1.15 ? 'HIGH' : volumeRatio >= 0.95 ? 'NORMAL' : 'LOW';
  const marketResponse = momentumPct >= 0.8 ? 'POSITIVE' : momentumPct <= -0.8 ? 'NEGATIVE' : 'MIXED';

  let verdict = 'HOLD';
  if (conclusion === 'BULLISH' && bullishCount >= 3 && marketResponse !== 'NEGATIVE') {
    verdict = buyingPressure === 'HIGH' ? 'BUY' : 'HOLD';
  } else if (conclusion === 'BEARISH' && bearishCount >= 3 && marketResponse === 'NEGATIVE') {
    verdict = 'SELL';
  }

  const verdictLabel = verdict === 'BUY' ? 'BELI' : verdict === 'SELL' ? 'JUAL' : 'TAHAN';
  const pressureLabel = buyingPressure === 'HIGH' ? 'tinggi' : buyingPressure === 'LOW' ? 'rendah' : 'normal';
  const responseLabel = marketResponse === 'POSITIVE'
    ? 'positif'
    : marketResponse === 'NEGATIVE'
      ? 'negatif'
      : 'campuran';

  const reasons = [
    `Komposisi indikator: ${bullishCount} bullish vs ${bearishCount} bearish`,
    `Sinyal MA cross: ${crossLabel}`,
    `Momentum ${lookback} candle terakhir: ${momentumPct.toFixed(2)}% (respon pasar ${responseLabel})`,
    `Tekanan beli: ${pressureLabel} (rasio volume ${volumeRatio.toFixed(2)}x)`
  ];

  return {
    verdict,
    buyingPressure,
    marketResponse,
    summary: `Rekomendasi periode ini: ${verdictLabel}. ${reasons.join('. ')}.`,
    reasons
  };
}

async function analyzeOneTicker(ticker, timeframe, strategyPreset, marketContext = {}) {
  const period = mapTimeframeToPeriod(timeframe);
  const cleanTicker = normalizeIdxTicker(ticker);
  const displayTicker = cleanTicker.replace(/\.JK$/i, '');

  const technical = await fetchTechnicalAnalysis(cleanTicker, period);
  const technicalCache = new Map([[period, technical]]);
  const getTechnicalByPeriod = async (windowPeriod) => {
    if (technicalCache.has(windowPeriod)) {
      return technicalCache.get(windowPeriod);
    }
    const result = await fetchTechnicalAnalysis(cleanTicker, windowPeriod);
    technicalCache.set(windowPeriod, result);
    return result;
  };

  const windowEntries = await Promise.all(
    MULTI_WINDOW_PERIODS.map(async ({ key, label, period: windowPeriod }) => {
      try {
        const windowTechnical = await getTechnicalByPeriod(windowPeriod);
        const windowCandles = windowTechnical?.candles || [];
        const windowLatest = windowCandles[windowCandles.length - 1];
        const windowLatestPrice = typeof windowLatest?.close === 'number' ? windowLatest.close : undefined;
        const windowIndicatorStatus = buildIndicatorStatus({ technical: windowTechnical, latestPrice: windowLatestPrice });
        const windowConclusion = buildTechnicalConclusion(windowIndicatorStatus);

        return [
          key,
          {
            label,
            period: windowPeriod,
            indicators: windowTechnical?.indicators,
            signals: windowTechnical?.signals,
            indicatorStatus: windowIndicatorStatus,
            conclusion: windowConclusion,
            aiInsight: buildWindowAiInsight({
              technical: windowTechnical,
              indicatorStatus: windowIndicatorStatus,
              conclusion: windowConclusion
            })
          }
        ];
      } catch (error) {
        return [
          key,
          {
            label,
            period: windowPeriod,
            error: `Failed to analyze ${label.toLowerCase()}: ${error.message}`
          }
        ];
      }
    })
  );
  const multiTimeframeTechnical = Object.fromEntries(windowEntries);

  const candles = technical?.candles || [];
  const latestCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];
  const latestPrice = typeof latestCandle?.close === 'number' ? latestCandle.close : undefined;
  const priceChangePct =
    typeof latestCandle?.close === 'number' && typeof previousCandle?.close === 'number' && previousCandle.close !== 0
      ? ((latestCandle.close - previousCandle.close) / previousCandle.close) * 100
      : undefined;
  const live = await fetchLiveQuote(cleanTicker).catch(() => null);

  const displayPrice = typeof live?.price === 'number' ? live.price : latestPrice;
  const displayChangePct = typeof live?.changePct === 'number' ? live.changePct : priceChangePct;
  const news = await fetchNewsForTicker(cleanTicker);
  const ai = await generateAiInsight({
    ticker: displayTicker,
    technical,
    news,
    priceChangePct: displayChangePct || 0,
    ihsgChangePct: marketContext?.ihsgChangePct
  });

  const recommendation = buildRecommendation({
    analysis: technical,
    sentiment: ai.sentiment
  });
  const indicatorStatus = buildIndicatorStatus({ technical, latestPrice });
  const tradeConclusion = buildTradeConclusion({
    indicatorStatus,
    recommendation,
    sentiment: ai.sentiment
  });
  const tradePlan = buildTradePlan({
    latestPrice: displayPrice,
    recommendation,
    analysis: technical,
    strategyPreset
  });
  const decisionIntelligence = buildDecisionIntelligence({
    technical,
    latestPrice: displayPrice,
    recommendation,
    sentiment: ai.sentiment,
    tradePlan
  });

  return {
    ticker: displayTicker,
    timeframe,
    latestPrice: displayPrice,
    priceChangePct: displayChangePct,
    currency: 'IDR',
    technical,
    live,
    news,
    aiInsight: {
      insight: ai.insight,
      causes: ai.causes,
      topNews: ai.topNews,
      outlook: ai.outlook,
      mediumOutlook: ai.mediumOutlook
    },
    sentiment: ai.sentiment,
    recommendation,
    decisionIntelligence,
    indicatorStatus,
    multiTimeframeTechnical,
    tradeConclusion,
    tradePlan
  };
}

router.post('/', async (req, res, next) => {
  try {
    const { tickers, timeframe, strategy = 'balanced' } = req.body;

    if (!Array.isArray(tickers) || tickers.length === 0) {
      return res.status(400).json({ error: 'tickers must be a non-empty array' });
    }

    if (!validateTimeframe(timeframe)) {
      return res.status(400).json({ error: 'timeframe must be one of: 7d, 1m, 3m, 6m' });
    }

    if (!isValidStrategyPreset(strategy)) {
      return res.status(400).json({ error: 'strategy must be one of: scalp, balanced, swing, breakout' });
    }

    const strategyPreset = normalizeStrategyPreset(strategy);

    const normalizedTickers = normalizeIdxTickers(tickers);

    const cacheKey = makeCacheKey({ tickers: normalizedTickers, timeframe, strategy: strategyPreset });
    const cached = analysisCache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const ihsgLive = await fetchLiveQuote('^JKSE').catch(() => null);
    const marketContext = {
      ihsgChangePct: typeof ihsgLive?.changePct === 'number' ? ihsgLive.changePct : undefined
    };

    const results = [];
    for (const ticker of normalizedTickers) {
      try {
        const item = await analyzeOneTicker(ticker, timeframe, strategyPreset, marketContext);
        results.push(item);
      } catch (error) {
        const displayTicker = ticker.replace(/\.JK$/i, '');
        results.push({
          ticker: displayTicker,
          error: `Failed to analyze ${displayTicker}: ${error.message}`
        });
      }
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      timeframe,
      strategy: strategyPreset,
      results
    };

    if (results.every((item) => !item.error)) {
      analysisCache.set(cacheKey, payload);
    }
    return res.json({ ...payload, cached: false });
  } catch (error) {
    return next(error);
  }
});

router.get('/market-rank', async (req, res, next) => {
  try {
    const { limit = '100' } = req.query;
    const snapshot = await buildMarketRankSnapshot({ limit: Number(limit) });
    return res.json(snapshot);
  } catch (error) {
    return next(error);
  }
});

router.post('/export', async (req, res, next) => {
  try {
    const { format = 'json', data } = req.body;
    if (!data || !Array.isArray(data.results)) {
      return res.status(400).json({ error: 'data.results is required' });
    }

    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename="analysis.json"');
      return res.json(data);
    }

    if (format === 'csv') {
      const rows = data.results.map((item) => ({
        ticker: item.ticker,
        latestPrice: item.latestPrice,
        priceChangePct: item.priceChangePct,
        rsi: item.technical?.indicators?.rsi,
        macd: item.technical?.indicators?.macd,
        ma20: item.technical?.indicators?.ma20,
        ma50: item.technical?.indicators?.ma50,
        sentiment: item.sentiment,
        recommendation: item.recommendation,
        rsiStatus: item.indicatorStatus?.rsi,
        macdStatus: item.indicatorStatus?.macd,
        ma20Status: item.indicatorStatus?.ma20,
        ma50Status: item.indicatorStatus?.ma50,
        crossStatus: item.indicatorStatus?.cross,
        crossSignal: item.technical?.signals?.crossSignal,
        conclusion6m: item.multiTimeframeTechnical?.['6m']?.conclusion,
        conclusion3m: item.multiTimeframeTechnical?.['3m']?.conclusion,
        conclusion1m: item.multiTimeframeTechnical?.['1m']?.conclusion,
        conclusion7d: item.multiTimeframeTechnical?.['7d']?.conclusion,
        tradeConclusion: item.tradeConclusion,
        entryLow: item.tradePlan?.entryZone?.low,
        entryHigh: item.tradePlan?.entryZone?.high,
        cutLoss: item.tradePlan?.cutLoss,
        takeProfit1: item.tradePlan?.takeProfit1,
        takeProfit2: item.tradePlan?.takeProfit2,
        riskReward: item.tradePlan?.riskReward
      }));

      const parser = new Parser();
      const csv = parser.parse(rows);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="analysis.csv"');
      return res.send(csv);
    }

    return res.status(400).json({ error: 'format must be json or csv' });
  } catch (error) {
    return next(error);
  }
});

export default router;
