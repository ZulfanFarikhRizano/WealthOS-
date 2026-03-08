// ============================================================
// /api/livekit.js — Vercel Serverless
// Generate LiveKit access token untuk user z-wealth
//
// GET ?room=general&identity=user_code
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const API_KEY    = process.env.LIVEKIT_API_KEY;
  const API_SECRET = process.env.LIVEKIT_SECRET;
  const LK_URL     = process.env.LIVEKIT_URL;

  if (!API_KEY || !API_SECRET || !LK_URL)
    return res.status(500).json({ error: 'LIVEKIT env vars not set' });

  const { room, identity } = req.query;
  if (!room || !identity)
    return res.status(400).json({ error: 'room dan identity wajib' });

  // Sanitasi: hanya alfanumerik, dash, underscore
  const safeRoom     = room.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
  const safeIdentity = identity.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);

  try {
    const token = await _generateToken(API_KEY, API_SECRET, safeRoom, safeIdentity);
    return res.status(200).json({ token, url: LK_URL, room: safeRoom });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── JWT token generator (tanpa npm package, pakai Web Crypto) ──
async function _generateToken(apiKey, apiSecret, room, identity) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3 * 3600; // 3 jam

  // LiveKit VideoGrant
  const grant = {
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };

  const header  = _b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = _b64u(JSON.stringify({
    iss: apiKey,
    sub: identity,
    iat: now,
    exp,
    nbf: now,
    name: identity,
    video: grant,
  }));

  const sigInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sigInput));
  return `${sigInput}.${_b64u(sig)}`;
}

function _b64u(input) {
  const b = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input instanceof ArrayBuffer ? input : input.buffer ?? input);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
