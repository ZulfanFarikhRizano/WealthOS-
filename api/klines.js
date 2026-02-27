// /api/klines.js — Vercel serverless proxy untuk candlestick data
// Server-side: tidak kena CORS, bisa fetch Binance/OKX/Bybit bebas

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbol, interval, limit = '150' } = req.query;
  if (!symbol || !interval) {
    return res.status(400).json({ ok: false, error: 'symbol and interval required' });
  }

  const lim = Math.min(parseInt(limit) || 150, 500);

  // ── XAUUSD — route ke OKX (satu-satunya exchange besar dengan XAU-USDT) ──
  if (symbol === 'XAUUSD') {
    const OKX_TF = {
      '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m',
      '1h':'1H','2h':'2H','4h':'4H','6h':'6H','12h':'12H',
      '1d':'1Dutc','1w':'1Wutc','1M':'1Mutc'
    };
    const bar = OKX_TF[interval] || '1H';

    // 1. OKX spot XAU-USDT
    try {
      const r = await fetch(
        `https://www.okx.com/api/v5/market/candles?instId=XAU-USDT&bar=${bar}&limit=${lim}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
      );
      const d = await r.json();
      if (d.code === '0' && d.data?.length) {
        const data = d.data.reverse().map(k => [
          parseInt(k[0]), parseFloat(k[1]), parseFloat(k[2]),
          parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])
        ]);
        return res.json({ ok: true, data, source: 'okx' });
      }
    } catch (e) { console.warn('[klines/OKX XAU]', e.message); }

    // 2. Bybit linear XAUUSDT perpetual
    const BYBIT_TF = {
      '1m':'1','5m':'5','15m':'15','30m':'30',
      '1h':'60','4h':'240','1d':'D','1w':'W'
    };
    const tf = BYBIT_TF[interval] || '60';
    try {
      const r = await fetch(
        `https://api.bybit.com/v5/market/kline?category=linear&symbol=XAUUSDT&interval=${tf}&limit=${lim}`,
        { signal: AbortSignal.timeout(8000) }
      );
      const d = await r.json();
      if (d.retCode === 0 && d.result?.list?.length) {
        const data = d.result.list.reverse().map(k => [
          parseInt(k[0]), parseFloat(k[1]), parseFloat(k[2]),
          parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])
        ]);
        return res.json({ ok: true, data, source: 'bybit' });
      }
    } catch (e) { console.warn('[klines/Bybit XAUUSDT]', e.message); }

    // 3. Gate.io XAU_USDT spot
    try {
      const GATE_TF = { '1m':'1m','5m':'5m','15m':'15m','1h':'1h','4h':'4h','1d':'1d' };
      const gInterval = GATE_TF[interval] || '1h';
      const secPerCandle = { '1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400 }[interval] || 3600;
      const from = Math.floor(Date.now() / 1000) - lim * secPerCandle;
      const r = await fetch(
        `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=XAU_USDT&interval=${gInterval}&from=${from}&limit=${lim}`,
        { signal: AbortSignal.timeout(8000) }
      );
      const d = await r.json();
      if (Array.isArray(d) && d.length) {
        // Gate.io: [timestamp_sec, vol, close, high, low, open, ...]
        const data = d.map(k => [
          parseInt(k[0]) * 1000, parseFloat(k[5]), parseFloat(k[3]),
          parseFloat(k[4]), parseFloat(k[2]), parseFloat(k[1])
        ]);
        return res.json({ ok: true, data, source: 'gateio' });
      }
    } catch (e) { console.warn('[klines/Gate.io XAU]', e.message); }

    return res.status(502).json({ ok: false, error: 'XAU data unavailable from all sources' });
  }

  // ── CRYPTO pairs — Binance utama, Bybit/OKX fallback ──

  // 1. Binance (server-side, tidak kena CORS)
  try {
    const r = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${lim}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (r.ok) {
      const d = await r.json();
      if (Array.isArray(d) && d.length) {
        const data = d.map(k => [
          parseInt(k[0]), parseFloat(k[1]), parseFloat(k[2]),
          parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])
        ]);
        return res.json({ ok: true, data, source: 'binance' });
      }
    }
  } catch (e) { console.warn('[klines/Binance]', e.message); }

  // 2. Bybit
  const BYBIT_TF = {
    '1m':'1','3m':'3','5m':'5','15m':'15','30m':'30',
    '1h':'60','2h':'120','4h':'240','6h':'360','12h':'720',
    '1d':'D','1w':'W','1M':'M'
  };
  try {
    const tf = BYBIT_TF[interval] || '60';
    const r = await fetch(
      `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${tf}&limit=${lim}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const d = await r.json();
    if (d.retCode === 0 && d.result?.list?.length) {
      const data = d.result.list.reverse().map(k => [
        parseInt(k[0]), parseFloat(k[1]), parseFloat(k[2]),
        parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])
      ]);
      return res.json({ ok: true, data, source: 'bybit' });
    }
  } catch (e) { console.warn('[klines/Bybit]', e.message); }

  // 3. OKX
  const OKX_TF = {
    '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m',
    '1h':'1H','2h':'2H','4h':'4H','6h':'6H','12h':'12H',
    '1d':'1Dutc','1w':'1Wutc','1M':'1Mutc'
  };
  try {
    const bar = OKX_TF[interval] || '1H';
    const instId = symbol.replace('USDT', '-USDT');
    const r = await fetch(
      `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${lim}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const d = await r.json();
    if (d.code === '0' && d.data?.length) {
      const data = d.data.reverse().map(k => [
        parseInt(k[0]), parseFloat(k[1]), parseFloat(k[2]),
        parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])
      ]);
      return res.json({ ok: true, data, source: 'okx' });
    }
  } catch (e) { console.warn('[klines/OKX]', e.message); }

  return res.status(502).json({ ok: false, error: 'All sources failed' });
}
