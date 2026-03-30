'use client';

import { useEffect, useState } from 'react';
import { IhsgData, requestIhsg } from '../lib/api';

type IhsgChartProps = {
  refreshIntervalSeconds?: number;
};

function getSessionInfo() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');
  const minuteOfDay = hour * 60 + minute;

  const session1Start = 9 * 60; // 09:00
  const session1End = 12 * 60; // 12:00
  const session2Start = 13 * 60 + 30; // 13:30
  const session2End = 16 * 60; // 16:00

  if (minuteOfDay >= session1Start && minuteOfDay < session1End) {
    const timeLeft = session1End - minuteOfDay;
    return { session: 'Session 1', timeLeft: `${timeLeft}m left`, active: true };
  }
  if (minuteOfDay >= session2Start && minuteOfDay < session2End) {
    const timeLeft = session2End - minuteOfDay;
    return { session: 'Session 2', timeLeft: `${timeLeft}m left`, active: true };
  }
  return { session: 'Market Closed', timeLeft: 'N/A', active: false };
}

export default function IhsgChart({ refreshIntervalSeconds = 1 }: IhsgChartProps) {
  const [ihsg, setIhsg] = useState<IhsgData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState(getSessionInfo());

  const fetchIhsg = async () => {
    try {
      setLoading(true);
      const data = await requestIhsg();
      setIhsg(data);
      setSessionInfo(getSessionInfo());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load IHSG');
      console.error('IHSG fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIhsg();
    const interval = setInterval(fetchIhsg, refreshIntervalSeconds * 1000);
    return () => clearInterval(interval);
  }, [refreshIntervalSeconds]);

  if (!ihsg) {
    return (
      <div className="ihsg-card loading">
        <div className="ihsg-header">
          <h3>IHSG</h3>
          {loading && <span className="ihsg-status">...</span>}
        </div>
        {error && <div className="ihsg-error">{error}</div>}
      </div>
    );
  }

  const priceColor = ihsg.changePct >= 0 ? '--good' : '--bad';
  const changeDisplay = ihsg.changePct >= 0 ? `+${ihsg.changePct.toFixed(2)}%` : `${ihsg.changePct.toFixed(2)}%`;

  return (
    <div className="ihsg-card">
      <div className="ihsg-header">
        <div>
          <h3>IHSG</h3>
          <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: 'var(--ink-soft)', fontWeight: '500' }}>
            {sessionInfo.session}
            {sessionInfo.active && <span style={{ marginLeft: '6px' }}>({sessionInfo.timeLeft})</span>}
          </p>
        </div>
        <span className={`ihsg-status ${sessionInfo.active ? 'open' : 'closed'}`}>
          {sessionInfo.active ? '🟢' : '🔴'}
        </span>
      </div>

      <div className="ihsg-main">
        <div className="ihsg-price-section">
          <div className="ihsg-price" style={{ color: `var(${priceColor})` }}>
            {ihsg.price ? ihsg.price.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}
          </div>
          <div className="ihsg-change" style={{ color: `var(${priceColor})` }}>
            {changeDisplay}
          </div>
        </div>
      </div>

      <div className="ihsg-footer">
        <span className="ihsg-timestamp">
          {ihsg.asOf ? new Date(ihsg.asOf).toLocaleTimeString('id-ID') : 'updating...'}
        </span>
      </div>
    </div>
  );
}
