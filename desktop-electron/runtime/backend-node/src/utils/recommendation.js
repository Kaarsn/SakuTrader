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

function scoreFromSentiment(sentiment) {
  const normalized = (sentiment || 'neutral').toLowerCase();
  if (normalized === 'positive') return 1;
  if (normalized === 'negative') return -1;
  return 0;
}

export function buildRecommendation({ analysis, sentiment }) {
  const totalScore = scoreFromIndicators(analysis) + scoreFromSentiment(sentiment);

  if (totalScore >= 2) return 'BUY';
  if (totalScore <= -2) return 'SELL';
  return 'HOLD';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundIdr(value) {
  return Math.round(value);
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

  const entryLow = roundIdr(latestPrice * (1 - profile.entryBandPct));
  const entryHigh = roundIdr(latestPrice * (1 + profile.entryBandPct));

  const cutLoss = roundIdr(latestPrice * (1 - stopLossPct / 100));
  const takeProfit1 = roundIdr(latestPrice * (1 + takeProfitPct / 100));
  const takeProfit2 = roundIdr(latestPrice * (1 + (takeProfitPct + profile.tp2AddonPct) / 100));

  if (recommendation === 'SELL') {
    return {
      strategy: 'protect-capital',
      profile: profileName,
      entryZone: null,
      cutLoss: roundIdr(latestPrice),
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
