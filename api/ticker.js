// /api/ticker.js — Vercel serverless proxy untuk ticker/harga live
// Server-side: tidak kena CORS, bisa fetch Binance/OKX/Bybit bebas

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });

  // ── XAUUSD — route ke OKX ──
  if (symbol === 'XAUUSD') {
    // 1. OKX XAU-USDT spot
    try {
      const r = await fetch('https://www.okx.com/api/v5/market/ticker?instId=XAU-USDT', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000)
      });
      const d = await r.json();
      if (d.code === '0' && d.data?.length) {
        const t = d.data[0];
        const open = parseFloat(t.sodUtc8);
        const last = parseFloat(t.last);
        const pct = open > 0 ? ((last - open) / open * 100).toFixed(2) : '0';
        return res.json({ ok: true, data: { lastPrice: String(last), priceChangePercent: pct }, source: 'okx' });
      }
    } catch (e) { console.warn('[ticker/OKX XAU]', e.message); }

    // 2. Bybit XAUUSDT linear
    try {
      const r = await fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=XAUUSDT', {
        signal: AbortSignal.timeout(6000)
      });
      const d = await r.json();
      if (d.retCode === 0 && d.result?.list?.length) {
        const t = d.result.list[0];
        return res.json({
          ok: true,
          data: { lastPrice: t.lastPrice, priceChangePercent: (parseFloat(t.price24hPcnt) * 100).toFixed(2) },
          source: 'bybit'
        });
      }
    } catch (e) { console.warn('[ticker/Bybit XAUUSDT]', e.message); }

    return res.status(502).json({ ok: false, error: 'XAU ticker unavailable' });
  }

  // ── CRYPTO pairs ──

  // 1. Binance (server-side bebas CORS)
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, {
      signal: AbortSignal.timeout(6000)
    });
    if (r.ok) {
      const d = await r.json();
      if (d.lastPrice) {
        return res.json({
          ok: true,
          data: { lastPrice: d.lastPrice, priceChangePercent: parseFloat(d.priceChangePercent).toFixed(2) },
          source: 'binance'
        });
      }
    }
  } catch (e) { console.warn('[ticker/Binance]', e.message); }

  // 2. Bybit
  try {
    const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`, {
      signal: AbortSignal.timeout(6000)
    });
    const d = await r.json();
    if (d.retCode === 0 && d.result?.list?.length) {
      const t = d.result.list[0];
      return res.json({
        ok: true,
        data: { lastPrice: t.lastPrice, priceChangePercent: (parseFloat(t.price24hPcnt) * 100).toFixed(2) },
        source: 'bybit'
      });
    }
  } catch (e) { console.warn('[ticker/Bybit]', e.message); }

  // 3. OKX
  try {
    const instId = symbol.replace('USDT', '-USDT');
    const r = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, {
      signal: AbortSignal.timeout(6000)
    });
    const d = await r.json();
    if (d.code === '0' && d.data?.length) {
      const t = d.data[0];
      const open = parseFloat(t.sodUtc8);
      const last = parseFloat(t.last);
      const pct = open > 0 ? ((last - open) / open * 100).toFixed(2) : '0';
      return res.json({ ok: true, data: { lastPrice: String(last), priceChangePercent: pct }, source: 'okx' });
    }
  } catch (e) { console.warn('[ticker/OKX]', e.message); }

  return res.status(502).json({ ok: false, error: 'All sources failed' });
}
