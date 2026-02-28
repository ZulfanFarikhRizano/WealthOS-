// ================================================================
// /api/notify.js — Vercel Serverless Function
// Menggunakan FCM HTTP v1 API + Service Account OAuth2
// (Legacy Server Key sudah deprecated sejak 2024)
//
// Setup di Vercel:
// Settings -> Environment Variables -> tambahkan:
//   FIREBASE_SERVICE_ACCOUNT = (paste seluruh isi JSON service account)
// ================================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, title, body, tag, url } = req.body || {};
  if (!token || !title) {
    return res.status(400).json({ error: 'token dan title wajib diisi' });
  }

  let sa;
  try {
    sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!sa.private_key || !sa.client_email) throw new Error('SA tidak valid');
  } catch (e) {
    return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT belum diset atau tidak valid' });
  }

  try {
    const accessToken = await getAccessToken(sa);
    const projectId = sa.project_id;
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    const message = {
      message: {
        token,
        notification: { title, body: body || '' },
        webpush: {
          headers: { Urgency: 'high' },
          notification: {
            title,
            body: body || '',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: tag || ('zw-' + Date.now()),
            renotify: true,
            vibrate: [200, 100, 200],
          },
          fcm_options: { link: url || '/' }
        },
        data: { tag: tag || '', url: url || '/' }
      }
    };

    const fcmRes = await fetch(fcmUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message)
    });

    const result = await fcmRes.json();
    if (!fcmRes.ok) {
      console.error('[FCM v1] Error:', result);
      return res.status(500).json({ error: 'FCM gagal', detail: result });
    }
    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('[FCM v1] Exception:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const header = { alg: 'RS256', typ: 'JWT' };
  const b64Header = b64url(JSON.stringify(header));
  const b64Payload = b64url(JSON.stringify(payload));
  const signingInput = `${b64Header}.${b64Payload}`;

  const privateKey = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${b64url(signature)}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('Gagal dapat access token: ' + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

function b64url(data) {
  let bytes;
  if (typeof data === 'string') bytes = new TextEncoder().encode(data);
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else bytes = data;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem) {
  const pemBody = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    binary.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}
