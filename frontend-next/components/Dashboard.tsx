'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import RecommendationBadge from './RecommendationBadge';
import StockCharts from './StockCharts';
import {
  AnalysisResponse,
  MarketRankResponse,
  StockResult,
  exportAnalysis,
  requestAnalysis,
  requestMarketRank
} from '../lib/api';

type PriceAlertDirection = 'above' | 'below';

type PriceAlert = {
  id: number;
  ticker: string;
  direction: PriceAlertDirection;
  targetPrice: number;
  active: boolean;
  createdAt: string;
  triggeredAt?: string;
};

type TradeJournalEntry = {
  id: number;
  ticker: string;
  strategy: 'scalp' | 'balanced' | 'swing';
  entryPrice: number;
  quantity: number;
  entryAt: string;
  exitPrice: number | null;
  exitAt: string | null;
  note: string;
};

const LIVE_REFRESH_SECONDS = 5;
const MARKET_RANK_REFRESH_MS = 1000;
const WATCHLIST_STORAGE_KEY = 'sakutrader-watchlist';
const ALERTS_STORAGE_KEY = 'sakutrader-alerts';
const JOURNAL_STORAGE_KEY = 'sakutrader-journal';
const APP_STATE_STORAGE_KEY = 'sakutrader-app-state-v1';

type PersistedAppState = {
  tickerInput?: string;
  timeframe?: string;
  strategyPreset?: 'scalp' | 'balanced' | 'swing';
  dark?: boolean;
  compactView?: boolean;
  selected?: string;
  data?: AnalysisResponse | null;
  riskCapital?: string;
  riskLots?: string;
};

function isValidAnalysisResponse(payload: unknown): payload is AnalysisResponse {
  if (!payload || typeof payload !== 'object') return false;
  const candidate = payload as Partial<AnalysisResponse>;
  return Array.isArray(candidate.results);
}

function formatNumber(value: number | undefined, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return value.toLocaleString('id-ID', { maximumFractionDigits: digits });
}

function parseIdrInput(raw: unknown) {
  const safeRaw = String(raw ?? '');
  const digitsOnly = safeRaw.replace(/[^\d]/g, '');
  if (!digitsOnly) return 0;
  return Number(digitsOnly);
}

function formatIdrInput(raw: unknown) {
  const numeric = parseIdrInput(raw);
  if (!numeric) return '';
  return numeric.toLocaleString('id-ID');
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function calculateTickerScore(item: StockResult) {
  if (item.error) return 0;

  let score = 50;

  if (item.recommendation === 'BUY') score += 18;
  if (item.recommendation === 'SELL') score -= 18;
  if (item.tradeConclusion === 'GOOD') score += 10;
  if (item.tradeConclusion === 'BAD') score -= 10;

  const sentiment = (item.sentiment || '').toLowerCase();
  if (sentiment.includes('positive') || sentiment.includes('positif') || sentiment.includes('optimis')) score += 6;
  if (sentiment.includes('negative') || sentiment.includes('negatif')) score -= 6;

  const statuses = [
    item.indicatorStatus.rsi,
    item.indicatorStatus.macd,
    item.indicatorStatus.ma20,
    item.indicatorStatus.ma50,
    item.indicatorStatus.cross
  ];

  statuses.forEach((status) => {
    if (status === 'BULLISH') score += 4;
    if (status === 'BEARISH') score -= 4;
  });

  const rsi = Number(item.technical?.indicators?.rsi);
  if (Number.isFinite(rsi)) {
    if (rsi >= 45 && rsi <= 60) score += 4;
    else if (rsi > 60 && rsi <= 70) score += 2;
    else if (rsi > 75) score -= 3;
    else if (rsi < 25) score += 2;
  }

  if (item.technical?.signals?.volumeStrong === 'yes') score += 3;
  if (item.priceChangePct > 8) score -= 3;
  if (item.priceChangePct < -8) score -= 5;

  return Math.round(clamp(score, 0, 100));
}

function displayTicker(ticker: string) {
  return (ticker || '').replace(/\.JK$/i, '');
}

function normalizeTicker(ticker: string) {
  return displayTicker(ticker).trim().toUpperCase();
}

function tickerForInput(ticker: string) {
  return normalizeTicker(ticker);
}

const MULTI_WINDOW_ORDER: Array<'6m' | '3m' | '1m' | '7d'> = ['6m', '3m', '1m', '7d'];
const TRADINGVIEW_INTERVALS = ['1', '5', '15', '60', '240', 'D', 'W'] as const;
const MAX_INTERVAL_CHANGES_PER_DAY = 20;

function WindowTitle({ title }: { title: string }) {
  return (
    <div className="window-titlebar">
      <div className="window-dots" aria-hidden>
        <span />
        <span />
      </div>
      <p>{title}</p>
    </div>
  );
}

export default function Dashboard() {
  const [tickerInput, setTickerInput] = useState('BBRI,TLKM,GOTO');
  const [timeframe, setTimeframe] = useState('3m');
  const [strategyPreset, setStrategyPreset] = useState<'scalp' | 'balanced' | 'swing'>('balanced');
  const [dark, setDark] = useState(false);
  const [compactView, setCompactView] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [selected, setSelected] = useState('');
  const [nextRefreshCountdown, setNextRefreshCountdown] = useState(0);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchlistInput, setWatchlistInput] = useState('');
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [alertTicker, setAlertTicker] = useState('');
  const [alertDirection, setAlertDirection] = useState<PriceAlertDirection>('above');
  const [alertPrice, setAlertPrice] = useState('');
  const [alertLogs, setAlertLogs] = useState<string[]>([]);
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [journal, setJournal] = useState<TradeJournalEntry[]>([]);
  const [journalTicker, setJournalTicker] = useState('');
  const [journalEntryPrice, setJournalEntryPrice] = useState('');
  const [journalQty, setJournalQty] = useState('1');
  const [journalNote, setJournalNote] = useState('');
  const [riskCapital, setRiskCapital] = useState('10.000.000');
  const [riskLots, setRiskLots] = useState('5');
  const [logoMissing, setLogoMissing] = useState(false);
  const [marketRank, setMarketRank] = useState<MarketRankResponse | null>(null);
  const [marketRankError, setMarketRankError] = useState('');
  const [rankNow, setRankNow] = useState(new Date());
  const [tvInterval, setTvInterval] = useState('D'); // TradingView interval default: Daily
  const [intervalChangeLog, setIntervalChangeLog] = useState<{ date: string; count: number }>({ date: new Date().toISOString().split('T')[0], count: 0 });
  const marketRankFetchingRef = useRef(false);

  const selectedStock = useMemo<StockResult | null>(() => {
    if (!data?.results?.length) return null;
    const active = data.results.find((item: StockResult) => item.ticker === selected && !item.error);
    if (active) return active;
    return data.results.find((item: StockResult) => !item.error) || null;
  }, [data, selected]);

  const shouldPollLive = useMemo(
    () => Boolean(data?.results?.some((item) => !item.error && item.live?.marketOpen)),
    [data]
  );

  const latestPriceMap = useMemo(() => {
    const map = new Map<string, number>();
    data?.results?.forEach((item) => {
      if (item.error) return;
      map.set(normalizeTicker(item.ticker), item.latestPrice);
    });
    return map;
  }, [data]);

  const tickerScoreMap = useMemo(() => {
    const map = new Map<string, number>();
    data?.results?.forEach((item) => {
      if (item.error) return;
      map.set(item.ticker, calculateTickerScore(item));
    });
    return map;
  }, [data]);

  const rankedTickers = useMemo(() => {
    if (!data?.results?.length) return [] as string[];
    return [...data.results]
      .filter((item) => !item.error)
      .sort((a, b) => (tickerScoreMap.get(b.ticker) || 0) - (tickerScoreMap.get(a.ticker) || 0))
      .map((item) => item.ticker);
  }, [data, tickerScoreMap]);

  const selectedTickerRank = selectedStock ? (rankedTickers.indexOf(selectedStock.ticker) + 1 || null) : null;
  const selectedTickerScore = selectedStock ? tickerScoreMap.get(selectedStock.ticker) : undefined;
  const safeResults = useMemo(() => (Array.isArray(data?.results) ? data.results : []), [data]);

  const topGainers = useMemo(() => marketRank?.gainers || [], [marketRank]);
  const topLosers = useMemo(() => marketRank?.losers || [], [marketRank]);
  const rankDateLabel = useMemo(() => rankNow.toLocaleDateString('id-ID', {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }), [rankNow]);
  const rankTimeLabel = useMemo(() => rankNow.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }), [rankNow]);
  const isIdxMarketOpenNow = useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(rankNow);

    const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
    const minuteOfDay = hour * 60 + minute;

    const inRange = (startHour: number, startMinute: number, endHour: number, endMinute: number) => {
      const start = startHour * 60 + startMinute;
      const end = endHour * 60 + endMinute;
      return minuteOfDay >= start && minuteOfDay <= end;
    };

    if (weekday === 'Mon' || weekday === 'Tue' || weekday === 'Wed' || weekday === 'Thu') {
      return inRange(9, 0, 12, 0) || inRange(13, 30, 15, 49);
    }

    if (weekday === 'Fri') {
      return inRange(9, 0, 11, 30) || inRange(14, 0, 15, 49);
    }

    return false;
  }, [rankNow]);

  const mediumTermOutlook = useMemo(() => {
    if (!selectedStock || selectedStock.error) return '-';

    const aiInsightObject = typeof selectedStock.aiInsight === 'object' ? selectedStock.aiInsight : null;
    const explicitOutlook = (
      aiInsightObject?.mediumOutlook ||
      aiInsightObject?.outlook1To3Months ||
      aiInsightObject?.outlook_1_3_month
    );

    if (typeof explicitOutlook === 'string' && explicitOutlook.trim()) {
      return explicitOutlook.trim();
    }

    const statuses = [
      selectedStock.indicatorStatus.rsi,
      selectedStock.indicatorStatus.macd,
      selectedStock.indicatorStatus.ma20,
      selectedStock.indicatorStatus.ma50,
      selectedStock.indicatorStatus.cross
    ];

    const bullishCount = statuses.filter((status) => status === 'BULLISH').length;
    const bearishCount = statuses.filter((status) => status === 'BEARISH').length;
    const sentiment = (selectedStock.sentiment || '').toLowerCase();
    const positiveSentiment = sentiment.includes('positive') || sentiment.includes('positif') || sentiment.includes('optimis');
    const negativeSentiment = sentiment.includes('negative') || sentiment.includes('negatif') || sentiment.includes('pesimis');

    if (selectedStock.recommendation === 'BUY' && bullishCount >= bearishCount && !negativeSentiment) {
      return 'Potensi 1-3 bulan cenderung naik bertahap bila support terjaga. Strategi terbaik: akumulasi bertingkat saat koreksi sehat dengan disiplin cut loss.';
    }

    if (selectedStock.recommendation === 'SELL' || bearishCount >= 3 || negativeSentiment) {
      return 'Prospek 1-3 bulan masih rawan tekanan. Utamakan proteksi modal, hindari entry agresif, dan tunggu konfirmasi pembalikan tren sebelum menambah posisi.';
    }

    if (selectedStock.recommendation === 'HOLD' || bullishCount === bearishCount || positiveSentiment) {
      return 'Prospek 1-3 bulan cenderung sideways ke positif moderat. Cocok untuk strategi hold bertahap sambil memantau volume dan konfirmasi breakout.';
    }

    return 'Prospek 1-3 bulan belum memiliki sinyal dominan. Fokus pada manajemen risiko, level support-resistance, dan evaluasi berkala tiap update data.';
  }, [selectedStock]);

  const longTermCandidates = useMemo(() => {
    return safeResults
      .filter((item) => !item.error)
      .map((item) => {
        const score = tickerScoreMap.get(item.ticker) || 0;
        const entryLow = item.tradePlan?.entryZone?.low;
        const entryHigh = item.tradePlan?.entryZone?.high;
        const entryText = (typeof entryLow === 'number' && typeof entryHigh === 'number')
          ? `${formatNumber(entryLow, 0)} - ${formatNumber(entryHigh, 0)}`
          : `${formatNumber(item.latestPrice, 0)} (market)`;
        return {
          ticker: item.ticker,
          score,
          recommendation: item.recommendation,
          entryText,
          rationale: item.tradeConclusion
        };
      })
      .filter((item) => item.score >= 65 && (item.recommendation === 'BUY' || item.recommendation === 'HOLD'))
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);
  }, [safeResults, tickerScoreMap]);

  const riskSizing = useMemo(() => {
    if (!selectedStock || selectedStock.error) return null;

    const capital = parseIdrInput(riskCapital);
    const requestedLots = Math.floor(Number(riskLots));
    if (!Number.isFinite(capital) || !Number.isFinite(requestedLots) || capital <= 0 || requestedLots <= 0) return null;

    const entryZone = selectedStock.tradePlan?.entryZone;
    const entryPrice = entryZone
      ? (Number(entryZone.low) + Number(entryZone.high)) / 2
      : Number(selectedStock.latestPrice);
    const cutLoss = Number(selectedStock.tradePlan?.cutLoss);

    if (!Number.isFinite(entryPrice) || !Number.isFinite(cutLoss) || entryPrice <= cutLoss) return null;

    const lotSize = 100;
    const riskPerShare = entryPrice - cutLoss;
    const maxAffordableLots = Math.floor(capital / (entryPrice * lotSize));
    const lots = Math.max(0, Math.min(requestedLots, maxAffordableLots));
    const usedShares = lots * lotSize;
    const positionValue = usedShares * entryPrice;
    const actualRisk = usedShares * riskPerShare;
    const capitalUsagePct = capital > 0 ? (positionValue / capital) * 100 : 0;

    const tp1 = Number(selectedStock.tradePlan?.takeProfit1);
    const rewardPct = Number.isFinite(tp1) && tp1 > entryPrice
      ? (((tp1 - entryPrice) / entryPrice) * 100)
      : null;

    return {
      capital,
      requestedLots,
      maxAffordableLots,
      entryPrice,
      cutLoss,
      riskPerShare,
      lots,
      usedShares,
      positionValue,
      actualRisk,
      capitalUsagePct,
      rewardPct
    };
  }, [selectedStock, riskCapital, riskLots]);

  const closedJournalEntries = useMemo(() => journal.filter((entry) => entry.exitPrice !== null), [journal]);
  const journalWinRate = useMemo(() => {
    if (!closedJournalEntries.length) return 0;
    const wins = closedJournalEntries.filter((entry) => {
      const pnl = (entry.exitPrice as number - entry.entryPrice) * entry.quantity;
      return pnl > 0;
    }).length;
    return (wins / closedJournalEntries.length) * 100;
  }, [closedJournalEntries]);

  const realizedPnl = useMemo(
    () => closedJournalEntries.reduce((acc, entry) => acc + ((entry.exitPrice as number) - entry.entryPrice) * entry.quantity, 0),
    [closedJournalEntries]
  );

  const runAnalyze = async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }

    try {
      const tickers = tickerInput
        .split(',')
        .map((x: string) => x.trim().toUpperCase())
        .filter(Boolean);

      if (!tickers.length) {
        throw new Error('Please enter at least one ticker');
      }

      const response = await requestAnalysis(tickers, timeframe, strategyPreset);
      setData(response);
      setNextRefreshCountdown(LIVE_REFRESH_SECONDS);
      const firstOk = response.results.find((item) => !item.error);
      setSelected((prev) => (prev ? prev : (firstOk?.ticker || '')));
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleAnalyze = async () => {
    await runAnalyze(false);
  };

  useEffect(() => {
    if (!shouldPollLive) return undefined;
    const intervalId = window.setInterval(() => {
      runAnalyze(true);
    }, LIVE_REFRESH_SECONDS * 1000);

    return () => window.clearInterval(intervalId);
  }, [shouldPollLive, tickerInput, timeframe, strategyPreset]);

  useEffect(() => {
    const refreshMarketRank = async () => {
      if (marketRankFetchingRef.current) return;
      marketRankFetchingRef.current = true;
      try {
        const snapshot = await requestMarketRank(100);
        setMarketRank(snapshot);
        setMarketRankError('');
      } catch (err) {
        setMarketRankError(err instanceof Error ? err.message : 'Failed to fetch market rank');
      } finally {
        marketRankFetchingRef.current = false;
      }
    };

    refreshMarketRank();
    const id = window.setInterval(() => {
      refreshMarketRank();
    }, MARKET_RANK_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRankNow(new Date());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!shouldPollLive) {
      setNextRefreshCountdown(0);
      return undefined;
    }
    setNextRefreshCountdown(LIVE_REFRESH_SECONDS);
    const countdownId = window.setInterval(() => {
      setNextRefreshCountdown((prev) => (prev <= 1 ? LIVE_REFRESH_SECONDS : prev - 1));
    }, 1000);

    return () => window.clearInterval(countdownId);
  }, [shouldPollLive]);

  useEffect(() => {
    try {
      const rawAppState = window.localStorage.getItem(APP_STATE_STORAGE_KEY);
      const rawWatchlist = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
      const rawAlerts = window.localStorage.getItem(ALERTS_STORAGE_KEY);
      const rawJournal = window.localStorage.getItem(JOURNAL_STORAGE_KEY);

      if (rawAppState) {
        const parsedAppState = JSON.parse(rawAppState) as PersistedAppState;
        if (typeof parsedAppState.tickerInput === 'string') {
          setTickerInput(parsedAppState.tickerInput);
        }
        if (parsedAppState.timeframe && ['7d', '1m', '3m', '6m'].includes(parsedAppState.timeframe)) {
          setTimeframe(parsedAppState.timeframe);
        }
        if (parsedAppState.strategyPreset && ['scalp', 'balanced', 'swing'].includes(parsedAppState.strategyPreset)) {
          setStrategyPreset(parsedAppState.strategyPreset);
        }
        if (typeof parsedAppState.dark === 'boolean') {
          setDark(parsedAppState.dark);
        }
        if (typeof parsedAppState.compactView === 'boolean') {
          setCompactView(parsedAppState.compactView);
        }
        if (typeof parsedAppState.selected === 'string') {
          setSelected(parsedAppState.selected);
        }
        if (isValidAnalysisResponse(parsedAppState.data)) {
          setData(parsedAppState.data);
        }
        if (typeof parsedAppState.riskCapital === 'string' || typeof parsedAppState.riskCapital === 'number') {
          setRiskCapital(formatIdrInput(parsedAppState.riskCapital));
        }
        if (typeof parsedAppState.riskLots === 'string' || typeof parsedAppState.riskLots === 'number') {
          setRiskLots(String(parsedAppState.riskLots).replace(/[^\d]/g, ''));
        }
      }

      if (rawWatchlist) {
        const parsedWatchlist = JSON.parse(rawWatchlist);
        if (Array.isArray(parsedWatchlist)) {
          setWatchlist(parsedWatchlist.map((item) => normalizeTicker(String(item))).filter(Boolean));
        }
      }

      if (rawAlerts) {
        const parsedAlerts = JSON.parse(rawAlerts);
        if (Array.isArray(parsedAlerts)) {
          setAlerts(parsedAlerts);
        }
      }

      if (rawJournal) {
        const parsedJournal = JSON.parse(rawJournal);
        if (Array.isArray(parsedJournal)) {
          setJournal(parsedJournal);
        }
      }
    } catch {
      // Ignore localStorage parse errors and continue with defaults.
    }

    if (typeof Notification !== 'undefined') {
      setNotificationEnabled(Notification.permission === 'granted');
    }
  }, []);

  useEffect(() => {
    const payload: PersistedAppState = {
      tickerInput,
      timeframe,
      strategyPreset,
      dark,
      compactView,
      selected,
      data,
      riskCapital,
      riskLots
    };
    window.localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(payload));
  }, [tickerInput, timeframe, strategyPreset, dark, compactView, selected, data, riskCapital, riskLots]);

  useEffect(() => {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    window.localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
  }, [alerts]);

  useEffect(() => {
    window.localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(journal));
  }, [journal]);

  useEffect(() => {
    document.body.classList.toggle('app-dark', dark);
    return () => {
      document.body.classList.remove('app-dark');
    };
  }, [dark]);

  useEffect(() => {
    if (!data?.results?.length || !alerts.length) return;

    const nextAlerts = alerts.map((alert) => {
      if (!alert.active) return alert;
      const match = data.results.find((item) => !item.error && normalizeTicker(item.ticker) === normalizeTicker(alert.ticker));
      if (!match || typeof match.latestPrice !== 'number') return alert;

      const isTriggered = alert.direction === 'above'
        ? match.latestPrice >= alert.targetPrice
        : match.latestPrice <= alert.targetPrice;

      if (!isTriggered) return alert;

      const now = new Date().toISOString();
      const message = `${normalizeTicker(alert.ticker)} ${alert.direction === 'above' ? '>=' : '<='} ${formatNumber(alert.targetPrice, 0)} (last: ${formatNumber(match.latestPrice, 0)})`;
      setAlertLogs((prev) => [message, ...prev].slice(0, 12));
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('SakuTrader Alert Triggered', { body: message });
      }

      return { ...alert, active: false, triggeredAt: now };
    });

    const changed = nextAlerts.some((item, idx) => item !== alerts[idx]);
    if (changed) {
      setAlerts(nextAlerts);
    }
  }, [data, alerts]);

  useEffect(() => {
    if (!selectedStock || selectedStock.error) return;
    const ticker = normalizeTicker(selectedStock.ticker);
    if (!journalTicker) {
      setJournalTicker(ticker);
    }
    if (!alertTicker) {
      setAlertTicker(ticker);
    }
  }, [selectedStock, alertTicker, journalTicker]);

  const parseTickerInput = (rawInput: string) => {
    return Array.from(new Set(rawInput
      .split(',')
      .map((item) => tickerForInput(item))
      .filter(Boolean)));
  };

  const addTickerToWatchlist = () => {
    const nextTicker = tickerForInput(watchlistInput);
    if (!nextTicker) return;
    setWatchlist((prev) => Array.from(new Set([...prev, nextTicker])));
    setWatchlistInput('');
  };

  const saveCurrentAsWatchlist = () => {
    const next = parseTickerInput(tickerInput);
    if (!next.length) return;
    setWatchlist(next);
  };

  const applyWatchlistToInput = () => {
    if (!watchlist.length) return;
    setTickerInput(watchlist.join(','));
  };

  const removeWatchlistTicker = (ticker: string) => {
    setWatchlist((prev) => prev.filter((item) => item !== ticker));
  };

  const requestBrowserPermission = async () => {
    if (typeof Notification === 'undefined') return;
    const permission = await Notification.requestPermission();
    setNotificationEnabled(permission === 'granted');
  };

  const addPriceAlert = () => {
    const ticker = tickerForInput(alertTicker);
    const target = Number(alertPrice);

    if (!ticker || Number.isNaN(target) || target <= 0) {
      setError('Alert membutuhkan ticker dan target price yang valid.');
      return;
    }

    setError('');
    setAlerts((prev) => [
      {
        id: Date.now(),
        ticker,
        direction: alertDirection,
        targetPrice: target,
        active: true,
        createdAt: new Date().toISOString()
      },
      ...prev
    ]);
    setAlertPrice('');
  };

  const toggleAlertActive = (id: number) => {
    setAlerts((prev) => prev.map((item) => item.id === id ? { ...item, active: !item.active } : item));
  };

  const removeAlert = (id: number) => {
    setAlerts((prev) => prev.filter((item) => item.id !== id));
  };

  const handleIntervalChange = (newInterval: string) => {
    const today = new Date().toISOString().split('T')[0];
    const { date, count } = intervalChangeLog;
    
    // Reset counter if it's a new day
    if (date !== today) {
      setIntervalChangeLog({ date: today, count: 0 });
      setTvInterval(newInterval);
      return;
    }
    
    // Check if user has exceeded max changes for today
    if (count >= MAX_INTERVAL_CHANGES_PER_DAY) {
      setError(`Max ${MAX_INTERVAL_CHANGES_PER_DAY} interval changes per day. Reset tomorrow.`);
      return;
    }
    
    setError('');
    setTvInterval(newInterval);
    setIntervalChangeLog({ date, count: count + 1 });
  };

  const addJournalEntry = () => {
    const ticker = tickerForInput(journalTicker);
    const entryPrice = Number(journalEntryPrice);
    const quantity = Number(journalQty);

    if (!ticker || Number.isNaN(entryPrice) || entryPrice <= 0 || Number.isNaN(quantity) || quantity <= 0) {
      setError('Journal membutuhkan ticker, entry price, dan quantity yang valid.');
      return;
    }

    setError('');
    setJournal((prev) => [
      {
        id: Date.now(),
        ticker,
        strategy: strategyPreset,
        entryPrice,
        quantity,
        entryAt: new Date().toISOString(),
        exitPrice: null,
        exitAt: null,
        note: journalNote.trim()
      },
      ...prev
    ]);
    setJournalEntryPrice('');
    setJournalQty('1');
    setJournalNote('');
  };

  const closeJournalEntry = (id: number) => {
    setJournal((prev) => prev.map((item) => {
      if (item.id !== id || item.exitPrice !== null) return item;
      const latest = latestPriceMap.get(normalizeTicker(item.ticker));
      if (typeof latest !== 'number') return item;
      return {
        ...item,
        exitPrice: latest,
        exitAt: new Date().toISOString()
      };
    }));
  };

  const removeJournalEntry = (id: number) => {
    setJournal((prev) => prev.filter((item) => item.id !== id));
  };

  const handleExport = async (format: 'json' | 'csv') => {
    if (!data) return;
    const text = await exportAnalysis(data, format);
    const blob = new Blob([text], { type: format === 'csv' ? 'text/csv' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analysis.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`${dark ? 'theme-dark' : 'theme-light'} ${compactView ? 'compact-mode' : ''}`}>
      <main>
        <section className="hero panel retro-window">
          <div className="hero-brand">
            <div className="brand-mark" aria-hidden={logoMissing}>
              {logoMissing ? (
                <span>ST</span>
              ) : (
                <img
                  src="/idx-logo.svg"
                  alt="SakuTrader logo"
                  onError={() => setLogoMissing(true)}
                />
              )}
            </div>
            <div>
              <p className="eyebrow">SakuTrader Insight Desk</p>
              <h1>SakuTrader</h1>
              <p className="owner-name">by Kaarsn</p>
              <p>Decision cockpit untuk saham BEI dengan live signal, trade plan, alert, dan journal.</p>
            </div>
          </div>
          <div className="hero-actions">
            <button className="ghost" onClick={() => setCompactView((v: boolean) => !v)}>
              {compactView ? 'Expand View' : 'Compact View'}
            </button>
            <button 
              className="mode-toggle" 
              onClick={() => setDark((v: boolean) => !v)}
              style={{
                padding: '10px 16px',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                backgroundColor: '#2A323F',
                color: '#E8E8E8',
                border: '2px solid #1a1f2e',
                borderRadius: '6px',
                transition: 'all 0.3s ease',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
              }}
            >
              {dark ? '☀️ Switch to Light' : '🌙 Switch to Dark'}
            </button>
          </div>
        </section>

        <section className="controls panel retro-window">
          <WindowTitle title="Command Center" />
          <label>
            Ticker IDX (pisahkan dengan koma)
            <input
              value={tickerInput}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTickerInput(e.target.value)}
              placeholder="BBRI,TLKM,GOTO atau BBRI.JK"
            />
          </label>

          <label>
            Timeframe
            <select value={timeframe} onChange={(e: ChangeEvent<HTMLSelectElement>) => setTimeframe(e.target.value)}>
              <option value="7d">Last 7 days (daily)</option>
              <option value="1m">1 month</option>
              <option value="3m">3 months</option>
              <option value="6m">6 months</option>
            </select>
          </label>

          <label>
            Strategy
            <select
              value={strategyPreset}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setStrategyPreset(e.target.value as 'scalp' | 'balanced' | 'swing')}
            >
              <option value="scalp">Scalp (tight SL/TP)</option>
              <option value="balanced">Balanced</option>
              <option value="swing">Swing (wider target)</option>
            </select>
          </label>

          <button className="primary" disabled={loading} onClick={handleAnalyze}>
            {loading ? 'Analyzing...' : 'Analyze Stocks'}
          </button>

          <button className="ghost" disabled={!data} onClick={() => handleExport('json')}>
            Export JSON
          </button>

          <button className="ghost" disabled={!data} onClick={() => handleExport('csv')}>
            Export CSV
          </button>
        </section>

        <div style={{ display: 'flex', gap: '16px', height: '420px', width: '100%' }}>
          {/* TradingView Chart - Left */}
          <section className="panel tradingview-section retro-window" style={{ flex: '1.5', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
              <WindowTitle title="TradingView Chart" />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <select
                  value={tvInterval}
                  onChange={(e) => handleIntervalChange(e.target.value)}
                  style={{ 
                    padding: '8px 12px', 
                    fontSize: '0.9rem', 
                    cursor: 'pointer',
                    backgroundColor: '#2A323F',
                    color: '#E8E8E8',
                    border: '2px solid #1a1f2e',
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    fontFamily: 'monospace',
                    minWidth: '100px'
                  }}
                >
                  <option value="D">1 day</option>
                  <option value="1">1 min</option>
                  <option value="5">5 min</option>
                  <option value="15">15 min</option>
                  <option value="60">1 hour</option>
                </select>
                <p style={{ fontSize: '0.75rem', margin: '0', color: '#888' }}>
                  {intervalChangeLog.count}/{MAX_INTERVAL_CHANGES_PER_DAY}
                </p>
              </div>
            </div>
            <div 
              className="tradingview-widget-container" 
              style={{ height: '100%', width: '100%' }}
            >
              <div 
                className="tradingview-widget-container__widget" 
                style={{ height: 'calc(100% - 32px)', width: '100%' }}
              >
                <iframe
                  src={selectedStock ? `https://s.tradingview.com/embed-widget/advanced-chart/?symbol=IDX:${selectedStock.ticker.replace(/\.JK$/, '')}&interval=${tvInterval}&timezone=Asia/Jakarta&theme=dark&style=1&locale=en&withdateranges=1` : 'about:blank'}
                  width="100%"
                  height="100%"
                  style={{ border: 'none' }}
                  allow="accelerometer; ambient-light-sensor; autoplay; battery; camera; cross-origin-isolated; document-domain; encrypted-media; execution-while-not-rendered; execution-while-out-of-viewport; fullscreen; geolocation; gyroscope; magnetometer; microphone; midi; payment; picture-in-picture; publickey-credentials-get; sync-xhr; usb; xr-spatial-tracking"
                />
              </div>
              <p className="helper-text" style={{ marginTop: '8px', fontSize: '0.75rem' }}>
                {selectedStock ? `Chart ${displayTicker(selectedStock.ticker)} (${tvInterval === '1' ? '1m' : tvInterval === '5' ? '5m' : tvInterval === '15' ? '15m' : tvInterval === '60' ? '1H' : tvInterval === '240' ? '4H' : tvInterval === 'D' ? 'Daily' : 'Weekly'}) - TradingView | Changes today: ${intervalChangeLog.count}/${MAX_INTERVAL_CHANGES_PER_DAY}` : 'Pilih ticker untuk melihat chart'}
              </p>
            </div>
          </section>

          {/* Top Gainers/Losers - Right */}
          <article className="utility-card retro-window sub-window top-gainers-card" style={{ flex: '1', height: '100%', overflowY: 'auto', padding: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <WindowTitle title="Top Gainers Rank 1-100" />
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: isIdxMarketOpenNow ? '#26d07c' : '#ff8b8b',
                  whiteSpace: 'nowrap'
                }}
              >
                {isIdxMarketOpenNow ? 'Market Open' : 'Market Closed'}
              </span>
              <p className="helper-text" style={{ margin: '0', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                {rankDateLabel} • {rankTimeLabel}
              </p>
            </div>
            <h3 style={{ margin: '4px 0 2px 0', fontSize: '0.9rem' }}>Top Gainers (Rank 1-100)</h3>
            <p className="helper-text" style={{ fontSize: '0.75rem', margin: '2px 0 4px 0' }}>
              Status: {isIdxMarketOpenNow ? 'Market Open' : 'Market Closed'}
              {' • Sampled: '}{marketRank?.sampled ?? 0}/{marketRank?.universeSize ?? 100}
            </p>
            <div className="list-scroll rank-scroll" style={{ maxHeight: '140px', marginBottom: '6px', overflowY: 'auto' }}>
              {topGainers.length ? topGainers.map((item) => (
                <div className="list-row" key={`${item.ticker}-${item.rank}`} style={{ padding: '2px 0' }}>
                  <span style={{ fontSize: '0.85rem' }}>
                    <strong className="ranking-rank">#{item.rank}</strong> {displayTicker(item.ticker)}
                  </span>
                  <span className="good" style={{ fontSize: '0.85rem' }}>+{formatNumber(item.changePct)}%</span>
                </div>
              )) : <p className="helper-text">Belum ada saham hijau pada snapshot ini.</p>}
            </div>
            <h3 style={{ margin: '4px 0 2px 0', fontSize: '0.9rem' }}>Top Losers</h3>
            <div className="list-scroll rank-scroll" style={{ maxHeight: '140px', overflowY: 'auto' }}>
              {topLosers.length ? topLosers.map((item) => (
                <div className="list-row" key={`${item.ticker}-${item.rank}-red`} style={{ padding: '2px 0' }}>
                  <span style={{ fontSize: '0.85rem' }}>
                    <strong className="ranking-rank">#{item.rank}</strong> {displayTicker(item.ticker)}
                  </span>
                  <span className="bad" style={{ fontSize: '0.85rem' }}>{formatNumber(item.changePct)}%</span>
                </div>
              )) : <p className="helper-text">Belum ada saham merah pada snapshot ini.</p>}
            </div>
            {marketRankError ? <p className="warn" style={{ fontSize: '0.8rem', margin: '4px 0 0 0' }}>{marketRankError}</p> : null}
          </article>
        </div>

        {error ? <p className="error panel">{error}</p> : null}

        {data ? (
          <>
            <section className="panel stock-grid retro-window">
              <WindowTitle title="Ticker Snapshot" />
              {safeResults.map((item) => (
                <article
                  key={item.ticker}
                  className={`stock-card ${selected === item.ticker ? 'active' : ''}`}
                  onClick={() => setSelected(item.ticker)}
                >
                  <h3>{displayTicker(item.ticker)}</h3>
                  {item.error ? (
                    <p className="warn">{item.error}</p>
                  ) : (
                    <>
                      <p className="price">
                        {formatNumber(item.latestPrice)} {item.currency || 'IDR'}
                      </p>
                      <p className="quality-score">
                        Score: <strong>{tickerScoreMap.get(item.ticker) || 0}</strong>/100
                        {' • Rank #'}{rankedTickers.indexOf(item.ticker) + 1}
                      </p>
                      <p className={item.priceChangePct >= 0 ? 'good' : 'bad'}>
                        {formatNumber(item.priceChangePct)}%
                      </p>
                      <RecommendationBadge value={item.recommendation} />
                    </>
                  )}
                </article>
              ))}
            </section>

            {selectedStock && !selectedStock.error ? (
              <section className="panel status-strip retro-window">
                <WindowTitle title="Live Decision Strip" />
                <div className="status-item">
                  <span>Stock</span>
                  <strong>{displayTicker(selectedStock.ticker)}</strong>
                </div>
                <div className="status-item">
                  <span>Market</span>
                  <strong className={selectedStock.live?.marketOpen ? 'good' : ''}>
                    {selectedStock.live?.marketOpen ? 'OPEN (LIVE)' : 'CLOSED'}
                  </strong>
                </div>
                {shouldPollLive && (
                  <div className="status-item">
                    <span>Next Refresh</span>
                    <strong>{nextRefreshCountdown}s</strong>
                  </div>
                )}
                <div className="status-item">
                  <span>Price</span>
                  <strong>{formatNumber(selectedStock.latestPrice, 0)} IDR</strong>
                </div>
                <div className="status-item">
                  <span>Recommendation</span>
                  <strong>{selectedStock.recommendation}</strong>
                </div>
                <div className="status-item">
                  <span>Quality Score</span>
                  <strong>{selectedTickerScore ?? '-'} / 100</strong>
                </div>
                <div className="status-item">
                  <span>Ranking</span>
                  <strong>{selectedTickerRank ? `#${selectedTickerRank}` : '-'}</strong>
                </div>
                <div className="status-item">
                  <span>Sentiment</span>
                  <strong>{selectedStock.sentiment}</strong>
                </div>
                <div className="status-item">
                  <span>Conclusion</span>
                  <strong className={selectedStock.tradeConclusion === 'GOOD' ? 'good' : 'bad'}>{selectedStock.tradeConclusion}</strong>
                </div>
                <div className="status-item">
                  <span>Entry</span>
                  <strong>
                    {selectedStock.tradePlan?.entryZone
                      ? `${formatNumber(selectedStock.tradePlan.entryZone.low, 0)} - ${formatNumber(selectedStock.tradePlan.entryZone.high, 0)}`
                      : '-'}
                  </strong>
                </div>
                <div className="status-item">
                  <span>Cut Loss</span>
                  <strong>{formatNumber(selectedStock.tradePlan?.cutLoss || undefined, 0)}</strong>
                </div>
                <div className="status-item">
                  <span>TP1</span>
                  <strong>{formatNumber(selectedStock.tradePlan?.takeProfit1 || undefined, 0)}</strong>
                </div>
                <div className="status-item">
                  <span>TP2</span>
                  <strong>{formatNumber(selectedStock.tradePlan?.takeProfit2 || undefined, 0)}</strong>
                </div>
              </section>
            ) : null}

            <section className="panel comparison-wrap retro-window">
              <WindowTitle title="Side-by-Side Comparison" />
              <h2>Side-by-Side Comparison</h2>
              <div className="comparison-table-scroll">
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Score</th>
                      <th>Price</th>
                      <th>Change %</th>
                      <th>RSI</th>
                      <th>MACD</th>
                      <th>MA20</th>
                      <th>MA50</th>
                      <th>Sentiment</th>
                      <th>Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {safeResults.map((item) => {
                      if (item.error) {
                        return (
                          <tr key={`${item.ticker}-error`}>
                            <td>{displayTicker(item.ticker)}</td>
                            <td colSpan={9} className="warn">{item.error}</td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={`${item.ticker}-row`}>
                          <td>{displayTicker(item.ticker)}</td>
                          <td>{tickerScoreMap.get(item.ticker) || 0}</td>
                          <td>{formatNumber(item.latestPrice)}</td>
                          <td className={item.priceChangePct >= 0 ? 'good' : 'bad'}>
                            {formatNumber(item.priceChangePct)}%
                          </td>
                          <td>{formatNumber(item.technical.indicators.rsi)}</td>
                          <td>{formatNumber(item.technical.indicators.macd)}</td>
                          <td>{formatNumber(item.technical.indicators.ma20)}</td>
                          <td>{formatNumber(item.technical.indicators.ma50)}</td>
                          <td>{item.sentiment}</td>
                          <td><RecommendationBadge value={item.recommendation} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!compactView ? <p className="helper-text">Tip: Anda bisa input kode tanpa suffix, misalnya BBRI. Sistem akan otomatis mengubah ke BBRI.JK.</p> : null}
              {shouldPollLive ? <p className="helper-text">Live mode aktif: data auto-refresh tiap 5 detik saat pasar buka.</p> : null}
            </section>

            {selectedStock ? (
              <section className="detail-grid">
                <article className="panel chart-wrap retro-window">
                  <WindowTitle title="Chart Terminal" />
                  <StockCharts candles={selectedStock.technical.candles} ticker={displayTicker(selectedStock.ticker)} dark={dark} />
                </article>

                <article className="panel insight-wrap retro-window">
                  <WindowTitle title="Analyst Notes" />
                  <h2>Indicators</h2>
                  <p>RSI: {formatNumber(selectedStock.technical.indicators.rsi)}</p>
                  <p>RSI Status: <strong className={selectedStock.indicatorStatus.rsi === 'BULLISH' ? 'good' : selectedStock.indicatorStatus.rsi === 'BEARISH' ? 'bad' : ''}>{selectedStock.indicatorStatus.rsi}</strong></p>
                  <p>MACD: {formatNumber(selectedStock.technical.indicators.macd)}</p>
                  <p>MACD Status: <strong className={selectedStock.indicatorStatus.macd === 'BULLISH' ? 'good' : selectedStock.indicatorStatus.macd === 'BEARISH' ? 'bad' : ''}>{selectedStock.indicatorStatus.macd}</strong></p>
                  <p>MA20: {formatNumber(selectedStock.technical.indicators.ma20)}</p>
                  <p>MA20 Status: <strong className={selectedStock.indicatorStatus.ma20 === 'BULLISH' ? 'good' : selectedStock.indicatorStatus.ma20 === 'BEARISH' ? 'bad' : ''}>{selectedStock.indicatorStatus.ma20}</strong></p>
                  <p>MA50: {formatNumber(selectedStock.technical.indicators.ma50)}</p>
                  <p>MA50 Status: <strong className={selectedStock.indicatorStatus.ma50 === 'BULLISH' ? 'good' : selectedStock.indicatorStatus.ma50 === 'BEARISH' ? 'bad' : ''}>{selectedStock.indicatorStatus.ma50}</strong></p>
                  <p>
                    MA Cross: <strong className={selectedStock.indicatorStatus.cross === 'BULLISH' ? 'good' : selectedStock.indicatorStatus.cross === 'BEARISH' ? 'bad' : ''}>
                      {selectedStock.technical.signals.crossSignal === 'golden_cross'
                        ? 'Golden Cross (Bullish)'
                        : selectedStock.technical.signals.crossSignal === 'death_cross'
                          ? 'Death Cross (Bearish)'
                          : selectedStock.technical.signals.crossTrend === 'bullish'
                            ? 'No New Cross - MA20 di atas MA50 (Bullish Structure)'
                            : selectedStock.technical.signals.crossTrend === 'bearish'
                              ? 'No New Cross - MA20 di bawah MA50 (Bearish Structure)'
                              : 'No New Cross'}
                    </strong>
                  </p>
                  <p>Trend: {selectedStock.technical.signals.trendSignal}</p>
                  <p>Trade Conclusion: <strong className={selectedStock.tradeConclusion === 'GOOD' ? 'good' : 'bad'}>{selectedStock.tradeConclusion}</strong></p>

                  <h2>Volume & Bollinger Bands</h2>
                  <p>Volume Ratio: <strong>{selectedStock.technical.signals.volumeRatio ?? '-'}</strong> {selectedStock.technical.signals.volumeStrong === 'yes' ? '🔥 Strong' : '📊 Normal'}</p>
                  <p>BB Squeeze Status: <strong className={selectedStock.technical.signals.bbSqueeze === 'squeeze' ? 'warn' : 'good'}>{selectedStock.technical.signals.bbSqueeze ?? 'normal'}</strong></p>
                  <p>Price Position: <strong>{
                    selectedStock.technical.signals.bbPosition === 'above_upper' ? '📈 Above Upper (Overbought)' :
                    selectedStock.technical.signals.bbPosition === 'below_lower' ? '📉 Below Lower (Oversold)' :
                    'Inside Bands (Normal)'
                  }</strong></p>
                  <p>BB Upper: {formatNumber(selectedStock.technical.indicators.bbUpper)}</p>
                  <p>BB Middle: {formatNumber(selectedStock.technical.indicators.bbMiddle)}</p>
                  <p>BB Lower: {formatNumber(selectedStock.technical.indicators.bbLower)}</p>

                  <h2>Multi-Period Technical Summary</h2>
                  {selectedStock.multiTimeframeTechnical ? (
                    <div className="comparison-table-scroll">
                      <table className="comparison-table">
                        <thead>
                          <tr>
                            <th>Window</th>
                            <th>RSI</th>
                            <th>MACD</th>
                            <th>MA20</th>
                            <th>MA50</th>
                            <th>Cross</th>
                            <th>Conclusion</th>
                            <th>AI Verdict</th>
                            <th>AI Insight</th>
                          </tr>
                        </thead>
                        <tbody>
                          {MULTI_WINDOW_ORDER.map((key) => {
                            const row = selectedStock.multiTimeframeTechnical?.[key];
                            if (!row) {
                              return (
                                <tr key={key}>
                                  <td>{key}</td>
                                  <td colSpan={8}>-</td>
                                </tr>
                              );
                            }

                            if (row.error) {
                              return (
                                <tr key={key}>
                                  <td>{row.label}</td>
                                  <td colSpan={8} className="warn">{row.error}</td>
                                </tr>
                              );
                            }

                            const conclusionClass = row.conclusion === 'BULLISH' ? 'good' : row.conclusion === 'BEARISH' ? 'bad' : '';
                            const verdictClass = row.aiInsight?.verdict === 'BUY' ? 'good' : row.aiInsight?.verdict === 'SELL' ? 'bad' : '';
                            return (
                              <tr key={key}>
                                <td>{row.label}</td>
                                <td>{formatNumber(row.indicators?.rsi)}</td>
                                <td>{formatNumber(row.indicators?.macd)}</td>
                                <td>{formatNumber(row.indicators?.ma20)}</td>
                                <td>{formatNumber(row.indicators?.ma50)}</td>
                                <td>
                                  {row.signals?.crossSignal === 'golden_cross'
                                    ? 'Golden Cross'
                                    : row.signals?.crossSignal === 'death_cross'
                                      ? 'Death Cross'
                                      : '-'}
                                </td>
                                <td className={conclusionClass}>{row.conclusion || '-'}</td>
                                <td className={verdictClass}>{row.aiInsight?.verdict || '-'}</td>
                                <td>{row.aiInsight?.summary || '-'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p>Multi-period summary belum tersedia.</p>
                  )}

                  <h2>Trade Plan (Small Margin)</h2>
                  {selectedStock.tradePlan ? (
                    <>
                      <p>Strategy: {selectedStock.tradePlan.strategy}</p>
                      <p>Preset: {selectedStock.tradePlan.profile || strategyPreset}</p>
                      {selectedStock.tradePlan.entryZone ? (
                        <p>
                          Entry Zone: {formatNumber(selectedStock.tradePlan.entryZone.low, 0)} - {formatNumber(selectedStock.tradePlan.entryZone.high, 0)} IDR
                        </p>
                      ) : (
                        <p>Entry Zone: -</p>
                      )}
                      <p>Cut Loss: {formatNumber(selectedStock.tradePlan.cutLoss || undefined, 0)} IDR</p>
                      <p>Take Profit 1: {formatNumber(selectedStock.tradePlan.takeProfit1 || undefined, 0)} IDR</p>
                      <p>Take Profit 2: {formatNumber(selectedStock.tradePlan.takeProfit2 || undefined, 0)} IDR</p>
                      <p>Risk/Reward: {selectedStock.tradePlan.riskReward ? selectedStock.tradePlan.riskReward : '-'}</p>
                      <p>{selectedStock.tradePlan.note}</p>
                    </>
                  ) : (
                    <p>Trade plan belum tersedia.</p>
                  )}

                  <h2>AI Insight</h2>
                  <div style={{ marginBottom: '1rem' }}>
                    <p><strong>Sentiment:</strong> {selectedStock.sentiment}</p>
                    {typeof selectedStock.aiInsight === 'object' ? (
                      <>
                        <p><strong>Penyebab Pergerakan:</strong> {selectedStock.aiInsight?.causes || 'N/A'}</p>
                        <p><strong>Main Insight:</strong> {selectedStock.aiInsight?.insight || '-'}</p>
                      </>
                    ) : (
                      <p><strong>Main Insight:</strong> {selectedStock.aiInsight || '-'}</p>
                    )}
                  </div>
                  
                  {typeof selectedStock.aiInsight === 'object' && selectedStock.aiInsight?.topNews && selectedStock.aiInsight.topNews.length > 0 && (
                    <div
                      style={{
                        marginBottom: '1rem',
                        padding: '0.5rem',
                        backgroundColor: dark ? '#2a323f' : '#f0f0f0',
                        color: dark ? '#fff6b8' : '#1d232d',
                        border: dark ? '1px solid #58647a' : '1px solid #d9d9d9',
                        borderRadius: '4px'
                      }}
                    >
                      <p><strong>Berita Terkait:</strong></p>
                      <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                        {selectedStock.aiInsight.topNews.map((news, idx) => (
                          <li key={idx} style={{ fontSize: '0.85rem', marginBottom: '0.3rem', color: dark ? '#fff6b8' : '#1d232d' }}>
                            {news.title} <em>({news.date || 'N/A'})</em>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {typeof selectedStock.aiInsight === 'object' && selectedStock.aiInsight?.outlook && (
                    <div
                      style={{
                        marginBottom: '0.7rem',
                        padding: '0.5rem',
                        backgroundColor: dark ? '#2f3949' : '#ffffcc',
                        color: dark ? '#fff6b8' : '#1d232d',
                        borderRadius: '4px',
                        borderLeft: `3px solid ${dark ? '#f0d24f' : '#ff9900'}`
                      }}
                    >
                      <p><strong>📈 Prospek Ke Depan (1-3 hari):</strong></p>
                      <p style={{ fontSize: '0.9rem', marginTop: '0.3rem', color: dark ? '#fff6b8' : '#1d232d' }}>{selectedStock.aiInsight.outlook}</p>
                    </div>
                  )}

                  <div
                    style={{
                      marginBottom: '0.7rem',
                      padding: '0.5rem',
                      backgroundColor: dark ? '#243040' : '#eef7ff',
                      color: dark ? '#fff6b8' : '#1d232d',
                      borderRadius: '4px',
                      borderLeft: `3px solid ${dark ? '#79d9c9' : '#2f7fd1'}`
                    }}
                  >
                    <p><strong>📊 Prospek 1-3 Bulan:</strong></p>
                    <p style={{ fontSize: '0.9rem', marginTop: '0.3rem', color: dark ? '#fff6b8' : '#1d232d' }}>{mediumTermOutlook}</p>
                  </div>

                  <p
                    style={{
                      margin: 0,
                      fontSize: '0.8rem',
                      fontStyle: 'italic',
                      color: dark ? '#e6d96a' : '#5d6775'
                    }}
                  >
                    AI ini hanya sebagai insight, keputusan akhir ada di pengguna.
                  </p>
                </article>
              </section>
            ) : null}
          </>
        ) : null}

        <footer className="panel retro-window footer-section">
          <WindowTitle title="" />
          <div className="footer-content">
            <p className="copyright">© 2026 Arya Dilla. All rights reserved.</p>
            <a className="profile-follow-card" href="https://github.com/Kaarsn" target="_blank" rel="noreferrer" style={{ marginTop: '8px' }}>
              <img className="profile-photo" src="/kaars-avatar.svg" alt="Kaars profile" />
              <span className="profile-meta">
                <strong>Kaarsn</strong>
                <small>Creator • GitHub</small>
              </span>
              <span className="profile-follow-btn">Follow</span>
            </a>
            <p className="upcoming-feature">Upcoming Feature: LLM-powered financial report analysis, earnings insights, and deeper fundamental scoring.</p>
          </div>
        </footer>

      </main>
    </div>
  );
}
