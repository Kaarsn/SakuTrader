'use client';

import { useEffect, useState } from 'react';
import { IhsgData, requestIhsg } from '../lib/api';

type IhsgChartProps = {
  refreshIntervalSeconds?: number;
};

export default function IhsgChart({ refreshIntervalSeconds = 60 }: IhsgChartProps) {
  const [ihsg, setIhsg] = useState<IhsgData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIhsg = async () => {
    try {
      setLoading(true);
      const data = await requestIhsg();
      setIhsg(data);
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
        <h3>IHSG</h3>
        <span className={`ihsg-status ${ihsg.marketOpen ? 'open' : 'closed'}`}>
          {ihsg.marketOpen ? '🟢' : '🔴'}
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
