import OpenAI from 'openai';

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const AI_REQUEST_TIMEOUT_MS = 4500;

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

  const trendText = trendSignal === 'uptrend'
    ? 'Kondisi utama: tren cenderung naik dengan struktur harga relatif kuat.'
    : 'Kondisi utama: tren masih rentan turun dan perlu konfirmasi pembalikan.';

  const signalText = rsiSignal === 'overbought'
    ? 'Sinyal teknikal: RSI overbought, rawan pullback meski momentum masih hidup.'
    : rsiSignal === 'oversold'
      ? 'Sinyal teknikal: RSI oversold, peluang technical rebound tetap terbuka.'
      : macdSignal === 'bullish'
        ? 'Sinyal teknikal: MACD bullish dengan momentum kenaikan bertahap.'
        : 'Sinyal teknikal: MACD bearish dan momentum belum stabil.';

  const sentimentText = normalizedSentiment === 'Positive'
    ? 'Sentimen berita mendukung skenario kenaikan.'
    : normalizedSentiment === 'Negative'
      ? 'Sentimen berita menambah risiko tekanan harga.'
      : 'Sentimen berita masih netral dan belum jadi katalis kuat.';

  let action = 'Aksi: tunggu konfirmasi level kunci sebelum menambah posisi.';
  if (trendSignal === 'uptrend' && macdSignal === 'bullish' && normalizedSentiment !== 'Negative') {
    action = 'Aksi: buy bertahap di area support dengan stop loss disiplin.';
  } else if (trendSignal === 'downtrend' && macdSignal === 'bearish' && normalizedSentiment !== 'Positive') {
    action = 'Aksi: prioritaskan proteksi modal dan hindari entry agresif.';
  }

  return `Kesimpulan ${ticker}: ${trendText} ${signalText} ${sentimentText} ${action}`;
}

function buildPriceMovementCauses({ ticker, technical, priceChangePct }) {
  const candles = technical?.candles || [];
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  
  const rsiSignal = technical?.signals?.rsiSignal || 'neutral';
  const trendSignal = technical?.signals?.trendSignal || 'downtrend';
  const volume = latest?.volume || 0;
  const previousVolume = previous?.volume || 0;
  const volumeIncrease = previousVolume > 0 ? (volume / previousVolume - 1) * 100 : 0;

  const causes = [];

  const movementPhrase = priceChangePct > 0.5
    ? 'naik'
    : priceChangePct < -0.5
      ? 'turun'
      : 'bergerak terbatas';

  const movementDetail = priceChangePct > 0.5
    ? `sekitar ${priceChangePct.toFixed(2)}%`
    : priceChangePct < -0.5
      ? `sekitar ${Math.abs(priceChangePct).toFixed(2)}%`
      : `di kisaran ${priceChangePct.toFixed(2)}%`;

  causes.push(`${ticker} ${movementPhrase} ${movementDetail} berdasarkan pergerakan harga dan indikator teknikal intraday.`);

  if (volumeIncrease > 20) {
    causes.push(`Volume transaksi naik ${volumeIncrease.toFixed(0)}% dibanding candle sebelumnya, menandakan peningkatan tekanan transaksi.`);
  } else if (volumeIncrease < -20) {
    causes.push(`Volume transaksi turun ${Math.abs(volumeIncrease).toFixed(0)}% dibanding candle sebelumnya, menandakan momentum melemah.`);
  }

  if (rsiSignal === 'overbought' && priceChangePct > 0) {
    causes.push('RSI berada di area overbought sehingga kenaikan rawan pullback jangka pendek.');
  }
  if (rsiSignal === 'oversold' && priceChangePct < 0) {
    causes.push('RSI berada di area oversold sehingga tekanan jual tergolong tinggi.');
  }

  if (trendSignal === 'downtrend' && priceChangePct < 0) {
    causes.push('Struktur trend saat ini masih downtrend, sehingga bias harga tetap tertekan.');
  }
  if (trendSignal === 'uptrend' && priceChangePct > 0) {
    causes.push('Struktur trend saat ini masih uptrend, sehingga bias kenaikan tetap terjaga.');
  }

  const macdSignal = technical?.signals?.macdSignal || 'neutral';
  if (macdSignal === 'bullish') {
    causes.push('MACD bullish mendukung momentum kenaikan bertahap.');
  } else if (macdSignal === 'bearish') {
    causes.push('MACD bearish menunjukkan momentum pelemahan masih dominan.');
  }

  return causes.length > 0 ? causes.join('; ') : 'Pergerakan normal dalam range trading historis.';
}

function buildTopNewsSelection(news = [], maxItems = 5) {
  const realNews = (news || []).filter((item) => !item?.isFallback);
  const sourceSeen = new Set();
  const selected = [];

  for (const item of realNews) {
    const sourceKey = String(item?.source || '').toLowerCase();
    if (!sourceKey || sourceSeen.has(sourceKey)) continue;
    selected.push(item);
    sourceSeen.add(sourceKey);
    if (selected.length >= maxItems) break;
  }
  // Keep source diversity strict: no duplicate source filler.
  return selected;
}

function buildOutlook({ technical, sentiment, priceChangePct }) {
  const rsiSignal = technical?.signals?.rsiSignal || 'neutral';
  const trendSignal = technical?.signals?.trendSignal || 'downtrend';
  const macdSignal = technical?.signals?.macdSignal || 'bearish';
  const normalizedSentiment = normalizeSentiment(sentiment);
  
  let outlook = '';
  
  if (trendSignal === 'uptrend' && macdSignal === 'bullish') {
    if (rsiSignal === 'overbought') {
      outlook = 'Tren naik kuat namun RSI overbought → waspadai pullback natural dalam 1-2 hari, entry bisa tunggu koreksi ke support.';
    } else {
      outlook = 'Trend naik sedang berlanjut normal → monitor resistansi area harga tertinggi terdekat, breakout bisa jadi trigger rally berlanjut.';
    }
  } else if (trendSignal === 'downtrend' && macdSignal === 'bearish') {
    if (rsiSignal === 'oversold') {
      outlook = 'Tekanan jual kuat namun RSI oversold → potensi technical rebound dalam 1-3 hari, level support perlu diperhatikan.';
    } else {
      outlook = 'Trend turun masih berlanjut → support area penting untuk dilihat, hindari long sampai ada sinyal reversal jelas.';
    }
  } else if (macdSignal === 'bullish' && normalizedSentiment !== 'Negative') {
    outlook = 'Sinyal mixed bullish emerging → monitor untuk potential shift trend, wait for confirmation dari candle berikutnya.';
  } else {
    outlook = 'Kondisi transitional, monitor untuk setup trade yang lebih clear → perhatikan volume & RSI untuk konfirmasi.';
  }
  
  // Add sentiment consideration
  if (normalizedSentiment === 'Positive') {
    outlook += ' Sentimen berita positif mendukung skenario upside.';
  } else if (normalizedSentiment === 'Negative') {
    outlook += ' Risk sentimen negatif bisa menekan harga lebih lanjut.';
  }
  
  return outlook;
}

function buildMediumOutlook({ technical, sentiment, recommendation = 'HOLD' }) {
  const normalizedSentiment = normalizeSentiment(sentiment);
  const rsiSignal = technical?.signals?.rsiSignal || 'neutral';
  const trendSignal = technical?.signals?.trendSignal || 'downtrend';
  const macdSignal = technical?.signals?.macdSignal || 'bearish';

  if (recommendation === 'BUY' && trendSignal === 'uptrend' && macdSignal === 'bullish') {
    let text = 'Prospek 1-3 bulan cenderung bullish moderat selama harga tetap di atas area support menengah dan volume tidak melemah tajam.';
    if (rsiSignal === 'overbought') {
      text += ' Namun, karena RSI sempat tinggi, skenario sehatnya adalah kenaikan bertahap diselingi fase konsolidasi.';
    }
    if (normalizedSentiment === 'Positive') {
      text += ' Sentimen positif menjadi katalis tambahan untuk melanjutkan tren.';
    }
    return text;
  }

  if (recommendation === 'SELL' || (trendSignal === 'downtrend' && macdSignal === 'bearish')) {
    let text = 'Prospek 1-3 bulan masih cenderung defensif karena struktur tren belum pulih dan risiko lanjutan penurunan masih terbuka.';
    if (rsiSignal === 'oversold') {
      text += ' Rebound teknikal tetap mungkin terjadi, namun selama belum ada konfirmasi pembalikan tren, rebound lebih cocok dipandang sebagai relief rally.';
    }
    if (normalizedSentiment === 'Negative') {
      text += ' Sentimen negatif meningkatkan peluang tekanan harga berlanjut.';
    }
    return text;
  }

  let neutralText = 'Prospek 1-3 bulan cenderung sideways dengan bias selektif; peluang ada, tetapi memerlukan konfirmasi breakout dan konsistensi volume.';
  if (normalizedSentiment === 'Positive') {
    neutralText += ' Sentimen positif menjaga peluang upside bertahap.';
  } else if (normalizedSentiment === 'Negative') {
    neutralText += ' Sentimen negatif menahan akselerasi kenaikan.';
  }
  return neutralText;
}

export async function generateAiInsight({ ticker, technical, news, priceChangePct = 0, ihsgChangePct }) {
  const inferRecommendation = () => {
    const trendSignal = technical?.signals?.trendSignal || 'downtrend';
    const macdSignal = technical?.signals?.macdSignal || 'bearish';
    const normalizedSentiment = normalizeSentiment(fallbackSentiment(news));

    if (trendSignal === 'uptrend' && macdSignal === 'bullish' && normalizedSentiment !== 'Negative') return 'BUY';
    if (trendSignal === 'downtrend' && macdSignal === 'bearish' && normalizedSentiment !== 'Positive') return 'SELL';
    return 'HOLD';
  };

  const fallbackInsight = (sentiment) => ({
    sentiment,
    insight: buildLogicalConclusion({ ticker, technical, sentiment }),
    causes: buildPriceMovementCauses({ ticker, technical, priceChangePct }),
    topNews: buildTopNewsSelection(news, 5),
    outlook: buildOutlook({ technical, sentiment, priceChangePct }),
    mediumOutlook: buildMediumOutlook({ technical, sentiment, recommendation: inferRecommendation() })
  });

  if (!client) {
    const sentiment = fallbackSentiment(news);
    return fallbackInsight(sentiment);
  }

  const prompt = [
    `You are an equity analyst focused on Indonesian equities listed on IDX/BEI.`,
    `Ticker: ${ticker}`,
    `Price change today: ${priceChangePct.toFixed(2)}%`,
    `IHSG change today: ${Number.isFinite(ihsgChangePct) ? ihsgChangePct.toFixed(2) : 'N/A'}%`,
    `Technical data: ${JSON.stringify(technical.signals)}`,
    `Indicators: RSI=${technical.indicators.rsi}, MACD=${technical.indicators.macd}, MA20=${technical.indicators.ma20}, MA50=${technical.indicators.ma50}`,
    `News: ${JSON.stringify(news)}`,
    `Jelaskan dalam Bahasa Indonesia yang jelas, logis, dan mudah dipakai trader ritel.`,
    `Insight wajib berisi: (1) kondisi trend utama, (2) sinyal teknikal paling penting, (3) rekomendasi aksi praktis.`,
    `Gunakan format kalimat seperti: "Kesimpulan <ticker>: ... Aksi disarankan: ..."`,
    `Gunakan Bahasa Indonesia, ringkas 3-4 kalimat, hindari kalimat teknis terlalu panjang.`,
    `Return strict JSON with keys: sentiment (Positive|Neutral|Negative), insight (maks 4 kalimat), causes (penyebab gerakan harga), outlook (prospek 1-3 hari ke depan), mediumOutlook (prospek 1-3 bulan ke depan).`
  ].join('\n');

  try {
    const completion = await Promise.race([
      client.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Respond only in JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('AI insight timeout')), AI_REQUEST_TIMEOUT_MS);
      })
    ]);

    const raw = completion.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);

    const sentiment = normalizeSentiment(parsed.sentiment || 'Neutral');
    const insight = parsed.insight || buildLogicalConclusion({ ticker, technical, sentiment });
    const causes = buildPriceMovementCauses({ ticker, technical, priceChangePct });
    const outlook = parsed.outlook || buildOutlook({ technical, sentiment, priceChangePct });
    const mediumOutlook = parsed.mediumOutlook || parsed.outlook1To3Months || buildMediumOutlook({ technical, sentiment, recommendation: parsed.verdict || 'HOLD' });

    return {
      sentiment,
      insight,
      causes,
      topNews: buildTopNewsSelection(news, 5),
      outlook,
      mediumOutlook
    };
  } catch (error) {
    const sentiment = fallbackSentiment(news);
    return fallbackInsight(sentiment);
  }
}
