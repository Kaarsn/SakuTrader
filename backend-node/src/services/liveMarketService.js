import axios from 'axios';

function getJakartaNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date);

  const find = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    weekday: find('weekday'),
    hour: Number(find('hour')),
    minute: Number(find('minute'))
  };
}

export function isIdxMarketOpen(date = new Date()) {
  const { weekday, hour, minute } = getJakartaNowParts(date);
  if (['Sat', 'Sun'].includes(weekday)) return false;

  const totalMinutes = (hour * 60) + minute;
  const morningSession = totalMinutes >= (9 * 60) && totalMinutes <= (12 * 60);
  const afternoonSession = totalMinutes >= (13 * 60 + 30) && totalMinutes <= (16 * 60);
  return morningSession || afternoonSession;
}

export async function fetchLiveQuote(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
  const response = await axios.get(url, {
    params: {
      interval: '1m',
      range: '1d',
      includePrePost: false,
      events: 'history'
    },
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });

  const result = response.data?.chart?.result?.[0];
  if (!result) {
    return null;
  }

  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const closes = Array.isArray(quote.close) ? quote.close.filter((x) => typeof x === 'number') : [];
  const lastClose = closes.length ? closes[closes.length - 1] : undefined;

  const price = typeof meta.regularMarketPrice === 'number'
    ? meta.regularMarketPrice
    : lastClose;

  const previousClose = typeof meta.previousClose === 'number' ? meta.previousClose : undefined;
  const changePct = (typeof price === 'number' && typeof previousClose === 'number' && previousClose !== 0)
    ? ((price - previousClose) / previousClose) * 100
    : undefined;

  const asOf = typeof meta.regularMarketTime === 'number'
    ? new Date(meta.regularMarketTime * 1000).toISOString()
    : new Date().toISOString();

  return {
    price,
    changePct,
    previousClose,
    marketOpen: isIdxMarketOpen(),
    asOf,
    source: 'yahoo-chart-1m'
  };
}
