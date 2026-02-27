// /api/klines.js — Vercel Serverless Proxy
// Browser fetch /api/klines?symbol=BTCUSDT&interval=1h&limit=150
// Server fetch dari Bybit (tidak diblokir dari server Vercel)

export default async function handler(req, res) {
  // CORS headers — izinkan semua origin (domain sendiri)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=10'); // cache 10 detik

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { symbol = 'BTCUSDT', interval = '1h', limit = '150' } = req.query;

  // ── XAUUSD — OKX XAU-USDT (Bybit/Binance tidak punya pair ini) ──
  if (symbol === 'XAUUSD') {
    const OKX_TF = {'1m':'1m','5m':'5m','15m':'15m','1h':'1H','4h':'4H','1d':'1Dutc','1w':'1Wutc'};
    const bar = OKX_TF[interval] || '1H';
    try {
      const r = await fetch(`https://www.okx.com/api/v5/market/candles?instId=XAU-USDT&bar=${bar}&limit=${limit}`);
      const d = await r.json();
      if (d.code !== '0') throw new Error('OKX: ' + d.msg);
      const data = d.data.reverse().map(k => [
        parseInt(k[0]), parseFloat(k[1]), parseFloat(k[2]),
        parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])
      ]);
      return res.status(200).json({ ok: true, data });
    } catch(e) {
      console.warn('[klines/XAUUSD OKX]', e.message);
      return res.status(502).json({ ok: false, error: 'Data XAU tidak tersedia' });
    }
  }

  // Mapping interval ke format Bybit
  const TF = {
    '1m':'1','3m':'3','5m':'5','15m':'15','30m':'30',
    '1h':'60','2h':'120','4h':'240','6h':'360','12h':'720',
    '1d':'D','1w':'W','1M':'M'
  };
  const bybitTf = TF[interval] || '60';

  const sources = [
    // 1. Bybit
    async () => {
      const r = await fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${bybitTf}&limit=${limit}`);
      const d = await r.json();
      if (d.retCode !== 0) throw new Error('Bybit: ' + d.retMsg);
      // Normalize ke format [timestamp, open, high, low, close, volume]
      return d.result.list.reverse().map(k => [
        parseInt(k[0]), parseFloat(k[1]), parseFloat(k[2]),
        parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])
      ]);
    },
    // 2. OKX
    async () => {
      const OKX_TF = {'1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','4h':'4H','1d':'1Dutc','1w':'1Wutc'};
      const instId = symbol.replace('USDT', '-USDT');
      const bar = OKX_TF[interval] || '1H';
      const r = await fetch(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`);
      const d = await r.json();
      if (d.code !== '0') throw new Error('OKX: ' + d.msg);
      return d.data.reverse().map(k => [
        parseInt(k[0]), parseFloat(k[1]), parseFloat(k[2]),
        parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])
      ]);
    },
    // 3. Binance (dari server Vercel, tidak kena blokir ISP user)
    async () => {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      const d = await r.json();
      return d.map(k => [
        parseInt(k[0]), parseFloat(k[1]), parseFloat(k[2]),
        parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])
      ]);
    },
  ];

  for (const fn of sources) {
    try {
      const data = await fn();
      res.status(200).json({ ok: true, data });
      return;
    } catch(e) {
      console.warn('[klines proxy]', e.message);
    }
  }

  res.status(502).json({ ok: false, error: 'Semua sumber data gagal' });
}
