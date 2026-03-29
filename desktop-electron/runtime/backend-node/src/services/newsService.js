import axios from 'axios';

const COMPANY_ALIASES = {
  BBRI: ['Bank Rakyat Indonesia', 'BRI'],
  TLKM: ['Telkom Indonesia', 'PT Telkom Indonesia'],
  GOTO: ['GoTo', 'GoTo Gojek Tokopedia']
};

export async function fetchNewsForTicker(ticker) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return [];
  }

  const symbol = ticker.replace('.JK', '');
  const url = 'https://newsapi.org/v2/everything';
  const aliases = COMPANY_ALIASES[symbol] || [];
  const stockKeywords = [symbol, `${symbol}.JK`, ...aliases].map((x) => x.toLowerCase());

  const queries = [
    `("${symbol}" OR "${symbol}.JK") AND (saham OR emiten OR "Bursa Efek Indonesia" OR IDX OR BEI)`,
    ...aliases.map((name) => `"${name}" AND (saham OR emiten OR Indonesia OR IDX)`),
    `${symbol} emiten`
  ];

  async function fetchForQuery(query) {
    const requests = [
      axios.get(url, {
        params: {
          q: query,
          language: 'id',
          searchIn: 'title,description',
          from: new Date(Date.now() - (1000 * 60 * 60 * 24 * 30)).toISOString(),
          sortBy: 'publishedAt',
          pageSize: 20,
          apiKey
        },
        timeout: 12000
      }),
      axios.get(url, {
        params: {
          q: query,
          language: 'en',
          searchIn: 'title,description',
          from: new Date(Date.now() - (1000 * 60 * 60 * 24 * 30)).toISOString(),
          sortBy: 'publishedAt',
          pageSize: 20,
          apiKey
        },
        timeout: 12000
      }),
      axios.get(url, {
        params: {
          q: query,
          searchIn: 'title,description',
          from: new Date(Date.now() - (1000 * 60 * 60 * 24 * 30)).toISOString(),
          sortBy: 'publishedAt',
          pageSize: 20,
          apiKey
        },
        timeout: 12000
      })
    ];

    const [idResult, enResult, anyLangResult] = await Promise.allSettled(requests);
    const idArticles = idResult.status === 'fulfilled' ? (idResult.value.data?.articles || []) : [];
    const enArticles = enResult.status === 'fulfilled' ? (enResult.value.data?.articles || []) : [];
    const anyLangArticles = anyLangResult.status === 'fulfilled' ? (anyLangResult.value.data?.articles || []) : [];
    return [...idArticles, ...enArticles, ...anyLangArticles];
  }

  let merged = [];
  for (const query of queries) {
    merged = await fetchForQuery(query);
    if (merged.length) break;
  }

  const seen = new Set();
  const deduped = merged.filter((article) => {
    const key = `${article.title || ''}|${article.url || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const relevant = deduped.filter((article) => {
    const text = `${article.title || ''} ${article.description || ''}`.toLowerCase();
    return stockKeywords.some((keyword) => text.includes(keyword));
  });

  return relevant.slice(0, 5).map((article) => ({
    title: article.title,
    source: article.source?.name || 'Unknown',
    summary: article.description || 'No summary available.',
    url: article.url,
    publishedAt: article.publishedAt
  }));
}
