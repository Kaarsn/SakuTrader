import OpenAI from 'openai';

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function fallbackSentiment(newsItems) {
  if (!newsItems.length) return 'Neutral';
  const text = newsItems.map((n) => `${n.title} ${n.summary}`).join(' ').toLowerCase();
  const positive = ['gain', 'growth', 'profit', 'up', 'strong', 'bull', 'naik', 'menguat', 'laba', 'optimis', 'rebound', 'positif'];
  const negative = ['loss', 'decline', 'down', 'weak', 'bear', 'risk', 'turun', 'melemah', 'rugi', 'anjlok', 'tekanan', 'negatif'];

  let score = 0;
  positive.forEach((word) => {
    if (text.includes(word)) score += 1;
  });
  negative.forEach((word) => {
    if (text.includes(word)) score -= 1;
  });

  if (score > 1) return 'Positive';
  if (score < -1) return 'Negative';
  return 'Neutral';
}

function normalizeSentiment(sentiment) {
  const value = (sentiment || 'Neutral').toLowerCase();
  if (value === 'positive') return 'Positive';
  if (value === 'negative') return 'Negative';
  return 'Neutral';
}

function buildLogicalConclusion({ ticker, technical, sentiment }) {
  const rsi = Number(technical?.indicators?.rsi || 0);
  const rsiSignal = technical?.signals?.rsiSignal || 'neutral';
  const trendSignal = technical?.signals?.trendSignal || 'downtrend';
  const macdSignal = technical?.signals?.macdSignal || 'bearish';
  const normalizedSentiment = normalizeSentiment(sentiment);

  const rsiText =
    rsiSignal === 'overbought'
      ? 'RSI berada di area overbought (risiko pullback meningkat).'
      : rsiSignal === 'oversold'
        ? 'RSI berada di area oversold (potensi technical rebound ada).'
        : 'RSI berada di area netral.';

  const trendText = trendSignal === 'uptrend'
    ? 'Harga masih berada di atas rata-rata pergerakan utama (bias tren naik).'
    : 'Harga masih berada di bawah rata-rata pergerakan utama (bias tren turun).';

  const macdText = macdSignal === 'bullish'
    ? 'MACD menunjukkan momentum bullish.'
    : 'MACD menunjukkan momentum bearish.';

  const newsText = normalizedSentiment === 'Positive'
    ? 'Sentimen berita cenderung positif.'
    : normalizedSentiment === 'Negative'
      ? 'Sentimen berita cenderung negatif.'
      : 'Sentimen berita cenderung netral.';

  let action = 'wait and see dengan ukuran posisi kecil.';
  if (trendSignal === 'uptrend' && macdSignal === 'bullish' && normalizedSentiment !== 'Negative') {
    action = 'boleh pertimbangkan buy bertahap, tetap disiplin stop-loss.';
  } else if (trendSignal === 'downtrend' && macdSignal === 'bearish' && normalizedSentiment !== 'Positive') {
    action = 'lebih aman hold ketat / reduce posisi, hindari entry agresif dulu.';
  }

  return [
    `Kesimpulan ${ticker}:`,
    rsiText,
    trendText,
    macdText,
    newsText,
    `Aksi disarankan: ${action}`
  ].join(' ');
}

export async function generateAiInsight({ ticker, technical, news }) {
  const fallbackInsight = (sentiment) => ({
    sentiment,
    insight: buildLogicalConclusion({ ticker, technical, sentiment })
  });

  if (!client) {
    const sentiment = fallbackSentiment(news);
    return fallbackInsight(sentiment);
  }

  const prompt = [
    `You are an equity analyst focused on Indonesian equities listed on IDX/BEI.`,
    `Ticker: ${ticker}`,
    `Technical data: ${JSON.stringify(technical.signals)}`,
    `Indicators: RSI=${technical.indicators.rsi}, MACD=${technical.indicators.macd}, MA20=${technical.indicators.ma20}, MA50=${technical.indicators.ma50}`,
    `News: ${JSON.stringify(news)}`,
    `Jelaskan dalam Bahasa Indonesia yang jelas, logis, dan mudah dipakai trader ritel.`,
    `Insight wajib berisi: (1) ringkasan teknikal, (2) kaitan dengan sentimen berita, (3) kesimpulan aksi praktis.`,
    `Gunakan format kalimat seperti: "Kesimpulan <ticker>: ... Aksi disarankan: ..."`,
    `Return strict JSON with keys: sentiment (Positive|Neutral|Negative), insight (maks 4 kalimat).`
  ].join('\n');

  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Respond only in JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);

    const sentiment = normalizeSentiment(parsed.sentiment || 'Neutral');
    const insight = parsed.insight || buildLogicalConclusion({ ticker, technical, sentiment });

    return {
      sentiment,
      insight
    };
  } catch (error) {
    const sentiment = fallbackSentiment(news);
    return fallbackInsight(sentiment);
  }
}
