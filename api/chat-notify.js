// /api/chat-notify.js
// Supabase Webhook → FCM Push Notification untuk chat
// Setup: Supabase Dashboard → Database → Webhooks → messages table INSERT

export default async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  console.log('[chat-notify] 🔔 Webhook received:', req.method, new Date().toISOString());
  console.log('[chat-notify] Body keys:', Object.keys(req.body || {}));
  console.log('[chat-notify] ENV check - SERVICE_KEY:', !!process.env.SUPABASE_SERVICE_KEY, '| WEBHOOK_SECRET:', !!process.env.SUPABASE_WEBHOOK_SECRET);
  
  try {
    // ── 1. Verifikasi webhook secret (keamanan) ──
    const webhookSecret = process.env.SUPABASE_WEBHOOK_SECRET;
    if (webhookSecret) {
      const authHeader = req.headers['authorization'] || req.headers['x-webhook-secret'] || '';
      const token = authHeader.replace('Bearer ', '').trim();
      if (token !== webhookSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    // ── 2. Ambil data pesan dari webhook payload ──
    const payload = req.body;
    
    // Supabase webhook format: { type, table, schema, record, old_record }
    // type = INSERT / UPDATE / DELETE
    const record = payload?.record || payload?.new || payload;
    const eventType = payload?.type || 'INSERT';
    
    // Hanya proses INSERT
    if (eventType !== 'INSERT') {
      return res.status(200).json({ skipped: true, reason: 'Not INSERT event' });
    }

    const { room_id, sender_code, content, media_url, media_type } = record || {};

    if (!room_id || !sender_code) {
      console.log('[chat-notify] Missing fields, payload:', JSON.stringify(payload).slice(0, 200));
      return res.status(400).json({ error: 'Missing room_id or sender_code', payload_keys: Object.keys(payload || {}) });
    }

    // ── 3. Query Supabase untuk ambil data room dan FCM tokens ──
    const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://kpikyqafapclyirpqflp.supabase.co';
    const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
    
    if (!SUPABASE_KEY) {
      console.error('[chat-notify] SUPABASE_SERVICE_KEY not set!');
      return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY env not configured' });
    }
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    };

    // Ambil info room
    const roomRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_rooms?id=eq.${room_id}&select=name,type`,
      { headers }
    );
    const rooms = await roomRes.json();
    const room = rooms?.[0];
    const roomName = room?.name || 'Chat';
    const roomType = room?.type || 'public';

    // Buat preview pesan
    let msgPreview = '';
    if (content)   msgPreview = content.slice(0, 80);
    else if (media_url) {
      if (media_type?.startsWith('image')) msgPreview = '📷 Foto';
      else if (media_type?.startsWith('video')) msgPreview = '🎥 Video';
      else msgPreview = '📎 Media';
    } else { msgPreview = '...'; }

    const notifTitle = roomType === 'dm'
      ? `💬 ${sender_code}`
      : `💬 ${roomName}`;
    const notifBody = roomType === 'dm'
      ? msgPreview
      : `${sender_code}: ${msgPreview}`;

    // ── 4. Ambil semua FCM token kecuali pengirim ──
    const tokenRes = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?select=fcm_token,user_code&fcm_token=not.is.null&order=updated_at.desc`,
      { headers }
    );
    const tokenRows = await tokenRes.json();

    console.log('[chat-notify] FCM tokens found:', tokenRows?.length || 0);
    if (!tokenRows?.length) {
      return res.status(200).json({ sent: 0, message: 'No FCM tokens found' });
    }

    // Deduplicate: 1 token terbaru per user (hindari double notif)
    const userTokenMap = new Map();
    for (const r of tokenRows) {
      if (r.user_code && r.fcm_token && !userTokenMap.has(r.user_code)) {
        userTokenMap.set(r.user_code, r.fcm_token);
      }
    }
    // Filter: jangan kirim ke pengirim sendiri
    const tokens = [...userTokenMap.entries()]
      .filter(([userCode]) => userCode !== sender_code)
      .map(([, token]) => token)
      .filter(Boolean);

    if (!tokens.length) {
      return res.status(200).json({ sent: 0, message: 'No recipients' });
    }

    // ── 5. Kirim FCM push ke semua token ──
    const accessToken = await getAccessToken();
    const PROJECT_ID = 'z-wealth';

    let sent = 0, failed = 0;
    const invalidTokens = [];

    // Kirim ke setiap token (FCM v1 tidak support multicast langsung)
    await Promise.allSettled(tokens.map(async (token) => {
      try {
        const fcmRes = await fetch(
          `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              message: {
                token,
                // Data-only message — SW yang handle tampilan (hindari double notif)
                webpush: {
                  notification: {
                    title: notifTitle,
                    body:  notifBody,
                    icon:  '/icon-192.png',
                    badge: '/icon-192.png',
                    tag:   `chat-${room_id}`,
                    renotify: true,
                    vibrate: [200, 100, 200],
                  },
                  fcm_options: { link: '/' },
                },
                data: {
                  room_id: String(room_id),
                  sender:  sender_code,
                  type:    'chat',
                  title:   notifTitle,
                  body:    notifBody,
                },
              }
            })
          }
        );
        const result = await fcmRes.json();
        if (fcmRes.ok) {
          sent++;
        } else {
          failed++;
          // Tandai token invalid untuk dihapus
          const errCode = result?.error?.details?.[0]?.errorCode;
          if (errCode === 'UNREGISTERED' || errCode === 'INVALID_ARGUMENT') {
            invalidTokens.push(token);
          }
        }
      } catch(e) { failed++; }
    }));

    // ── 6. Hapus token invalid dari DB ──
    if (invalidTokens.length > 0) {
      for (const t of invalidTokens) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/push_subscriptions?fcm_token=eq.${encodeURIComponent(t)}`,
          { method: 'DELETE', headers }
        ).catch(() => {});
      }
    }

    console.log('[chat-notify] ✅ Result:', { sent, failed, removed: invalidTokens.length, room: roomName });
    return res.status(200).json({
      sent,
      failed,
      removed_invalid: invalidTokens.length,
      room: roomName,
      sender: sender_code,
    });

  } catch (err) {
    console.error('[chat-notify] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── OAuth2 Access Token dari Service Account (sama seperti notify.js) ──
async function getAccessToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  const sa = JSON.parse(raw);

  const now    = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim  = b64url(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));

  const sigInput  = `${header}.${claim}`;
  const key       = await importPrivateKey(sa.private_key);
  const sigBuffer = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(sigInput)
  );
  const sig = b64url(sigBuffer);
  const jwt = `${sigInput}.${sig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('OAuth2 failed: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

async function importPrivateKey(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', bin.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

function b64url(input) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input instanceof ArrayBuffer ? input : input.buffer ?? input);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
