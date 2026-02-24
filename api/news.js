export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const NEWS_KEY = process.env.NEWSAPI_KEY;
  if (!NEWS_KEY) return res.status(500).json({ error: 'NEWSAPI_KEY tidak dikonfigurasi' });

  try {
    const url = `https://newsapi.org/v2/everything?q=bitcoin+OR+crypto+OR+ethereum+OR+blockchain&language=en&sortBy=publishedAt&pageSize=15&apiKey=${NEWS_KEY}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `NewsAPI error: ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: 'Gagal menghubungi NewsAPI: ' + error.message });
  }
}
