// ╔══════════════════════════════════════════════════════════════╗
// ║  z-wealth · Supabase Edge Function: send-push               ║
// ║  Path: supabase/functions/send-push/index.ts                ║
// ║  Trigger: Database Webhook saat INSERT ke tabel messages     ║
// ╚══════════════════════════════════════════════════════════════╝

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── VAPID CONFIG ──
// Ganti dengan VAPID keys kamu (sudah digenerate)
const VAPID_PUBLIC_KEY  = 'BCjuhvgFLrxeEY_lI3K2ssgr2MdZSKRSoqSXE5VaRwW_efsoQkw0Ph4QEn_F8iJPE_9rNAVGSUzA-gL6z32FnmI';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT     = 'mailto:admin@z-wealth.netlify.app';

// ── SUPABASE CLIENT ──
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SERVICE_ROLE_KEY')!
);

// ════════════════════════════════════════════
//  MAIN HANDLER
// ════════════════════════════════════════════
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  try {
    const body = await req.json();

    // Payload dari Database Webhook (INSERT ke messages)
    // atau bisa dipanggil manual dari client
    const record = body.record || body;

    const {
      id: msgId,
      room_id,
      sender_code,
      content,
      media_url,
      created_at
    } = record;

    if (!room_id) {
      return new Response(JSON.stringify({ error: 'No room_id' }), { status: 400 });
    }

    // ── Ambil info room ──
    const { data: room } = await supabase
      .from('chat_rooms')
      .select('name, type')
      .eq('id', room_id)
      .single();

    // ── Ambil semua subscriber di room ini (kecuali pengirim) ──
    const { data: members } = await supabase
      .from('room_members')
      .select('user_code')
      .eq('room_id', room_id)
      .neq('user_code', sender_code);

    if (!members || members.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: 'no members' }), { status: 200 });
    }

    const memberCodes = members.map((m: any) => m.user_code);

    // ── Ambil push subscriptions untuk semua member ──
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('*')
      .in('user_code', memberCodes);

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: 'no subscriptions' }), { status: 200 });
    }

    // ── Build payload notifikasi ──
    const roomName = room?.name || 'Chat';
    const msgBody  = content
      ? (content.length > 80 ? content.slice(0, 80) + '…' : content)
      : media_url ? '📎 Foto/video' : 'Pesan baru';

    const notifTitle = room?.type === 'dm'
      ? `💬 DM dari ${sender_code}`
      : `💬 ${roomName}`;

    const pushPayload = JSON.stringify({
      title:  notifTitle,
      body:   `${room?.type === 'dm' ? '' : sender_code + ': '}${msgBody}`,
      icon:   '/icon-192.png',
      badge:  '/icon-192.png',
      tag:    'room-' + room_id,
      roomId: room_id,
      url:    '/?page=chat&room=' + room_id,
    });

    // ── Kirim push ke setiap subscriber ──
    let sent = 0;
    let failed = 0;
    const expiredSubs: string[] = [];

    for (const sub of subs) {
      try {
        const result = await sendWebPush(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth:   sub.auth,
            }
          },
          pushPayload
        );

        if (result.status === 201 || result.status === 200) {
          sent++;
        } else if (result.status === 410 || result.status === 404) {
          // Subscription expired — hapus dari DB
          expiredSubs.push(sub.id);
          failed++;
        } else {
          console.error('Push failed:', result.status, await result.text());
          failed++;
        }
      } catch (err) {
        console.error('Push error:', err);
        failed++;
      }
    }

    // Bersihkan expired subscriptions
    if (expiredSubs.length > 0) {
      await supabase.from('push_subscriptions').delete().in('id', expiredSubs);
    }

    return new Response(
      JSON.stringify({ sent, failed, total: subs.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('Edge function error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

// ════════════════════════════════════════════
//  WEB PUSH SENDER (manual VAPID, no library)
//  Menggunakan Web Crypto API yang ada di Deno
// ════════════════════════════════════════════

async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string
): Promise<Response> {

  const { endpoint, keys } = subscription;
  const { p256dh, auth }   = keys;

  // ── 1. Encode payload dengan ECDH + AES-GCM ──
  const encrypted = await encryptPayload(payload, p256dh, auth);

  // ── 2. Build VAPID Authorization header ──
  const vapidHeaders = await buildVAPIDHeaders(endpoint);

  // ── 3. Kirim ke push service ──
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      ...vapidHeaders,
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length':   encrypted.byteLength.toString(),
      'TTL':              '86400',  // 24 jam
    },
    body: encrypted,
  });
}

// ── ENCRYPT PAYLOAD (RFC 8291 / aes128gcm) ──
async function encryptPayload(
  plaintext: string,
  p256dhBase64url: string,
  authBase64url: string
): Promise<ArrayBuffer> {

  const encoder = new TextEncoder();

  // Decode subscription keys
  const receiverPublicKey = base64urlDecode(p256dhBase64url);
  const authSecret        = base64urlDecode(authBase64url);

  // Generate sender (ephemeral) ECDH key pair
  const senderKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  // Import receiver public key
  const receiverKey = await crypto.subtle.importKey(
    'raw',
    receiverPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // ECDH shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverKey },
    senderKeyPair.privateKey,
    256
  );

  // Export sender public key (uncompressed, 65 bytes)
  const senderPublicKeyRaw = await crypto.subtle.exportKey('raw', senderKeyPair.publicKey);

  // Salt (16 bytes random)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF extract + expand (RFC 8291)
  const prk = await hkdfExtract(authSecret, sharedSecret);

  // Key material
  const keyInfo = concat([
    encoder.encode('WebPush: info\x00'),
    new Uint8Array(receiverPublicKey),
    new Uint8Array(senderPublicKeyRaw),
  ]);
  const ikm = await hkdfExpand(prk, keyInfo, 32);

  // Content encryption key (CEK) and nonce
  const cekInfo   = encoder.encode('Content-Encoding: aes128gcm\x00');
  const nonceInfo = encoder.encode('Content-Encoding: nonce\x00');

  const cekPrk   = await hkdfExtract(salt, ikm);
  const cek      = await hkdfExpand(cekPrk, cekInfo,   16);
  const nonce    = await hkdfExpand(cekPrk, nonceInfo, 12);

  // Import AES-GCM key
  const aesKey = await crypto.subtle.importKey(
    'raw', cek, { name: 'AES-GCM' }, false, ['encrypt']
  );

  // Pad plaintext: plaintext + \x02 delimiter
  const plaintextBytes = encoder.encode(plaintext);
  const padded = concat([plaintextBytes, new Uint8Array([2])]);

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    aesKey,
    padded
  );

  // Build aes128gcm content (RFC 8188):
  // salt (16) + rs (4, big-endian) + idlen (1) + keyid (65) + ciphertext
  const rs = 4096;
  const keyId = new Uint8Array(senderPublicKeyRaw);
  const header = new ArrayBuffer(16 + 4 + 1 + keyId.length);
  const view = new DataView(header);

  new Uint8Array(header).set(salt, 0);
  view.setUint32(16, rs, false);
  view.setUint8(20, keyId.length);
  new Uint8Array(header).set(keyId, 21);

  return concat([new Uint8Array(header), new Uint8Array(ciphertext)]).buffer;
}

// ── VAPID JWT ──
async function buildVAPIDHeaders(endpoint: string): Promise<Record<string, string>> {
  const audience = new URL(endpoint).origin;
  const expiry   = Math.floor(Date.now() / 1000) + 12 * 3600; // 12 jam

  const header  = base64urlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = base64urlEncode(JSON.stringify({ aud: audience, exp: expiry, sub: VAPID_SUBJECT }));
  const unsigned = `${header}.${payload}`;

  // Import VAPID private key
  const privateKeyBytes = base64urlDecode(VAPID_PRIVATE_KEY);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    buildPKCS8(privateKeyBytes),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const encoder    = new TextEncoder();
  const signatureRaw = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(unsigned)
  );

  const jwt = `${unsigned}.${base64urlEncode(new Uint8Array(signatureRaw))}`;

  return {
    'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
  };
}

// ── HKDF helpers ──
async function hkdfExtract(salt: Uint8Array | ArrayBuffer, ikm: ArrayBuffer): Promise<ArrayBuffer> {
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', saltKey, ikm);
}
async function hkdfExpand(prk: ArrayBuffer, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const t = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, concat([info, new Uint8Array([1])])));
  return t.slice(0, length);
}

// ── Utils ──
function base64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function base64urlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let b = '';
  bytes.forEach(b2 => b += String.fromCharCode(b2));
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}
function buildPKCS8(rawPrivateKey: Uint8Array): ArrayBuffer {
  // Wrap raw 32-byte EC private key into PKCS8 DER format for P-256
  const prefix = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20
  ]);
  return concat([prefix, rawPrivateKey]).buffer;
                                                            }
