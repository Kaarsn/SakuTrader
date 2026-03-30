import axios from 'axios';

// In-memory storage untuk articles (untuk read endpoint)
const articleStorage = new Map();

// Real news API keys (set in .env)
const BERITA_INDO_BASE_URL = process.env.BERITA_INDO_BASE_URL || 'https://berita-indo-api-next.vercel.app/api';

const COMPANY_ALIASES = {
  BBRI: ['Bank Rakyat Indonesia', 'BRI', 'BBRI.JK'],
  TLKM: ['Telkom Indonesia', 'PT Telkom Indonesia', 'TLKM.JK'],
  GOTO: ['GoTo', 'GoTo Gojek Tokopedia', 'GOTO.JK'],
  BBCA: ['Bank Central Asia', 'BCA', 'BBCA.JK'],
  BMRI: ['Bank Mandiri', 'Mandiri', 'BMRI.JK'],
  BUMI: ['Bumi Resources', 'BUMI.JK', 'PT Bumi Resources'],
  INDF: ['Indofood', 'PT Indofood Sukses Makmur', 'INDF.JK'],
  ASII: ['Astra International', 'Astra', 'ASII.JK'],
  UNVR: ['Unilever Indonesia', 'Unilever', 'UNVR.JK'],
  ADRO: ['Adaro Energy', 'Adaro', 'ADRO.JK']
};

const BERITA_INDO_ENDPOINTS = [
  { source: 'Antara', path: '/antara-news/ekonomi' },
  { source: 'CNN Indonesia', path: '/cnn-news/ekonomi' },
  { source: 'CNBC Indonesia', path: '/cnbc-news/market' },
  { source: 'Republika', path: '/republika-news/ekonomi' },
  { source: 'Tempo Bisnis', path: '/tempo-news/bisnis' },
  { source: 'Okezone Economy', path: '/okezone-news/economy' },
  { source: 'Kumparan', path: '/kumparan-news' },
  { source: 'Tribun Bisnis', path: '/tribun-news/jakarta/bisnis' },
  { source: 'Zetizen Jawapos', path: '/zetizen-jawapos-news/techno' },
  { source: 'Vice', path: '/vice-news' },
  { source: 'Suara Bisnis', path: '/suara-news/bisnis' },
  { source: 'VOA', path: '/voa-news' }
];

const BERITA_INDO_MAX_REQUESTS = 36;
const BERITA_INDO_TIMEOUT_MS = 2200;

function hasWholeWord(text, token) {
  if (!text || !token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function buildCompanySearchText(article) {
  return [
    article?.headline,
    article?.title,
    article?.summary,
    article?.description,
    article?.content,
    article?.source,
    article?.source?.name,
    article?.url
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractBeritaIndoRows(payload) {
  const candidates = [
    payload?.data,
    payload?.results,
    payload?.posts,
    payload?.messages,
    payload?.data?.posts,
    payload?.data?.results,
    payload?.data?.data
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function normalizeBeritaIndoArticle(item, source) {
  return {
    title: item?.title || item?.headline || '',
    summary: item?.description || item?.contentSnippet || item?.title || '',
    url: item?.link || item?.url,
    source,
    publishedAt: item?.isoDate || item?.pubDate || item?.publishedAt || new Date().toISOString()
  };
}

function getStrictAliases(symbol) {
  const symbolUpper = (symbol || '').toUpperCase();
  const aliases = COMPANY_ALIASES[symbolUpper] || [];
  return aliases.filter((alias) => {
    if (!alias) return false;
    if (alias.toUpperCase().includes('.JK')) return true;
    // Prioritize explicit company names, not generic one-word aliases.
    return alias.trim().includes(' ');
  });
}

function isArticleRelevantToSymbol(article, symbol) {
  const text = buildCompanySearchText(article);
  if (!text) return false;

  const symbolUpper = (symbol || '').toUpperCase();
  const symbolLower = symbolUpper.toLowerCase();
  const aliases = getStrictAliases(symbolUpper);
  const financeContextKeywords = [
    'stock',
    'shares',
    'equity',
    'market',
    'saham',
    'emiten',
    'idx',
    'jakarta',
    'indonesia',
    'tbk',
    'bursa'
  ];

  const hasFinanceContext = financeContextKeywords.some((keyword) => text.includes(keyword));

  let phraseHit = false;
  const tokenHits = new Set();

  for (const alias of aliases) {
    const aliasLower = alias.toLowerCase();
    if (!aliasLower) continue;

    if (aliasLower.includes('.jk') && text.includes(aliasLower)) {
      return true;
    }

    if (aliasLower.length >= 5 && text.includes(aliasLower)) {
      phraseHit = true;
    }

    const tokens = aliasLower
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 5 && !['bank', 'pt', 'tbk', 'persero'].includes(token));

    for (const token of tokens) {
      if (hasWholeWord(text, token)) {
        tokenHits.add(token);
      }
    }
  }

  if (phraseHit) return true;

  // Symbol-only hits can be noisy, require financial context or additional company tokens.
  if (hasWholeWord(text, symbolLower) || text.includes(`${symbolLower}.jk`)) {
    return hasFinanceContext || tokenHits.size >= 1;
  }

  return tokenHits.size >= 2;
}

/**
 * Main function - fetch news for a ticker
 * Only use Berita Indo and only return ticker-relevant items.
 */
export async function fetchNewsForTicker(ticker) {
  const symbol = ticker.replace('.JK', '');

  try {
    console.log(`[NEWS] Trying Berita Indo API for ${symbol}...`);
    const beritaIndoNews = await fetchFromBeritaIndo(symbol);
    if (beritaIndoNews.length > 0) {
      console.log(`[NEWS] ✓ Found ${beritaIndoNews.length} relevant articles from Berita Indo for ${symbol}`);
      return beritaIndoNews;
    }
    return [];

  } catch (error) {
    console.log(`[NEWS] Error fetching news for ${ticker}: ${error.message}`);
    return [];
  }
}

/**
 * Fetch from Berita Indo API (multi-source) and keep only ticker-relevant items.
 */
async function fetchFromBeritaIndo(symbol) {
  try {
    const strictAliases = getStrictAliases(symbol);
    const queries = uniq([strictAliases[0], `${symbol}.JK`, symbol]);
    const picked = [];
    const seen = new Set();
    let requestsMade = 0;

    // Execute each query in parallel across endpoints to avoid slow sequential waits.
    for (const query of queries) {
      if (picked.length >= 8 || requestsMade >= BERITA_INDO_MAX_REQUESTS) break;

      const endpointsForRound = BERITA_INDO_ENDPOINTS.slice(0, Math.max(BERITA_INDO_MAX_REQUESTS - requestsMade, 0));
      requestsMade += endpointsForRound.length;

      const settled = await Promise.allSettled(
        endpointsForRound.map(async (endpoint) => {
          const response = await axios.get(`${BERITA_INDO_BASE_URL}${endpoint.path}`, {
            params: { search: query },
            timeout: BERITA_INDO_TIMEOUT_MS
          });

          const rows = extractBeritaIndoRows(response?.data);
          return rows
            .map((item) => normalizeBeritaIndoArticle(item, endpoint.source))
            .filter((article) => article.title && article.url)
            .filter((article) => isArticleRelevantToSymbol(article, symbol));
        })
      );

      for (const row of settled) {
        if (row.status !== 'fulfilled') continue;
        for (const article of row.value) {
          const dedupeKey = `${article.url}::${article.title}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          picked.push(article);
          if (picked.length >= 8) break;
        }
        if (picked.length >= 8) break;
      }

      // Keep iterating other queries as long as we still have request budget,
      // so results can be mixed across more sources.
      if (picked.length >= 8) break;
    }

    if (picked.length === 0) {
      console.log(`[NEWS] Berita Indo returned items, but none were relevant to ${symbol}`);
      return [];
    }

    picked.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    return picked.slice(0, 8).map((article, idx) => {
      const articleId = `article_bi_${Date.now()}_${idx}`;

      articleStorage.set(articleId, {
        id: articleId,
        title: article.title,
        source: article.source,
        summary: article.summary,
        content: article.summary,
        sentiment: detectSentiment(`${article.title} ${article.summary}`),
        publishedAt: article.publishedAt,
        author: article.source,
        originalUrl: article.url
      });

      return {
        title: article.title,
        source: article.source,
        summary: article.summary,
        url: article.url,
        sentiment: detectSentiment(`${article.title} ${article.summary}`),
        isFallback: false,
        publishedAt: article.publishedAt,
        articleId
      };
    });
  } catch (error) {
    console.log(`[NEWS] Berita Indo fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * Detect sentiment from text
 */
function detectSentiment(text) {
  if (!text) return 'netral';
  
  const textLower = text.toLowerCase();
  const positiveWords = [
    'gain', 'rise', 'climb', 'surge', 'strong', 'profit', 'earnings', 'beat',
    'outperform', 'rally', 'bullish', 'growth', 'expand', 'positive', 'climb',
    'record', 'best', 'success', 'upbeat'
  ];
  const negativeWords = [
    'fall', 'drop', 'decline', 'crash', 'weak', 'loss', 'miss', 'underperform',
    'selloff', 'bearish', 'recession', 'crisis', 'worst', 'plunge', 'tumble'
  ];

  const posCount = positiveWords.filter(w => textLower.includes(w)).length;
  const negCount = negativeWords.filter(w => textLower.includes(w)).length;

  if (posCount > negCount) return 'positif';
  if (negCount > posCount) return 'negatif';
  return 'netral';
}

/**
 * Get article by ID (for read endpoint)
 */
export function getArticleById(articleId) {
  const article = articleStorage.get(articleId);
  if (article) {
    return article;
  }
  
  // Fallback if not in memory
  return {
    id: articleId,
    title: 'Article Not Found',
    source: 'System',
    summary: 'The article could not be retrieved.',
    content: 'This article may have expired or is no longer available.',
    sentiment: 'netral',
    publishedAt: new Date().toISOString()
  };
}
