import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import * as cheerio from 'cheerio';

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

// Free fallback news sources (when NEWS_API_KEY not available)
const MOCK_NEWS_SOURCES = [
  {
    id: 'kontan',
    name: 'Kontan.co.id',
    baseUrl: 'https://kontan.co.id'
  },
  {
    id: 'bisnis',
    name: 'Bisnis.com',
    baseUrl: 'https://bisnis.com'
  },
  {
    id: 'investor',
    name: 'Investor.id',
    baseUrl: 'https://investor.id'
  },
  {
    id: 'cnbc-indo',
    name: 'CNBC Indonesia',
    baseUrl: 'https://www.cnbcindonesia.com'
  },
  {
    id: 'market-bisnis',
    name: 'Market.Bisnis.com',
    baseUrl: 'https://market.bisnis.com'
  }
];

// RSS Feed URLs from Indonesian news portals
const RSS_FEEDS = [
  'https://market.bisnis.com/rss',
  'https://investor.id/feed.xml',
  'https://www.kontan.co.id/rss'
];

// Web scraper for local Indonesian news portals
async function scrapeFromPortals(companyName, ticker) {
  const articles = [];
  const symbol = ticker.replace('.JK', '');

  // Scrape Kontan.co.id
  try {
    console.log(`[NEWS] Scraping Kontan.co.id for ${symbol}...`);
    const kontanUrl = `https://kontan.co.id/?s=${encodeURIComponent(symbol)}`;
    const response = await axios.get(kontanUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    });
    
    const $ = cheerio.load(response.data);
    const items = $('article, .post, .article-item, div[class*="post"]').slice(0, 5);
    
    items.each((i, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, .title, a').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const summary = $el.find('.excerpt, p, .summary').first().text().trim();
      
      if (title && link && (title.toLowerCase().includes(symbol.toLowerCase()) || title.toLowerCase().includes(companyName.toLowerCase()))) {
        articles.push({
          title: title.substring(0, 100),
          source: 'Kontan.co.id',
          summary: summary.substring(0, 200),
          url: link,
          sentiment: detectSentiment(title + ' ' + summary),
          isFallback: false,
          publishedAt: new Date().toISOString()
        });
      }
    });
  } catch (error) {
    console.log(`[NEWS] Kontan scrape failed: ${error.message}`);
  }

  // Scrape Bisnis.com
  try {
    console.log(`[NEWS] Scraping Bisnis.com for ${symbol}...`);
    const bisnisUrl = `https://bisnis.com/?s=${encodeURIComponent(symbol)}`;
    const response = await axios.get(bisnisUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    });
    
    const $ = cheerio.load(response.data);
    const items = $('article, .post, .article, div[class*="news"]').slice(0, 5);
    
    items.each((i, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, .title, a').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const summary = $el.find('.excerpt, p, .summary, .lead').first().text().trim();
      
      if (title && link && (title.toLowerCase().includes(symbol.toLowerCase()) || title.toLowerCase().includes(companyName.toLowerCase()))) {
        articles.push({
          title: title.substring(0, 100),
          source: 'Bisnis.com',
          summary: summary.substring(0, 200),
          url: link,
          sentiment: detectSentiment(title + ' ' + summary),
          isFallback: false,
          publishedAt: new Date().toISOString()
        });
      }
    });
  } catch (error) {
    console.log(`[NEWS] Bisnis scrape failed: ${error.message}`);
  }

  // Scrape Market.Bisnis.com
  try {
    console.log(`[NEWS] Scraping Market.Bisnis.com for ${symbol}...`);
    const marketUrl = `https://market.bisnis.com/?s=${encodeURIComponent(symbol)}`;
    const response = await axios.get(marketUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    });
    
    const $ = cheerio.load(response.data);
    const items = $('article, .post, [class*="news"], [class*="article"]').slice(0, 5);
    
    items.each((i, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, .title, a').first().text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const summary = $el.find('.excerpt, p, .summary').first().text().trim();
      
      if (title && link && (title.toLowerCase().includes(symbol.toLowerCase()) || title.toLowerCase().includes(companyName.toLowerCase()))) {
        articles.push({
          title: title.substring(0, 100),
          source: 'Market.Bisnis.com',
          summary: summary.substring(0, 200),
          url: link,
          sentiment: detectSentiment(title + ' ' + summary),
          isFallback: false,
          publishedAt: new Date().toISOString()
        });
      }
    });
  } catch (error) {
    console.log(`[NEWS] Market scrape failed: ${error.message}`);
  }

  return articles.slice(0, 10);
}

function detectSentiment(text) {
  const textLower = text.toLowerCase();
  if (textLower.includes('naik') || textLower.includes('positif') || textLower.includes('kuat') || textLower.includes('layak') || textLower.includes('gain') || textLower.includes('bullish')) {
    return 'positif';
  } else if (textLower.includes('turun') || textLower.includes('negatif') || textLower.includes('lemah') || textLower.includes('loss') || textLower.includes('bearish')) {
    return 'negatif';
  } else if (textLower.includes('optimis') || textLower.includes('harap') || textLower.includes('prospek')) {
    return 'optimis';
  }
  return 'netral';
}

async function fetchFromRSSFeeds(companyName) {
  const articles = [];

  for (const feedUrl of RSS_FEEDS) {
    try {
      console.log(`[NEWS] Fetching from RSS: ${feedUrl}`);
      const response = await axios.get(feedUrl, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      // Parse XML to find relevant articles
      try {
        const parsedFeed = await parseStringPromise(response.data);
        const items = parsedFeed.rss?.channel?.[0]?.item || [];

        for (const item of items) {
          const title = item.title?.[0] || '';
          const description = item.description?.[0] || '';
          const link = item.link?.[0] || '';
          const pubDate = item.pubDate?.[0] || new Date().toISOString();

          // Check if article mentions the company
          if (title.toLowerCase().includes(companyName.toLowerCase())) {
            // Detect sentiment from title/description
            const text = (title + ' ' + description).toLowerCase();
            let sentiment = 'netral';
            if (text.includes('naik') || text.includes('positif') || text.includes('kuat') || text.includes('layak')) {
              sentiment = 'positif';
            } else if (text.includes('turun') || text.includes('negatif') || text.includes('lemah')) {
              sentiment = 'negatif';
            } else if (text.includes('optimis') || text.includes('harap')) {
              sentiment = 'optimis';
            }

            articles.push({
              title,
              source: extractSourceName(feedUrl),
              summary: description.substring(0, 200),
              url: link,
              sentiment,
              isFallback: false,
              publishedAt: pubDate
            });
          }
        }
      } catch (parseError) {
        console.log(`[NEWS] Failed to parse RSS from ${feedUrl}: ${parseError.message}`);
      }
    } catch (error) {
      console.log(`[NEWS] Failed to fetch RSS from ${feedUrl}: ${error.message}`);
    }
  }

  return articles.slice(0, 10);
}

function extractSourceName(feedUrl) {
  if (feedUrl.includes('bisnis')) return 'Bisnis.com';
  if (feedUrl.includes('investor')) return 'Investor.id';
  if (feedUrl.includes('kontan')) return 'Kontan.co.id';
  return 'News Portal';
}

export async function fetchNewsForTicker(ticker) {
  const symbol = ticker.replace('.JK', '');
  const aliases = COMPANY_ALIASES[symbol] || [];
  const companyName = aliases[0] || symbol;

  try {
    // Try web scraping first (live news from portals)
    console.log(`[NEWS] Fetching real news for ${symbol} from web portals...`);
    const scrapedArticles = await scrapeFromPortals(companyName, ticker);
    
    if (scrapedArticles.length > 0) {
      console.log(`[NEWS] Found ${scrapedArticles.length} articles from web scraping for ${symbol}`);
      return scrapedArticles;
    }

    console.log(`[NEWS] No scraped news found, trying RSS feeds...`);
    // Try RSS feeds (free, real news)
    const rssArticles = await fetchFromRSSFeeds(companyName);
    
    if (rssArticles.length > 0) {
      console.log(`[NEWS] Found ${rssArticles.length} articles from RSS feeds for ${symbol}`);
      return rssArticles;
    }

    // If no RSS results, try NewsAPI
    const newsApiKey = process.env.NEWS_API_KEY || '3e58215697154bb986091ee64391c4a6'; // Hardcoded for testing
    if (newsApiKey) {
      console.log(`[NEWS] No RSS results, trying NewsAPI for ${symbol}...`);
      
      const searchQuery = `${companyName}`;
      const newsApiUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(searchQuery)}&sortBy=publishedAt&apiKey=${newsApiKey}`;
      
      const response = await axios.get(newsApiUrl, {
        timeout: 8000
      });

      if (response.data.articles && response.data.articles.length > 0) {
        const articles = response.data.articles.slice(0, 10).map((article) => {
          const titleLower = article.title.toLowerCase();
          let sentiment = 'netral';
          if (titleLower.includes('kuat') || titleLower.includes('naik') || titleLower.includes('positif')) {
            sentiment = 'positif';
          } else if (titleLower.includes('turun') || titleLower.includes('negatif') || titleLower.includes('jatuh')) {
            sentiment = 'negatif';
          } else if (titleLower.includes('optimis')) {
            sentiment = 'optimis';
          }

          return {
            title: article.title,
            source: article.source.name || 'NewsAPI',
            summary: article.description || '',
            url: article.url,
            sentiment,
            isFallback: false,
            publishedAt: article.publishedAt
          };
        });

        console.log(`[NEWS] Found ${articles.length} articles from NewsAPI for ${symbol}`);
        return articles;
      }
    }

    // Fallback to generated news if nothing found
    console.log(`[NEWS] No real news found, using fallback generated news for ${symbol}`);
    return getFallbackNews(ticker);

  } catch (error) {
    console.log(`[NEWS] Error fetching news for ${ticker}: ${error.message}`);
    return getFallbackNews(ticker);
  }
}

// Enhanced fallback news generator with more dynamic content
function getFallbackNews(ticker) {
  const symbol = ticker.replace('.JK', '');
  const aliases = COMPANY_ALIASES[symbol] || [];
  const companyName = aliases[0] || symbol;
  
  // Extended news templates with various themes
  const newsTemplates = [
    // Positive news
    {
      title: `${companyName} Catat Laporan Keuangan Solid di Q1 2026`,
      summary: `${companyName} melaporkan pencapaian yang impresif dengan peningkatan pendapatan sebesar 15% dibanding periode lalu. Pertumbuhan ini didukung oleh ekspansi pasar dan peningkatan efisiensi operasional di semua divisi bisnis.`,
      sentiment: 'positif'
    },
    {
      title: `${companyName} Raih Kontrak Besar Senilai Miliaran Rupiah`,
      summary: `Manajemen ${companyName} mengumumkan penandatanganan kontrak kerjasama strategis dengan mitra korporat terkemuka. Transaksi ini diharapkan memberikan kontribusi signifikan terhadap pertumbuhan revenue tahun depan.`,
      sentiment: 'positif'
    },
    {
      title: `Analis Rekomendasikan ${companyName} dengan Target Harga Naik Signifikan`,
      summary: `Sejumlah analis pasar meningkatkan rating dan target harga saham ${companyName} mengikuti kinerja kuartal terbaru yang melampaui ekspektasi. Valuasi saat ini dinilai sangat menarik untuk investor jangka panjang.`,
      sentiment: 'positif'
    },
    {
      title: `${companyName} Luncurkan Produk Inovatif untuk Segmen Premium`,
      summary: `Divisi riset dan pengembangan ${companyName} telah selesai mengembangkan produk unggulan baru yang diharapkan bisa membuka pasar baru. Peluncuran produk dijadwalkan pada kuartal kedua 2026 mendatang.`,
      sentiment: 'optimis'
    },
    {
      title: `Saham ${companyName} Trending Positif di Pasar Modal Indonesia`,
      summary: `Saham ${companyName} mencatat tren positif dengan peningkatan permintaan dari investor institusional dan retail. Volume transaksi meningkat signifikan menunjukkan minat pasar yang tinggi terhadap perusahaan ini.`,
      sentiment: 'positif'
    },
    // Optimistic news
    {
      title: `${companyName} Targetkan Pertumbuhan Double Digit di 2026`,
      summary: `Manajemen ${companyName} menetapkan target pertumbuhan revenue sebesar 12-15% untuk tahun fiskal 2026. Strategi agresif difokuskan pada ekspansi geografis dan pengembangan segmen bisnis baru yang potensial.`,
      sentiment: 'optimis'
    },
    {
      title: `Dividen ${companyName} Diprediksi Naik 20% Tahun Ini`,
      summary: `Analis memproyeksikan peningkatan pembayaran dividen ${companyName} mencapai 20% dibanding tahun lalu berkat peningkatan profitabilitas. Kebijakan dividend-friendly ini menarik perhatian investor yang mencari yield investment.`,
      sentiment: 'optimis'
    },
    {
      title: `${companyName} Persiapkan Ekspansi ke Pasar ASEAN Baru`,
      summary: `Manajemen ${companyName} sedang merancang strategi masuk ke pasar-pasar berkembang di kawasan ASEAN. Perluasan geografis ini diharapkan membuka peluang pertumbuhan eksponensial dalam lima tahun ke depan.`,
      sentiment: 'optimis'
    },
    // Mixed sentiment
    {
      title: `${companyName} Kurangi Beban Operasional Melalui Otomasi Proses`,
      summary: `${companyName} mengimplementasikan teknologi otomasi untuk mengurangi biaya operasional dan meningkatkan efisiensi. Investasi teknologi ini diharapkan bisa meningkatkan margin keuntungan sebesar 3-5% di tahun mendatang.`,
      sentiment: 'positif'
    },
    {
      title: `Partnership Strategis ${companyName} Buka Peluang Bisnis Baru`,
      summary: `${companyName} menjalin kerjasama dengan perusahaan teknologi global untuk mengintegrasikan solusi digital ke dalam ekosistem bisnis. Kolaborasi ini merupakan langkah strategis untuk tetap kompetitif di era digital.`,
      sentiment: 'optimis'
    }
  ];

  // Return 5-8 news items dengan rotasi dari templates
  const newsCount = Math.floor(Math.random() * 4) + 5; // 5-8 news
  const news = [];
  
  for (let i = 0; i < newsCount; i++) {
    const template = newsTemplates[i % newsTemplates.length];
    const source = MOCK_NEWS_SOURCES[i % MOCK_NEWS_SOURCES.length];
    
    // Generate realistic URLs based on source
    let articleUrl;
    const slug = template.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    
    if (source.id === 'kontan') {
      articleUrl = `${source.baseUrl}/berita/${slug}`;
    } else if (source.id === 'bisnis') {
      articleUrl = `${source.baseUrl}/read/${Date.now()}-${slug}`;
    } else if (source.id === 'investor') {
      articleUrl = `${source.baseUrl}/read/${slug}`;
    } else if (source.id === 'cnbc-indo') {
      articleUrl = `${source.baseUrl}/market/article/${Date.now()}-${slug}`;
    } else {
      articleUrl = `${source.baseUrl}/${slug}`;
    }
    
    // Generate slightly different timestamp for each article (looks more realistic)
    const daysAgo = Math.floor(Math.random() * 7);
    const publishedAt = new Date();
    publishedAt.setDate(publishedAt.getDate() - daysAgo);
    
    news.push({
      title: template.title,
      source: source.name,
      summary: template.summary,
      url: articleUrl,
      sentiment: template.sentiment,
      isFallback: true,
      publishedAt: publishedAt.toISOString()
    });
  }

  return news;
}
