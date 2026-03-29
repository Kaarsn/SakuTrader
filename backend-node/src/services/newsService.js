import axios from 'axios';

// In-memory storage untuk articles (untuk read endpoint)
const articleStorage = new Map();

// Real news API keys (set in .env)
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || 'c7pb0aqad3icao3ufq70'; // Free tier key
const NEWS_API_KEY = process.env.NEWS_API_KEY || '3e58215697154bb986091ee64391c4a6';

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

/**
 * Main function - fetch news for a ticker
 * Priority: Finnhub -> NewsAPI -> Yahoo Finance -> Generic market news
 */
export async function fetchNewsForTicker(ticker) {
  const symbol = ticker.replace('.JK', '');

  try {
    // Priority 1: Finnhub (free, reliable global stocks)
    console.log(`[NEWS] Trying Finnhub for ${symbol}...`);
    const finnhubNews = await fetchFromFinnhub(symbol);
    if (finnhubNews.length > 0) {
      console.log(`[NEWS] Found ${finnhubNews.length} articles from Finnhub`);
      return finnhubNews;
    }

    // Priority 2: NewsAPI
    console.log(`[NEWS] Finnhub returned nothing, trying NewsAPI for ${symbol}...`);
    const newsApiNews = await fetchFromNewsAPI(symbol);
    if (newsApiNews.length > 0) {
      console.log(`[NEWS] Found ${newsApiNews.length} articles from NewsAPI`);
      return newsApiNews;
    }

    // Priority 3: Generic market news fallback
    console.log(`[NEWS] No real news found, using generic market news for ${symbol}`);
    return getGenericMarketNews();

  } catch (error) {
    console.log(`[NEWS] Error fetching news for ${ticker}: ${error.message}`);
    return getGenericMarketNews();
  }
}

/**
 * Fetch from Finnhub API - free tier, reliable, global stocks
 * https://finnhub.io
 */
async function fetchFromFinnhub(symbol) {
  try {
    const response = await axios.get('https://finnhub.io/api/v1/company/news', {
      params: {
        symbol: symbol.toUpperCase(),
        limit: 10,
        token: FINNHUB_API_KEY
      },
      timeout: 8000
    });

    if (!response.data || response.data.length === 0) return [];

    return response.data.slice(0, 8).map((article, idx) => {
      const articleId = `article_fe_${Date.now()}_${idx}`;

      // Store full article with original URL
      articleStorage.set(articleId, {
        id: articleId,
        title: article.headline,
        source: article.source || 'Finnhub',
        summary: article.summary || '',
        content: article.summary || 'Read the full article from the source.',
        sentiment: detectSentiment(article.headline + ' ' + (article.summary || '')),
        publishedAt: new Date(article.datetime * 1000).toISOString(),
        author: article.source || 'Finnhub',
        originalUrl: article.url
      });

      return {
        title: article.headline,
        source: article.source || 'Finnhub News',
        summary: article.summary || article.headline,
        url: article.url, // Real link to article
        sentiment: detectSentiment(article.headline + ' ' + (article.summary || '')),
        isFallback: false,
        publishedAt: new Date(article.datetime * 1000).toISOString(),
        articleId: articleId
      };
    });
  } catch (error) {
    console.log(`[NEWS] Finnhub fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * Fetch from NewsAPI.org - comprehensive global news
 * https://newsapi.org
 */
async function fetchFromNewsAPI(symbol) {
  try {
    const aliases = COMPANY_ALIASES[symbol] || [];
    const queries = [symbol, ...aliases].filter(Boolean).slice(0, 3);

    for (const query of queries) {
      try {
        const response = await axios.get('https://newsapi.org/v2/everything', {
          params: {
            q: query,
            sortBy: 'publishedAt',
            language: 'en',
            pageSize: 10,
            apiKey: NEWS_API_KEY
          },
          timeout: 8000
        });

        if (response.data.articles && response.data.articles.length > 0) {
          return response.data.articles.slice(0, 8).map((article, idx) => {
            const articleId = `article_na_${Date.now()}_${idx}`;

            // Store full article with real URL
            articleStorage.set(articleId, {
              id: articleId,
              title: article.title,
              source: article.source.name || 'NewsAPI',
              summary: article.description || '',
              content: article.content || article.description || '',
              sentiment: detectSentiment(article.title + ' ' + (article.description || '')),
              publishedAt: article.publishedAt,
              author: article.author || article.source.name || 'News',
              originalUrl: article.url
            });

            return {
              title: article.title,
              source: article.source.name || 'NewsAPI',
              summary: article.description || '',
              url: article.url, // Real link to article
              sentiment: detectSentiment(article.title + ' ' + (article.description || '')),
              isFallback: false,
              publishedAt: article.publishedAt,
              articleId: articleId
            };
          });
        }
      } catch (err) {
        console.log(`[NEWS] NewsAPI error for query "${query}": ${err.message}`);
      }
    }

    return [];
  } catch (error) {
    console.log(`[NEWS] NewsAPI error: ${error.message}`);
    return [];
  }
}

/**
 * Generic market news fallback - real links to financial news portals
 * NOT per-company generated, actual portal links
 */
function getGenericMarketNews() {
  const marketNews = [
    {
      title: 'U.S. Stock Market Opens Higher on Economic Optimism',
      source: 'Reuters',
      summary: 'Major stock indices post gains after positive economic data',
      url: 'https://www.reuters.com/markets',
      sentiment: 'positif'
    },
    {
      title: 'AI Stocks Rally as Tech Earnings Beat Expectations',
      source: 'Bloomberg',
      summary: 'Technology sector strengthens on positive earnings reports',
      url: 'https://www.bloomberg.com/technology',
      sentiment: 'positif'
    },
    {
      title: 'Oil Prices Rise on Supply Concerns',
      source: 'CNBC',
      summary: 'Energy markets rally amid production concerns',
      url: 'https://www.cnbc.com/energy',
      sentiment: 'positif'
    },
    {
      title: 'Federal Reserve Holds Rates Steady',
      source: 'Financial Times',
      summary: 'Central bank maintains current monetary policy stance',
      url: 'https://markets.ft.com',
      sentiment: 'netral'
    },
    {
      title: 'Emerging Markets Lead Global Recovery',
      source: 'Investing.com',
      summary: 'Developing world stocks outperform amid strong growth',
      url: 'https://www.investing.com',
      sentiment: 'positif'
    },
    {
      title: 'Banking Sector Faces Headwinds from Interest Rates',
      source: 'MarketWatch',
      summary: 'Financial stocks challenge amid rate pressures',
      url: 'https://www.marketwatch.com/investing',
      sentiment: 'negatif'
    },
    {
      title: 'IPO Market Picks Up Steam in 2026',
      source: 'Yahoo Finance',
      summary: 'Conservative IPO pipeline shows signs of revival',
      url: 'https://finance.yahoo.com',
      sentiment: 'optimis'
    }
  ];

  return marketNews.map((news, idx) => {
    const articleId = `article_mkt_${Date.now()}_${idx}`;

    // Store for read endpoint
    articleStorage.set(articleId, {
      id: articleId,
      title: news.title,
      source: news.source,
      summary: news.summary,
      content: `${news.title}\n\n${news.summary}\n\nRead full article: ${news.url}`,
      sentiment: news.sentiment,
      publishedAt: new Date().toISOString(),
      author: news.source,
      originalUrl: news.url
    });

    return {
      title: news.title,
      source: news.source,
      summary: news.summary,
      url: news.url, // Real portal link
      sentiment: news.sentiment,
      isFallback: true,
      publishedAt: new Date().toISOString(),
      articleId: articleId
    };
  });
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
