// /api/ticker.js — Vercel Serverless Proxy untuk harga ticker
// Browser fetch /api/ticker?symbol=BTCUSDT

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=5'); // cache 5 detik

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { symbol = 'BTCUSDT' } = req.query;

  // ── XAUUSD — OKX XAU-USDT (Bybit spot & Binance tidak punya pair ini) ──
  if (symbol === 'XAUUSD') {
    try {
      const r = await fetch('https://www.okx.com/api/v5/market/ticker?instId=XAU-USDT');
      const d = await r.json();
      if (d.code !== '0') throw new Error('OKX: ' + d.msg);
      const t = d.data[0];
      const open = parseFloat(t.sodUtc8);
      const last = parseFloat(t.last);
      const pct = open > 0 ? ((last - open) / open * 100).toFixed(2) : '0';
      return res.status(200).json({ ok: true, data: { lastPrice: String(last), priceChangePercent: pct } });
    } catch(e) {
      console.warn('[ticker/XAUUSD OKX]', e.message);
      return res.status(502).json({ ok: false, error: 'Ticker XAU tidak tersedia' });
    }
  }

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
