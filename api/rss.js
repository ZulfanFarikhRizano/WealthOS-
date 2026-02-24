export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // RSS feeds dari media besar - tidak perlu API key
  const RSS_FEEDS = [
    { url: 'https://feeds.feedburner.com/CoinDesk',                      source: 'CoinDesk' },
    { url: 'https://cointelegraph.com/rss',                              source: 'CoinTelegraph' },
    { url: 'https://decrypt.co/feed',                                    source: 'Decrypt' },
    { url: 'https://blockworks.co/feed',                                 source: 'Blockworks' },
    { url: 'https://www.theblock.co/rss.xml',                            source: 'The Block' },
    { url: 'https://cryptoslate.com/feed/',                              source: 'CryptoSlate' },
    { url: 'https://feeds.reuters.com/reuters/businessNews',             source: 'Reuters' },
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',            source: 'BBC' },
    { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',           source: 'CoinDesk' },
    { url: 'https://beincrypto.com/feed/',                               source: 'BeInCrypto' },
  ];

  // Helper: parse RSS XML sederhana
  function parseRSS(xml, sourceName) {
    const items = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];

      const titleMatch = item.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                         item.match(/<title[^>]*>([\s\S]*?)<\/title>/);
      const linkMatch  = item.match(/<link[^>]*>([\s\S]*?)<\/link>/) ||
                         item.match(/<link[^>]*href="([^"]+)"/);
      const pubMatch   = item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/) ||
                         item.match(/<published[^>]*>([\s\S]*?)<\/published>/);

      const title = titleMatch?.[1]?.trim().replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"') || '';
      const link  = linkMatch?.[1]?.trim() || '';
      const pub   = pubMatch?.[1]?.trim() || new Date().toISOString();

      if (title && title.length > 5 && link) {
        items.push({ title, url: link, published: pub, source: sourceName });
      }

      if (items.length >= 5) break; // max 5 per sumber
    }

    return items;
  }

  try {
    // Fetch semua RSS feeds secara paralel
    const results = await Promise.allSettled(
      RSS_FEEDS.map(feed =>
        fetch(feed.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NewsAggregator/1.0)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*'
          },
          signal: AbortSignal.timeout(5000)
        })
        .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(xml => parseRSS(xml, feed.source))
        .catch(() => []) // kalau satu feed gagal, skip saja
      )
    );

    // Gabungkan semua artikel
    let articles = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        articles = articles.concat(result.value);
      }
    }

    // Filter kripto-related (untuk feed mainstream seperti Reuters/BBC)
    const cryptoKeywords = ['bitcoin','btc','crypto','ethereum','eth','blockchain','defi','nft','solana','xrp','binance','coinbase','web3','altcoin','stablecoin'];
    articles = articles.filter(a => {
      const t = a.title.toLowerCase();
      return cryptoKeywords.some(kw => t.includes(kw));
    });

    // Deduplikasi berdasarkan judul
    const seen = new Set();
    articles = articles.filter(a => {
      const key = a.title.substring(0, 50).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by published (terbaru dulu)
    articles.sort((a, b) => new Date(b.published) - new Date(a.published));

    return res.status(200).json({ articles: articles.slice(0, 15) });

  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil RSS: ' + error.message });
  }
}
