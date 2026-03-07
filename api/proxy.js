// api/proxy.js — Vercel serverless proxy untuk bypass CORS
// Menggantikan api.allorigins.win yang diblokir
export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Whitelist domain yang boleh di-proxy (keamanan)
  const allowed = [
    'fred.stlouisfed.org',
    'api.stlouisfed.org',
    'query1.finance.yahoo.com',
    'api.coingecko.com',
    'api.binance.com',       // FIX: dipakai app.js untuk klines & ticker fallback
    'www.okx.com',           // FIX: dipakai app.js untuk klines & ticker fallback
  ];

  let targetUrl;
  try {
    targetUrl = new URL(decodeURIComponent(url));
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const isAllowed = allowed.some(d => targetUrl.hostname.endsWith(d));
  if (!isAllowed) {
    return res.status(403).json({ error: 'Domain not allowed: ' + targetUrl.hostname });
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; z-wealth-proxy/1.0)',
        'Accept': '*/*',
      },
      signal: AbortSignal.timeout(10000),
    });

    const contentType = response.headers.get('content-type') || 'text/plain';
    const text = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', contentType);
    return res.status(response.status).send(text);

  } catch (err) {
    return res.status(502).json({ error: 'Proxy fetch failed: ' + err.message });
  }
}
