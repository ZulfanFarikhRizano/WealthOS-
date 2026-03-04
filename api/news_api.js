// ============================================================
// /api/news.js — Vercel Serverless
// Gabungan: news.js + cryptopanic.js + rss.js
//
// Routes via ?action=...
//   GET ?action=newsapi       → NewsAPI.org
//   GET ?action=cryptopanic   → CryptoPanic hot news
//   GET ?action=rss           → RSS aggregator
//   GET ?action=all           → Semua paralel (default)
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { action = 'all' } = req.query;

  // ── newsapi ──────────────────────────────────────────────
  if (action === 'newsapi') {
    const KEY = process.env.NEWSAPI_KEY;
    if (!KEY) return res.status(500).json({ error: 'NEWSAPI_KEY not configured' });
    try {
      const r = await fetch(
        `https://newsapi.org/v2/everything?q=bitcoin+OR+crypto+OR+ethereum+OR+blockchain&language=en&sortBy=publishedAt&pageSize=15&apiKey=${KEY}`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (!r.ok) return res.status(r.status).json({ error: `NewsAPI ${r.status}` });
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
      return res.status(200).json(await r.json());
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ── cryptopanic ──────────────────────────────────────────
  if (action === 'cryptopanic') {
    const KEY = process.env.CRYPTOPANIC_API_KEY;
    if (!KEY) return res.status(500).json({ error: 'CRYPTOPANIC_API_KEY not configured' });
    try {
      const r = await fetch(
        `https://cryptopanic.com/api/v1/posts/?auth_token=${KEY}&public=true&kind=news&regions=en&filter=hot`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (!r.ok) return res.status(r.status).json({ error: `CryptoPanic ${r.status}` });
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
      return res.status(200).json(await r.json());
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ── rss ──────────────────────────────────────────────────
  if (action === 'rss') {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(await _fetchRSS());
  }

  // ── all (default) — semua sumber paralel ─────────────────
  if (action === 'all') {
    const NEWS_KEY = process.env.NEWSAPI_KEY;
    const CP_KEY   = process.env.CRYPTOPANIC_API_KEY;

    const [newsR, cpR, rssR] = await Promise.allSettled([
      NEWS_KEY
        ? fetch(`https://newsapi.org/v2/everything?q=bitcoin+OR+crypto+OR+ethereum+OR+blockchain&language=en&sortBy=publishedAt&pageSize=15&apiKey=${NEWS_KEY}`)
            .then(r => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null),
      CP_KEY
        ? fetch(`https://cryptopanic.com/api/v1/posts/?auth_token=${CP_KEY}&public=true&kind=news&regions=en&filter=hot`)
            .then(r => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null),
      _fetchRSS(),
    ]);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({
      newsapi:     newsR.status === 'fulfilled' ? newsR.value : null,
      cryptopanic: cpR.status   === 'fulfilled' ? cpR.value  : null,
      rss:         rssR.status  === 'fulfilled' ? rssR.value : null,
    });
  }

  return res.status(400).json({ error: 'Unknown action', available: ['newsapi','cryptopanic','rss','all'] });
}

// ── RSS helper ───────────────────────────────────────────
async function _fetchRSS() {
  const FEEDS = [
    { url: 'https://feeds.feedburner.com/CoinDesk',           source: 'CoinDesk' },
    { url: 'https://cointelegraph.com/rss',                   source: 'CoinTelegraph' },
    { url: 'https://decrypt.co/feed',                         source: 'Decrypt' },
    { url: 'https://blockworks.co/feed',                      source: 'Blockworks' },
    { url: 'https://www.theblock.co/rss.xml',                 source: 'The Block' },
    { url: 'https://cryptoslate.com/feed/',                   source: 'CryptoSlate' },
    { url: 'https://feeds.reuters.com/reuters/businessNews',  source: 'Reuters' },
    { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC' },
    { url: 'https://beincrypto.com/feed/',                    source: 'BeInCrypto' },
  ];

  function parseRSS(xml, src) {
    const items = [];
    const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const chunk = m[1];
      const t = (chunk.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/))?.[1]?.trim()
        .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"') || '';
      const l = (chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/) || chunk.match(/<link[^>]*href="([^"]+)"/))?.[1]?.trim() || '';
      const p = (chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/) || chunk.match(/<published[^>]*>([\s\S]*?)<\/published>/))?.[1]?.trim() || new Date().toISOString();
      if (t && t.length > 5 && l) items.push({ title: t, url: l, published: p, source: src });
      if (items.length >= 5) break;
    }
    return items;
  }

  const KW = ['bitcoin','btc','crypto','ethereum','eth','blockchain','defi','nft','solana','xrp','binance','coinbase','web3','altcoin','stablecoin'];
  const results = await Promise.allSettled(
    FEEDS.map(f =>
      fetch(f.url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,*/*' }, signal: AbortSignal.timeout(5000) })
        .then(r => r.ok ? r.text() : Promise.reject())
        .then(xml => parseRSS(xml, f.source))
        .catch(() => [])
    )
  );

  const seen = new Set();
  let arts = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
    .filter(a => KW.some(k => a.title.toLowerCase().includes(k)))
    .filter(a => { const key = a.title.slice(0,50).toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });

  arts.sort((a,b) => new Date(b.published) - new Date(a.published));
  return { articles: arts.slice(0, 15) };
}
