// hhhVercel Serverless Function — proxy CoinMarketCal
// Environment variable di Vercel: CMC_API_KEY

export default async function handler(req, res) {
  // CORS headers — izinkan request dari domain apapun
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { dateFrom, dateTo } = req.query;

  if (!dateFrom || !dateTo) {
    return res.status(400).json({ error: 'dateFrom and dateTo required' });
  }

  const apiKey = process.env.CMC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const url = `https://api.coinmarketcal.com/v1/events?access_token=${apiKey}&dateRangeStart=${dateFrom}&dateRangeEnd=${dateTo}&page=1&max=150&showOnly=hot_events`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`CMC API error: ${response.status}`);
    }

    const data = await response.json();

    // Cache 1 jam di Vercel CDN edge — hemat quota API
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json(data);

  } catch (err) {
    console.error('Calendar proxy error:', err);
    return res.status(502).json({ error: 'Failed to fetch calendar data', detail: err.message });
  }
}
