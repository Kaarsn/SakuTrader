export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma20: number;
  ma50: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
};

export type MultiTimeframeSnapshot = {
  label: string;
  period: string;
  indicators?: {
    rsi: number;
    macd: number;
    macdSignal: number;
    ma20: number;
    ma50: number;
    bbUpper?: number;
    bbMiddle?: number;
    bbLower?: number;
  };
  signals?: {
    rsiSignal: string;
    trendSignal: string;
    macdSignal: string;
    crossSignal?: 'golden_cross' | 'death_cross' | 'none';
    crossConclusion?: 'bullish' | 'bearish' | 'neutral';
    crossTrend?: 'bullish' | 'bearish' | 'neutral';
    volumeStrong?: string;
    bbSqueeze?: string;
    bbPosition?: string;
    volumeRatio?: number;
  };
  indicatorStatus?: {
    rsi: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    macd: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    ma20: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    ma50: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    cross: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  };
  conclusion?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  aiInsight?: {
    verdict: 'BUY' | 'HOLD' | 'SELL';
    buyingPressure: 'HIGH' | 'NORMAL' | 'LOW';
    marketResponse: 'POSITIVE' | 'MIXED' | 'NEGATIVE';
    summary: string;
    reasons: string[];
  };
  error?: string;
};

export type StockResult = {
  ticker: string;
  timeframe: string;
  latestPrice: number;
  priceChangePct: number;
  currency: string;
  technical: {
    indicators: {
      rsi: number;
      macd: number;
      macdSignal: number;
      ma20: number;
      ma50: number;
      bbUpper: number;
      bbMiddle: number;
      bbLower: number;
    };
    signals: {
      rsiSignal: string;
      trendSignal: string;
      macdSignal: string;
      crossSignal?: 'golden_cross' | 'death_cross' | 'none';
      crossConclusion?: 'bullish' | 'bearish' | 'neutral';
      crossTrend?: 'bullish' | 'bearish' | 'neutral';
      volumeStrong?: string;
      bbSqueeze?: string;
      bbPosition?: string;
      volumeRatio?: number;
    };
    candles: Candle[];
  };
  live?: {
    price?: number;
    changePct?: number;
    previousClose?: number;
    marketOpen: boolean;
    asOf: string;
    source: string;
  } | null;
  news: {
    title: string;
    source: string;
    summary: string;
    url?: string;
    sentiment?: string;
    isFallback?: boolean;
  }[];
  aiInsight: string;
  sentiment: string;
  recommendation: 'BUY' | 'HOLD' | 'SELL';
  indicatorStatus: {
    rsi: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    macd: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    ma20: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    ma50: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    cross: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  };
  multiTimeframeTechnical?: {
    '6m'?: MultiTimeframeSnapshot;
    '3m'?: MultiTimeframeSnapshot;
    '1m'?: MultiTimeframeSnapshot;
    '7d'?: MultiTimeframeSnapshot;
  };
  tradeConclusion: 'GOOD' | 'BAD';
  tradePlan: {
    strategy: string;
    profile?: 'scalp' | 'balanced' | 'swing';
    entryZone: {
      low: number;
      high: number;
    } | null;
    cutLoss: number | null;
    takeProfit1: number | null;
    takeProfit2: number | null;
    stopLossPct: number;
    takeProfitPct: number;
    riskReward: number | null;
    note: string;
  } | null;
  error?: string;
};

export type AnalysisResponse = {
  generatedAt: string;
  timeframe: string;
  strategy?: 'scalp' | 'balanced' | 'swing';
  results: StockResult[];
  cached: boolean;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

export async function requestAnalysis(
  tickers: string[],
  timeframe: string,
  strategy: 'scalp' | 'balanced' | 'swing' = 'balanced'
): Promise<AnalysisResponse> {
  const response = await fetch(`${API_BASE}/api/analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ tickers, timeframe, strategy })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to fetch analysis');
  }

  return response.json();
}

export async function exportAnalysis(data: AnalysisResponse, format: 'json' | 'csv') {
  const response = await fetch(`${API_BASE}/api/analysis/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ data, format })
  });

  if (!response.ok) {
    throw new Error('Export failed');
  }

  return response.text();
}
