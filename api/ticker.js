// /api/ticker.js — Vercel Serverless Proxy untuk harga ticker
// Browser fetch /api/ticker?symbol=BTCUSDT

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=5'); // cache 5 detik

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { symbol = 'BTCUSDT' } = req.query;

  const sources = [
    // 1. Bybit
    async () => {
      const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);
      const d = await r.json();
      if (d.retCode !== 0) throw new Error('Bybit: ' + d.retMsg);
      const t = d.result.list[0];
      return { lastPrice: t.lastPrice, priceChangePercent: (parseFloat(t.price24hPcnt) * 100).toFixed(2) };
    },
    // 2. Binance
    async () => {
      const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
      const d = await r.json();
      return { lastPrice: d.lastPrice, priceChangePercent: d.priceChangePercent };
    },
  ];

  for (const fn of sources) {
    try {
      const data = await fn();
      res.status(200).json({ ok: true, data });
      return;
    } catch(e) {
      console.warn('[ticker proxy]', e.message);
    }
  }

  res.status(502).json({ ok: false, error: 'Ticker tidak tersedia' });
}
