function scoreFromIndicators(analysis) {
  let score = 0;

  if (analysis.signals?.rsiSignal === 'oversold') score += 1;
  if (analysis.signals?.rsiSignal === 'overbought') score -= 1;

  if (analysis.signals?.trendSignal === 'uptrend') score += 1;
  if (analysis.signals?.trendSignal === 'downtrend') score -= 1;

  if (analysis.signals?.macdSignal === 'bullish') score += 1;
  if (analysis.signals?.macdSignal === 'bearish') score -= 1;

  return score;
}

function getSupportResistance(candles = []) {
  const recent = candles.slice(-20);
  if (!recent.length) return { support: null, resistance: null };

  const lows = recent.map((c) => Number(c?.low)).filter((v) => Number.isFinite(v));
  const highs = recent.map((c) => Number(c?.high)).filter((v) => Number.isFinite(v));

  return {
    support: lows.length ? Math.min(...lows) : null,
    resistance: highs.length ? Math.max(...highs) : null
  };
}

function isNearLevel(price, level, thresholdPct = 1.5) {
  if (!Number.isFinite(price) || !Number.isFinite(level) || level <= 0) return false;
  const distancePct = Math.abs(((price - level) / level) * 100);
  return distancePct <= thresholdPct;
}

function scoreFromSentiment(sentiment) {
  const normalized = (sentiment || 'neutral').toLowerCase();
  if (normalized === 'positive') return 1;
  if (normalized === 'negative') return -1;
  return 0;
}

export function buildRecommendation({ analysis, sentiment }) {
  const latest = analysis?.candles?.[analysis.candles.length - 1];
  const latestClose = Number(latest?.close);
  const rsi = Number(analysis?.indicators?.rsi);
  const ma20 = Number(analysis?.indicators?.ma20);
  const ma50 = Number(analysis?.indicators?.ma50);
  const macdSignal = analysis?.signals?.macdSignal;
  const trendSignal = analysis?.signals?.trendSignal;
  const { support, resistance } = getSupportResistance(analysis?.candles || []);

  if (rsi < 30 && isNearLevel(latestClose, support, 1.8)) return 'BUY';
  if (rsi > 70 && isNearLevel(latestClose, resistance, 1.8)) return 'SELL';

  if (Number.isFinite(ma20) && Number.isFinite(ma50) && ma20 > ma50 && macdSignal === 'bullish') return 'BUY';
  if (Number.isFinite(ma20) && Number.isFinite(ma50) && ma20 < ma50 && macdSignal === 'bearish') return 'SELL';

  const totalScore = scoreFromIndicators(analysis) + scoreFromSentiment(sentiment);

  if (totalScore >= 1) return 'BUY';
  if (totalScore <= -1) return 'SELL';

  // Keep HOLD only for truly mixed/neutral cases.
  if (trendSignal === 'uptrend' && scoreFromSentiment(sentiment) >= 0) return 'BUY';
  if (trendSignal === 'downtrend' && scoreFromSentiment(sentiment) <= 0) return 'SELL';

  return 'HOLD';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundIdr(value) {
  return Math.round(value);
}

function getIdxTickSize(price) {
  if (!Number.isFinite(price) || price <= 0) return 1;
  if (price < 200) return 1;
  if (price < 500) return 2;
  if (price < 2000) return 5;
  if (price < 5000) return 10;
  return 25;
}

function alignToTick(value, tickSize, mode = 'round') {
  if (!Number.isFinite(value)) return null;
  const tick = Math.max(1, Number(tickSize) || 1);

  if (mode === 'floor') {
    return Math.floor(value / tick) * tick;
  }
  if (mode === 'ceil') {
    return Math.ceil(value / tick) * tick;
  }
  return Math.round(value / tick) * tick;
}

const STRATEGY_PRESETS = {
  scalp: {
    entryBandPct: 0.0015,
    stopLossMultiplier: 0.7,
    takeProfitMultiplier: 0.9,
    stopLossMin: 0.8,
    stopLossMax: 2.2,
    takeProfitMin: 1.1,
    takeProfitMax: 2.8,
    tp2AddonPct: 0.6
  },
  balanced: {
    entryBandPct: 0.003,
    stopLossMultiplier: 0.9,
    takeProfitMultiplier: 1.2,
    stopLossMin: 1.2,
    stopLossMax: 3.0,
    takeProfitMin: 1.8,
    takeProfitMax: 4.0,
    tp2AddonPct: 1.0
  },
  swing: {
    entryBandPct: 0.0045,
    stopLossMultiplier: 1.15,
    takeProfitMultiplier: 1.7,
    stopLossMin: 1.8,
    stopLossMax: 4.5,
    takeProfitMin: 2.8,
    takeProfitMax: 7.0,
    tp2AddonPct: 1.7
  },
  breakout: {
    entryBandPct: 0.002,
    stopLossMultiplier: 1.05,
    takeProfitMultiplier: 2.0,
    stopLossMin: 1.4,
    stopLossMax: 3.8,
    takeProfitMin: 3.0,
    takeProfitMax: 8.5,
    tp2AddonPct: 2.0
  }
};

export function normalizeStrategyPreset(input) {
  const normalized = (input || 'balanced').toLowerCase();
  return STRATEGY_PRESETS[normalized] ? normalized : 'balanced';
}

export function isValidStrategyPreset(input) {
  return Boolean(STRATEGY_PRESETS[(input || '').toLowerCase()]);
}

function estimateVolatilityPct(candles = []) {
  if (!candles.length) return 2.0;

  const recent = candles.slice(-7);
  let sum = 0;
  let count = 0;

  for (let i = 1; i < recent.length; i += 1) {
    const prev = recent[i - 1]?.close;
    const curr = recent[i]?.close;
    if (typeof prev === 'number' && typeof curr === 'number' && prev !== 0) {
      sum += Math.abs((curr - prev) / prev) * 100;
      count += 1;
    }
  }

  if (!count) return 2.0;
  return sum / count;
}

export function buildTradePlan({ latestPrice, recommendation, analysis, strategyPreset = 'balanced' }) {
  if (typeof latestPrice !== 'number' || Number.isNaN(latestPrice) || latestPrice <= 0) {
    return null;
  }

  const profileName = normalizeStrategyPreset(strategyPreset);
  const profile = STRATEGY_PRESETS[profileName];
  const volatilityPct = estimateVolatilityPct(analysis?.candles || []);
  const stopLossPct = clamp(
    volatilityPct * profile.stopLossMultiplier,
    profile.stopLossMin,
    profile.stopLossMax
  );
  const takeProfitPct = clamp(
    volatilityPct * profile.takeProfitMultiplier,
    profile.takeProfitMin,
    profile.takeProfitMax
  );
  const tickSize = getIdxTickSize(latestPrice);

  let entryLow = alignToTick(latestPrice * (1 - profile.entryBandPct), tickSize, 'floor');
  let entryHigh = alignToTick(latestPrice * (1 + profile.entryBandPct), tickSize, 'ceil');
  if (entryHigh <= entryLow) {
    entryHigh = entryLow + tickSize;
  }

  const cutLoss = alignToTick(latestPrice * (1 - stopLossPct / 100), tickSize, 'floor');
  const takeProfit1 = alignToTick(latestPrice * (1 + takeProfitPct / 100), tickSize, 'ceil');
  const takeProfit2 = alignToTick(latestPrice * (1 + (takeProfitPct + profile.tp2AddonPct) / 100), tickSize, 'ceil');

  if (recommendation === 'SELL') {
    return {
      strategy: 'protect-capital',
      profile: profileName,
      entryZone: null,
      cutLoss: alignToTick(latestPrice, tickSize, 'round'),
      takeProfit1: null,
      takeProfit2: null,
      stopLossPct: Number(stopLossPct.toFixed(2)),
      takeProfitPct: Number(takeProfitPct.toFixed(2)),
      riskReward: null,
      note: 'Signal cenderung bearish. Prioritaskan reduce position / exit, hindari entry baru jangka pendek.'
    };
  }

  const rr = stopLossPct > 0 ? takeProfitPct / stopLossPct : null;
  const basePlan = {
    strategy: recommendation === 'BUY' ? 'small-margin-long' : 'wait-and-see-long',
    profile: profileName,
    entryZone: {
      low: entryLow,
      high: entryHigh
    },
    cutLoss,
    takeProfit1,
    takeProfit2,
    stopLossPct: Number(stopLossPct.toFixed(2)),
    takeProfitPct: Number(takeProfitPct.toFixed(2)),
    riskReward: rr ? Number(rr.toFixed(2)) : null,
    note:
      recommendation === 'BUY'
        ? 'Rencana small-margin: entry bertahap di area entry zone, disiplin cut loss, dan ambil profit parsial di TP1.'
        : 'Sinyal campuran (HOLD). Entry kecil saja jika harga stabil di area entry zone, tetap gunakan cut loss ketat.'
  };

  return basePlan;
}
