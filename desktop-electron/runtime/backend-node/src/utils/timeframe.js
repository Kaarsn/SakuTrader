export function mapTimeframeToPeriod(timeframe) {
  const normalized = (timeframe || '').toLowerCase();
  if (normalized === '7d' || normalized === '7 days' || normalized === 'last 7 days') return '7d';
  if (normalized === '1m' || normalized === '1 month') return '1mo';
  if (normalized === '3m' || normalized === '3 months') return '3mo';
  if (normalized === '6m' || normalized === '6 months') return '6mo';
  return '3mo';
}

export function validateTimeframe(timeframe) {
  const allowed = ['7d', '7 days', 'last 7 days', '1m', '3m', '6m', '1 month', '3 months', '6 months'];
  return allowed.includes((timeframe || '').toLowerCase());
}
