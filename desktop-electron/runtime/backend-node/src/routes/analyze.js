import express from 'express';
import { Parser } from 'json2csv';
import { fetchTechnicalAnalysis } from '../services/pythonClient.js';
import { fetchNewsForTicker } from '../services/newsService.js';
import { generateAiInsight } from '../services/aiService.js';
import { fetchLiveQuote } from '../services/liveMarketService.js';
import { analysisCache, makeCacheKey } from '../services/cache.js';
import { mapTimeframeToPeriod, validateTimeframe } from '../utils/timeframe.js';
import {
  buildRecommendation,
  buildTradePlan,
  isValidStrategyPreset,
  normalizeStrategyPreset
} from '../utils/recommendation.js';
import { normalizeIdxTicker, normalizeIdxTickers } from '../utils/ticker.js';

const router = express.Router();

function buildIndicatorStatus({ technical, latestPrice }) {
  const rsi = Number(technical?.indicators?.rsi);
  const ma20 = Number(technical?.indicators?.ma20);
  const ma50 = Number(technical?.indicators?.ma50);
  const macdSignal = technical?.signals?.macdSignal;

  const rsiStatus = rsi < 30 ? 'BULLISH' : rsi > 70 ? 'BEARISH' : 'NEUTRAL';
  const ma20Status = Number.isFinite(latestPrice) && Number.isFinite(ma20)
    ? (latestPrice >= ma20 ? 'BULLISH' : 'BEARISH')
    : 'NEUTRAL';
  const ma50Status = Number.isFinite(latestPrice) && Number.isFinite(ma50)
    ? (latestPrice >= ma50 ? 'BULLISH' : 'BEARISH')
    : 'NEUTRAL';
  const macdStatus = macdSignal === 'bullish' ? 'BULLISH' : macdSignal === 'bearish' ? 'BEARISH' : 'NEUTRAL';

  return {
    rsi: rsiStatus,
    macd: macdStatus,
    ma20: ma20Status,
    ma50: ma50Status
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
    + toScore(recommendation)
    + toScore(sentiment);

  return score >= 1 ? 'GOOD' : 'BAD';
}

async function analyzeOneTicker(ticker, timeframe, strategyPreset) {
  const period = mapTimeframeToPeriod(timeframe);
  const cleanTicker = normalizeIdxTicker(ticker);
  const displayTicker = cleanTicker.replace(/\.JK$/i, '');

  const technical = await fetchTechnicalAnalysis(cleanTicker, period);
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
    news
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
    aiInsight: ai.insight,
    sentiment: ai.sentiment,
    recommendation,
    indicatorStatus,
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
