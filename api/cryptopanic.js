export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const CP_KEY = process.env.CRYPTOPANIC_API_KEY;

  if (!CP_KEY) {
    return res.status(500).json({ error: 'CRYPTOPANIC_API_KEY tidak dikonfigurasi di server' });
  }

  try {
    const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${CP_KEY}&public=true&kind=news&regions=en&filter=hot`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `CryptoPanic error: ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: 'Gagal menghubungi CryptoPanic: ' + error.message });
  }
}
