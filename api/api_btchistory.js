// Vercel Serverless Function — proxy BTC full historical price data
// File: /api/btchistory.js
// Fetches from CoinGecko server-side → no user IP rate limit, full history from 2010
// Optional env var: COINGECKO_API_KEY (for Pro tier, higher rate limits)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const apiKey = process.env.COINGECKO_API_KEY || '';
    const headers = { 'Accept': 'application/json', 'User-Agent': 'z-wealth/1.0' };
    if (apiKey) headers['x-cg-pro-api-key'] = apiKey;

    // Full history, weekly interval — most comprehensive for Power Law chart
    const url = 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart' +
                '?vs_currency=usd&days=max&interval=weekly';

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) throw new Error(`CoinGecko ${response.status}`);

    const data = await response.json();
    if (!data?.prices?.length) throw new Error('Empty prices array');

    // Cache 6 hours on Vercel CDN edge — weekly data doesn't change often
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
    return res.status(200).json({
      prices: data.prices,   // [[timestamp_ms, price_usd], ...]
      source: 'coingecko',
      count:  data.prices.length
    });

  } catch (err) {
    console.error('[btchistory]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
