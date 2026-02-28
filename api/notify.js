// ═══════════════════════════════════════════════════════
// /api/notify.js — Vercel Serverless Function
// Simpan file ini di: /api/notify.js (di root project kamu)
// 
// Di Vercel Dashboard → Settings → Environment Variables, tambahkan:
//   FIREBASE_SERVER_KEY = (dari Firebase Console → Project Settings → Cloud Messaging → Server key)
// ═══════════════════════════════════════════════════════

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, title, body, tag, url, data } = req.body || {};

  if (!token || !title) {
    return res.status(400).json({ error: 'token dan title wajib diisi' });
  }

  const serverKey = process.env.FIREBASE_SERVER_KEY;
  if (!serverKey) {
    return res.status(500).json({ error: 'FIREBASE_SERVER_KEY belum diset di Vercel env' });
  }

  const payload = {
    to: token,
    notification: {
      title,
      body: body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: tag || 'zwealth-' + Date.now(),
      click_action: url || '/'
    },
    data: {
      tag: tag || '',
      url: url || '/',
      ...(data || {})
    },
    webpush: {
      headers: { Urgency: 'high' },
      notification: {
        title,
        body: body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: tag || 'zwealth-' + Date.now(),
        renotify: true,
        vibrate: [200, 100, 200]
      }
    }
  };

  try {
    const fcmRes = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Authorization': `key=${serverKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await fcmRes.json();

    if (result.failure > 0) {
      console.error('[FCM] Gagal kirim:', result);
      return res.status(500).json({ error: 'FCM gagal', detail: result });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('[FCM] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
