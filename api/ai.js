// ============================================================
// /api/ai.js — Vercel Serverless
// Gabungan: groq.js + openrouter.js
//
// Routes via ?action=...
//   POST ?action=groq        → Groq API proxy
//   POST ?action=openrouter  → OpenRouter API proxy
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.query;

  // ── groq ─────────────────────────────────────────────────
  if (action === 'groq') {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY tidak dikonfigurasi di server' });

    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify(req.body)
      });
      const data = await r.json();
      return res.status(r.status).json(data);
    } catch (e) {
      return res.status(500).json({ error: 'Gagal menghubungi Groq API: ' + e.message });
    }
  }

  // ── openrouter ───────────────────────────────────────────
  if (action === 'openrouter') {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'OPENROUTER_API_KEY tidak dikonfigurasi di server' });

    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://z-wealth.vercel.app',
          'X-Title': 'z-wealth',
        },
        body: JSON.stringify(req.body),
      });
      const data = await r.json();
      return res.status(r.status).json(data);
    } catch (e) {
      return res.status(500).json({ error: 'Gagal menghubungi OpenRouter API: ' + e.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action', available: ['groq', 'openrouter'] });
}
