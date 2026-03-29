const IDX_SUFFIX = (process.env.IDX_SUFFIX || '.JK').toUpperCase();

export function normalizeIdxTicker(input) {
  const raw = (input || '').trim().toUpperCase();
  if (!raw) {
    throw new Error('Ticker is required. Example: BBRI or BBRI.JK');
  }

  if (raw.endsWith(IDX_SUFFIX)) {
    return raw;
  }

  // Allow bare IDX codes and append .JK automatically.
  if (/^[A-Z0-9]{2,8}$/.test(raw)) {
    return `${raw}${IDX_SUFFIX}`;
  }

  throw new Error('Only Indonesian IDX tickers are supported. Use format like BBRI or BBRI.JK');
}

export function normalizeIdxTickers(inputs = []) {
  return inputs.map((ticker) => normalizeIdxTicker(ticker));
}
