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

async function analyzeOneTicker(ticker, timeframe, strategyPreset) {
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
    priceChangePct: displayChangePct || 0
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
      outlook: ai.outlook
    },
    sentiment: ai.sentiment,
    recommendation,
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
      return res.status(400).json({ error: 'strategy must be one of: scalp, balanced, swing' });
    }

    const strategyPreset = normalizeStrategyPreset(strategy);

    const normalizedTickers = normalizeIdxTickers(tickers);

    const cacheKey = makeCacheKey({ tickers: normalizedTickers, timeframe, strategy: strategyPreset });
    const cached = analysisCache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const results = [];
    for (const ticker of normalizedTickers) {
      try {
        const item = await analyzeOneTicker(ticker, timeframe, strategyPreset);
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
