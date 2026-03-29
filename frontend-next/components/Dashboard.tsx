'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import RecommendationBadge from './RecommendationBadge';
import StockCharts from './StockCharts';
import { AnalysisResponse, StockResult, exportAnalysis, requestAnalysis } from '../lib/api';

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
const WATCHLIST_STORAGE_KEY = 'sakutrader-watchlist';
const ALERTS_STORAGE_KEY = 'sakutrader-alerts';
const JOURNAL_STORAGE_KEY = 'sakutrader-journal';

function formatNumber(value: number | undefined, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return value.toLocaleString('id-ID', { maximumFractionDigits: digits });
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
  const [logoMissing, setLogoMissing] = useState(false);

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
      const rawWatchlist = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
      const rawAlerts = window.localStorage.getItem(ALERTS_STORAGE_KEY);
      const rawJournal = window.localStorage.getItem(JOURNAL_STORAGE_KEY);

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
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    window.localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
  }, [alerts]);

  useEffect(() => {
    window.localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(journal));
  }, [journal]);

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
          <WindowTitle title="SakuTrader / home / dashboard" />
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
              <p>Decision cockpit untuk saham BEI dengan live signal, trade plan, alert, dan journal.</p>
            </div>
          </div>
          <div className="hero-actions">
            <button className="ghost" onClick={() => setCompactView((v: boolean) => !v)}>
              {compactView ? 'Expand View' : 'Compact View'}
            </button>
            <button className="mode-toggle" onClick={() => setDark((v: boolean) => !v)}>
              {dark ? 'Switch to Light' : 'Switch to Dark'}
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

        <section className="panel utility-grid retro-window">
          <WindowTitle title="Tools / watchlist / alert / journal" />
          <article className="utility-card retro-window sub-window">
            <WindowTitle title="Watchlist" />
            <h3>Watchlist</h3>
            <div className="inline-inputs">
              <input
                value={watchlistInput}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setWatchlistInput(e.target.value)}
                placeholder="Tambah ticker, contoh: BBCA"
              />
              <button className="ghost" onClick={addTickerToWatchlist}>Add</button>
            </div>
            <div className="inline-inputs">
              <button className="ghost" onClick={saveCurrentAsWatchlist}>Save Current List</button>
              <button className="ghost" disabled={!watchlist.length} onClick={applyWatchlistToInput}>Use Watchlist</button>
            </div>
            <div className="tag-list">
              {watchlist.length ? watchlist.map((ticker) => (
                <span key={ticker} className="tag-pill">
                  {ticker}
                  <button onClick={() => removeWatchlistTicker(ticker)}>x</button>
                </span>
              )) : <p className="helper-text">Belum ada watchlist tersimpan.</p>}
            </div>
          </article>

          <article className="utility-card retro-window sub-window">
            <WindowTitle title="Price Alerts" />
            <h3>Price Alerts</h3>
            <div className="inline-inputs">
              <input
                value={alertTicker}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setAlertTicker(e.target.value)}
                placeholder="Ticker"
              />
              <select
                value={alertDirection}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setAlertDirection(e.target.value as PriceAlertDirection)}
              >
                <option value="above">Above</option>
                <option value="below">Below</option>
              </select>
              <input
                value={alertPrice}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setAlertPrice(e.target.value)}
                placeholder="Target Price"
              />
              <button className="ghost" onClick={addPriceAlert}>Add Alert</button>
            </div>
            <div className="inline-inputs">
              <button className="ghost" onClick={requestBrowserPermission} disabled={notificationEnabled}>
                {notificationEnabled ? 'Notification Enabled' : 'Enable Notification'}
              </button>
            </div>
            <div className="list-scroll">
              {alerts.length ? alerts.map((alert) => (
                <div className="list-row" key={alert.id}>
                  <span>{alert.ticker} {alert.direction === 'above' ? '>=' : '<='} {formatNumber(alert.targetPrice, 0)}</span>
                  <div className="row-actions">
                    <button className="ghost" onClick={() => toggleAlertActive(alert.id)}>{alert.active ? 'Pause' : 'Activate'}</button>
                    <button className="ghost" onClick={() => removeAlert(alert.id)}>Delete</button>
                  </div>
                </div>
              )) : <p className="helper-text">Belum ada alert aktif.</p>}
            </div>
            {alertLogs.length ? (
              <div className="alert-log">
                {alertLogs.map((log, idx) => <p key={`${log}-${idx}`}>- {log}</p>)}
              </div>
            ) : null}
          </article>

          <article className="utility-card retro-window sub-window">
            <WindowTitle title="Trade Journal" />
            <h3>Trade Journal</h3>
            <div className="inline-inputs">
              <input
                value={journalTicker}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setJournalTicker(e.target.value)}
                placeholder="Ticker"
              />
              <input
                value={journalEntryPrice}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setJournalEntryPrice(e.target.value)}
                placeholder="Entry Price"
              />
              <input
                value={journalQty}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setJournalQty(e.target.value)}
                placeholder="Qty"
              />
            </div>
            <div className="inline-inputs">
              <input
                value={journalNote}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setJournalNote(e.target.value)}
                placeholder="Catatan (opsional)"
              />
              <button className="ghost" onClick={addJournalEntry}>Add Trade</button>
            </div>
            <div className="journal-stats">
              <span>Closed Trades: {closedJournalEntries.length}</span>
              <span>Win Rate: {formatNumber(journalWinRate)}%</span>
              <span className={realizedPnl >= 0 ? 'good' : 'bad'}>Realized P/L: {formatNumber(realizedPnl, 0)}</span>
            </div>
            <div className="list-scroll">
              {journal.length ? journal.map((entry) => {
                const markPrice = entry.exitPrice ?? latestPriceMap.get(normalizeTicker(entry.ticker));
                const pnl = typeof markPrice === 'number' ? (markPrice - entry.entryPrice) * entry.quantity : undefined;
                return (
                  <div className="list-row" key={entry.id}>
                    <span>
                      {entry.ticker} | Entry {formatNumber(entry.entryPrice, 0)} x {entry.quantity} | {entry.exitPrice !== null ? 'Closed' : 'Open'}
                      {typeof pnl === 'number' ? ` | P/L ${formatNumber(pnl, 0)}` : ''}
                    </span>
                    {entry.exitPrice === null ? (
                      <div className="row-actions">
                        <button className="ghost" onClick={() => closeJournalEntry(entry.id)}>Close @ Latest</button>
                      </div>
                    ) : null}
                  </div>
                );
              }) : <p className="helper-text">Belum ada trade di journal.</p>}
            </div>
          </article>
        </section>

        {error ? <p className="error panel">{error}</p> : null}

        {data ? (
          <>
            <section className="panel stock-grid retro-window">
              <WindowTitle title="Ticker Snapshot" />
              {data.results.map((item) => (
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
                    {data.results.map((item) => {
                      if (item.error) {
                        return (
                          <tr key={`${item.ticker}-error`}>
                            <td>{displayTicker(item.ticker)}</td>
                            <td colSpan={8} className="warn">{item.error}</td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={`${item.ticker}-row`}>
                          <td>{displayTicker(item.ticker)}</td>
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
                  <p>Sentiment: {selectedStock.sentiment}</p>
                  <p>{selectedStock.aiInsight}</p>

                  <h2>News</h2>
                  {selectedStock.news.length ? (
                    selectedStock.news.slice(0, 5).map((news) => (
                      <div className="news-item" key={`${news.title}-${news.source}`}>
                        <h4>{news.title}</h4>
                        <p>{news.source}</p>
                        <p>{news.summary}</p>
                      </div>
                    ))
                  ) : (
                    <p>No recent related news found for this ticker right now.</p>
                  )}
                </article>
              </section>
            ) : null}
          </>
        ) : null}

        <footer className="panel retro-window footer-section">
          <WindowTitle title="SakuTrader Footer" />
          <div className="footer-content">
            <p className="copyright">© 2026 Muhammad Kaab Aryadilla. All rights reserved.</p>
            <p className="powered-by">Powered by AI-driven technical analysis, Golden/Death Cross detection, and multi-timeframe insights.</p>
            <p className="roadmap">🚀 Upcoming: LLM-powered financial report analysis, earnings insights, and fundamental analysis.</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
