// ============================================================
// /api/notifications.js — Vercel Serverless
// Gabungan: notify.js + chat-notify.js
//
// Routes via ?action=...
//   POST ?action=notify       → Kirim FCM push ke 1 token
//   POST ?action=chat-notify  → Supabase webhook → FCM push chat
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.query;

  // ── notify ───────────────────────────────────────────────
  if (action === 'notify') {
    const { token, title, body, tag, url } = req.body || {};
    if (!token || !title) return res.status(400).json({ error: 'token dan title wajib' });

    let sa;
    try {
      sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
      if (!sa.private_key || !sa.client_email) throw new Error('SA tidak valid');
    } catch(e) {
      return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT tidak valid' });
    }

    try {
      const at = await _getAccessToken(sa);
      const r  = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: {
          token,
          notification: { title, body: body||'' },
          webpush: {
            headers: { Urgency: 'high' },
            notification: { title, body:body||'', icon:'/icon-192.png', badge:'/icon-192.png', tag:tag||('zw-'+Date.now()), renotify:true, vibrate:[200,100,200] },
            fcm_options: { link: url||'/' }
          },
          data: { tag:tag||'', url:url||'/' }
        }})
      });
      const result = await r.json();
      if (!r.ok) return res.status(500).json({ error: 'FCM gagal', detail: result });
      return res.status(200).json({ success: true, result });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── chat-notify ──────────────────────────────────────────
  if (action === 'chat-notify') {
    // 1. Verifikasi webhook secret
    const wSecret = process.env.SUPABASE_WEBHOOK_SECRET;
    if (wSecret) {
      const tok = (req.headers['authorization'] || req.headers['x-webhook-secret'] || '').replace('Bearer ','').trim();
      if (tok !== wSecret) return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload   = req.body;
    const record    = payload?.record || payload?.new || payload;
    const eventType = payload?.type || 'INSERT';
    if (eventType !== 'INSERT') return res.status(200).json({ skipped: true, reason: 'Not INSERT event' });

    const { room_id, sender_code, content, media_url, media_type } = record || {};
    if (!room_id || !sender_code) return res.status(400).json({ error: 'Missing room_id or sender_code' });

    const SB_URL = process.env.SUPABASE_URL || 'https://kpikyqafapclyirpqflp.supabase.co';
    const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SB_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });

    const sbH = { 'Content-Type':'application/json', 'apikey':SB_KEY, 'Authorization':`Bearer ${SB_KEY}` };

    try {
      // 2. Info room
      const room     = (await (await fetch(`${SB_URL}/rest/v1/chat_rooms?id=eq.${room_id}&select=name,type`,{headers:sbH})).json())?.[0];
      const roomName = room?.name || 'Chat';
      const roomType = room?.type || 'public';

      const preview    = content ? content.slice(0,80)
        : media_url ? (media_type?.startsWith('image')?'📷 Foto':media_type?.startsWith('video')?'🎥 Video':'📎 Media') : '...';
      const notifTitle = roomType==='dm' ? `💬 ${sender_code}` : `💬 ${roomName}`;
      const notifBody  = roomType==='dm' ? preview : `${sender_code}: ${preview}`;

      // 3. FCM tokens (kecuali pengirim)
      const tokenRows = await (await fetch(`${SB_URL}/rest/v1/push_subscriptions?select=fcm_token,user_code&fcm_token=not.is.null`,{headers:sbH})).json();
      const tokens    = (tokenRows||[]).filter(r => r.user_code !== sender_code && r.fcm_token).map(r => r.fcm_token);
      if (!tokens.length) return res.status(200).json({ sent: 0, message: 'No recipients' });

      // 4. Kirim FCM
      const at = await _getAccessToken();
      let sent = 0, failed = 0;
      const invalid = [];

      await Promise.allSettled(tokens.map(async token => {
        try {
          const r = await fetch('https://fcm.googleapis.com/v1/projects/z-wealth/messages:send', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${at}` },
            body: JSON.stringify({ message: {
              token,
              notification: { title:notifTitle, body:notifBody },
              webpush: {
                notification: { title:notifTitle, body:notifBody, icon:'/icon-192.png', badge:'/icon-192.png', tag:`chat-${room_id}`, renotify:true, vibrate:[200,100,200] },
                fcm_options: { link:'/' }
              },
              data: { room_id: String(room_id), sender: sender_code, type: 'chat' }
            }})
          });
          const result = await r.json();
          if (r.ok) { sent++; }
          else {
            failed++;
            const ec = result?.error?.details?.[0]?.errorCode;
            if (ec==='UNREGISTERED'||ec==='INVALID_ARGUMENT') invalid.push(token);
          }
        } catch(e) { failed++; }
      }));

      // 5. Hapus token invalid
      for (const t of invalid)
        await fetch(`${SB_URL}/rest/v1/push_subscriptions?fcm_token=eq.${encodeURIComponent(t)}`,{method:'DELETE',headers:sbH}).catch(()=>{});

      return res.status(200).json({ sent, failed, removed_invalid: invalid.length, room: roomName });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action', available: ['notify','chat-notify'] });
}

// ── Shared helpers ────────────────────────────────────────
async function _getAccessToken(sa) {
  if (!sa) sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now()/1000);
  const hdr = _b64u(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const clm = _b64u(JSON.stringify({iss:sa.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const sig = _b64u(await crypto.subtle.sign({name:'RSASSA-PKCS1-v1_5'}, await _importKey(sa.private_key), new TextEncoder().encode(`${hdr}.${clm}`)));
  const t = await (await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${hdr}.${clm}.${sig}`})})).json();
  if (!t.access_token) throw new Error('OAuth2 failed');
  return t.access_token;
}

async function _importKey(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
  return crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(b64),c=>c.charCodeAt(0)).buffer, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']);
}

function _b64u(input) {
  const b = typeof input==='string' ? new TextEncoder().encode(input) : new Uint8Array(input instanceof ArrayBuffer ? input : input.buffer??input);
  let s=''; for (const x of b) s+=String.fromCharCode(x);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
