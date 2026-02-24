export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const CP_KEY = process.env.CRYPTOPANIC_API_KEY;
  if (!CP_KEY) return res.status(500).json({ error: 'CRYPTOPANIC_API_KEY tidak dikonfigurasi' });

  // Coba beberapa endpoint (free tier & v1)
  const endpoints = [
    `https://cryptopanic.com/api/free/v1/posts/?auth_token=${CP_KEY}&public=true&kind=news&filter=hot`,
    `https://cryptopanic.com/api/v1/posts/?auth_token=${CP_KEY}&public=true&kind=news&filter=hot`,
    `https://cryptopanic.com/api/free/v1/posts/?auth_token=${CP_KEY}&public=true`,
  ];

  let lastError = '';

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; ZWealth/1.0)'
        }
      });

      if (response.ok) {
        const data = await response.json();
        return res.status(200).json(data);
      }

      lastError = `HTTP ${response.status}`;
      console.error('[CryptoPanic]', lastError, url);

    } catch (e) {
      lastError = e.message;
    }
  }

  return res.status(502).json({ error: 'CryptoPanic tidak tersedia: ' + lastError });
}
