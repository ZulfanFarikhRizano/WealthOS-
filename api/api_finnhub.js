// hhhVercel Serverless Function — proxy Finnhub Economic Calendar
// Environment variable di Vercel: FINNHUB_API_KEY

export default async function handler(req, res) {
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

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const url = `https://finnhub.io/api/v1/calendar/economic?from=${dateFrom}&to=${dateTo}&token=${apiKey}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Finnhub API error: ${response.status}`);
    }

    const data = await response.json();

    // Cache 1 jam di Vercel CDN edge
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json(data);

  } catch (err) {
    console.error('Finnhub proxy error:', err);
    return res.status(502).json({ error: 'Failed to fetch Finnhub data', detail: err.message });
  }
}
