import NodeCache from 'node-cache';

export const analysisCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

export function makeCacheKey(payload) {
  return JSON.stringify(payload);
}
