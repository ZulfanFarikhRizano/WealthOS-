// /api/price-check.js
// Vercel Cron Job — jalan setiap 1 menit
// Cek price alert BTC + DCA reminder → kirim FCM push ke HP

export default async function handler(req, res) {
  const CRON_SECRET = process.env.CRON_SECRET || '';
  if (CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kpikyqafapclyirpqflp.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
  };

  try {
    // ── 1. Ambil harga BTC ──
    let btcPrice = 0;
    try {
      const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
        { signal: AbortSignal.timeout(5000) });
      btcPrice = parseFloat((await r.json()).price) || 0;
    } catch(e) {
      try {
        const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
          { signal: AbortSignal.timeout(5000) });
        btcPrice = (await r.json())?.bitcoin?.usd || 0;
      } catch(e2) {}
    }
    if (!btcPrice) return res.status(200).json({ skipped: true, reason: 'price fetch failed' });
    console.log(`[price-check] BTC: $${btcPrice}`);

    // ── 2. Ambil user data + FCM tokens ──
    const [userDataRes, tokenRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/user_push_data?select=user_code,price_alerts,dca_reminders&active=eq.true`, { headers: sbHeaders }),
      fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=fcm_token,user_code&fcm_token=not.is.null&order=updated_at.desc`, { headers: sbHeaders }),
    ]);
    const userData  = await userDataRes.json();
    const tokenRows = await tokenRes.json();

    // 1 token terbaru per user
    const userTokenMap = new Map();
    for (const r of (tokenRows || [])) {
      if (r.user_code && r.fcm_token && !userTokenMap.has(r.user_code)) {
        userTokenMap.set(r.user_code, r.fcm_token);
      }
    }
    if (!userTokenMap.size) return res.status(200).json({ skipped: true, reason: 'no tokens' });

    // Waktu WIB (UTC+7)
    const now     = new Date();
    const wibMs   = now.getTime() + 7 * 3600 * 1000;
    const wibDate = new Date(wibMs);
    const nowWIB  = `${String(wibDate.getUTCHours()).padStart(2,'0')}:${String(wibDate.getUTCMinutes()).padStart(2,'0')}`;
    const nowDay  = wibDate.getUTCDay();   // 0=Minggu..6=Sabtu
    const nowDate = wibDate.getUTCDate();  // 1-31

    const accessToken = await getAccessToken();
    let priceAlertsSent = 0, remindersSent = 0;

    // ── 3. Proses tiap user ──
    for (const [userCode, fcmToken] of userTokenMap) {
      const uData = (userData || []).find(u => u.user_code === userCode);
      if (!uData) continue;

      // ── Price Alerts ──
      const alerts = uData.price_alerts || [];
      let alertChanged = false;
      for (const a of alerts) {
        if (!a.active || a.triggered) continue;
        const hit = (a.type === 'above' && btcPrice >= a.price) ||
                    (a.type === 'below' && btcPrice <= a.price);
        if (!hit) continue;
        a.triggered = true;
        alertChanged = true;
        const dir  = a.type === 'above' ? 'naik di atas ⬆️' : 'turun di bawah ⬇️';
        await sendFCM(fcmToken, '⚡ Price Alert BTC!',
          `BTC ${dir} $${Number(a.price).toLocaleString('en-US')}!\nHarga sekarang: $${Number(btcPrice).toLocaleString('en-US')}`,
          'price-alert', accessToken);
        priceAlertsSent++;
      }
      if (alertChanged) {
        fetch(`${SUPABASE_URL}/rest/v1/user_push_data?user_code=eq.${userCode}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ price_alerts: alerts, updated_at: now.toISOString() }),
        }).catch(() => {});
      }

      // ── DCA Reminders ──
      for (const r of (uData.dca_reminders || [])) {
        if (!r.active) continue;
        let go = false;
        const rTime = r.time || '08:00';

        if      (r.freq === 'daily')   go = nowWIB === rTime;
        else if (r.freq === 'weekly')  go = String(nowDay)  === String(r.day)  && nowWIB === rTime;
        else if (r.freq === 'monthly') go = String(nowDate) === String(r.date) && nowWIB === rTime;
        else if (r.freq === 'specific' && r.specificDatetime) {
          go = Math.abs(now - new Date(r.specificDatetime)) / 60000 < 1;
        }
        if (!go) continue;

        const amt  = r.amount ? ` Rp${Number(r.amount).toLocaleString('id-ID')}` : '';
        const freq = { daily:'Harian', weekly:'Mingguan', monthly:'Bulanan', specific:'Terjadwal' }[r.freq] || '';
        await sendFCM(fcmToken, '⏰ Waktunya DCA!',
          `Saatnya beli Bitcoin${amt}.\n${freq} · ${rTime} WIB`,
          'dca-reminder', accessToken);
        remindersSent++;
      }
    }


    // ── 4. Cek Berita Kripto (setiap 30 menit) ──
    let newsSent = 0;

    if (userTokenMap.size > 0) {
      try {
        // Baca berita dari DB — cek news_cache
        const newsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/news_cache?id=eq.latest&select=bullish,bearish,updated_at,last_bull_sent,last_bear_sent`,
          { headers: sbHeaders }
        );
        const newsRows = await newsRes.json();
        const newsData = newsRows?.[0];

        if (newsData) {
          const updatedAt   = new Date(newsData.updated_at);
          const ageMin      = (Date.now() - updatedAt) / 60000;
          const allTokens   = [...userTokenMap.values()];

          // Cek bullish — kirim jika judul berbeda dari yang terakhir dikirim
          const topBull = (newsData.bullish || [])[0];
          const lastBullSent = newsData.last_bull_sent || '';
          if (topBull && ageMin <= 120 && topBull.title !== lastBullSent) {
            // Format: judul langsung sebagai title, ringkasan sebagai body
            const title = topBull.title.slice(0, 80);
            const body  = topBull.summary
              ? `${topBull.summary.slice(0, 100)} — ${topBull.source || 'Crypto News'}`
              : (topBull.source || 'Berita kripto terbaru');
            await Promise.allSettled(allTokens.map(t =>
              sendFCM(t, title, body, 'news-bullish', accessToken)
            ));
            newsSent++;
            console.log('[price-check] ✅ Bullish sent:', title);
            // Simpan judul terakhir yang dikirim ke DB
            fetch(`${SUPABASE_URL}/rest/v1/news_cache?id=eq.latest`, {
              method: 'PATCH',
              headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ last_bull_sent: topBull.title }),
            }).catch(() => {});
          }

          // Cek bearish
          const topBear = (newsData.bearish || [])[0];
          const lastBearSent = newsData.last_bear_sent || '';
          if (topBear && ageMin <= 120 && topBear.title !== lastBearSent) {
            const title = topBear.title.slice(0, 80);
            const body  = topBear.summary
              ? `${topBear.summary.slice(0, 100)} — ${topBear.source || 'Crypto News'}`
              : (topBear.source || 'Berita kripto terbaru');
            // Delay 5 detik agar tidak tumpuk
            await new Promise(r => setTimeout(r, 5000));
            await Promise.allSettled(allTokens.map(t =>
              sendFCM(t, title, body, 'news-bearish', accessToken)
            ));
            newsSent++;
            console.log('[price-check] ✅ Bearish sent:', title);
            fetch(`${SUPABASE_URL}/rest/v1/news_cache?id=eq.latest`, {
              method: 'PATCH',
              headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ last_bear_sent: topBear.title }),
            }).catch(() => {});
          }

            if (ageMin > 120) {
            console.log(`[price-check] News too old (${Math.round(ageMin)} min ago), skip`);
          }
          if (!topBull && !topBear) {
            console.log('[price-check] No bullish/bearish news in DB, skip. Run app to sync news.');
          }
        }
      } catch(e) {
        console.warn('[price-check] News error:', e.message);
      }
    }

    console.log(`[price-check] Done — price:${priceAlertsSent} dca:${remindersSent} news:${newsSent}`);
    return res.status(200).json({
      ok: true, btc_price: btcPrice, time_wib: nowWIB,
      users_checked: userTokenMap.size,
      price_alerts_sent: priceAlertsSent,
      reminders_sent: remindersSent,
      news_sent: newsSent,
    });

  } catch(err) {
    console.error('[price-check] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function sendFCM(token, title, body, tag, accessToken) {
  try {
    await fetch(`https://fcm.googleapis.com/v1/projects/z-wealth/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ message: {
        token,
        // Data-only — SW yang handle tampilan (hindari double notif)
        webpush: {
          notification: { title, body, icon: '/icon-192.png', badge: '/icon-192.png', tag, renotify: true, vibrate: [200,100,200] },
          fcm_options: { link: '/' },
        },
        data: { title, body, tag },
      }}),
    });
  } catch(e) { console.warn('[price-check] FCM error:', e.message); }
}

async function getAccessToken() {
  const sa  = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const hdr = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const clm = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64url(await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, await importKey(sa.private_key), new TextEncoder().encode(`${hdr}.${clm}`)));
  const t = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${hdr}.${clm}.${sig}` }) })).json();
  if (!t.access_token) throw new Error('OAuth2 failed');
  return t.access_token;
}

async function importKey(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
  return crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(b64), c=>c.charCodeAt(0)).buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input instanceof ArrayBuffer ? input : input.buffer ?? input);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
