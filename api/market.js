// ============================================================
// /api/market.js — Vercel Serverless
// Gabungan: api_btchistory.js + api_finnhub.js + klines.js + ticker.js + price-check.js
//
// Routes via ?action=...
//   GET  ?action=btchistory
//   GET  ?action=finnhub&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
//   GET  ?action=klines&symbol=BTCUSDT&interval=1h&limit=150
//   GET  ?action=ticker&symbol=BTCUSDT
//   GET  ?action=price-check   (Cron, Bearer auth)
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ── btchistory ──────────────────────────────────────────
  if (action === 'btchistory') {
    try {
      const apiKey  = process.env.COINGECKO_API_KEY || '';
      const headers = { 'Accept': 'application/json', 'User-Agent': 'z-wealth/1.0' };
      if (apiKey) headers['x-cg-pro-api-key'] = apiKey;

      const r = await fetch(
        'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=max&interval=weekly',
        { headers, signal: AbortSignal.timeout(20000) }
      );
      if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
      const data = await r.json();
      if (!data?.prices?.length) throw new Error('Empty prices');

      res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
      return res.status(200).json({ prices: data.prices, source: 'coingecko', count: data.prices.length });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // ── finnhub ─────────────────────────────────────────────
  if (action === 'finnhub') {
    const { dateFrom, dateTo } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo required' });
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'FINNHUB_API_KEY not configured' });
    try {
      const r = await fetch(
        `https://finnhub.io/api/v1/calendar/economic?from=${dateFrom}&to=${dateTo}&token=${apiKey}`,
        { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) throw new Error(`Finnhub ${r.status}`);
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
      return res.status(200).json(await r.json());
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // ── klines ──────────────────────────────────────────────
  if (action === 'klines') {
    const { symbol = 'BTCUSDT', interval = '1h', limit = '150' } = req.query;
    res.setHeader('Cache-Control', 'public, max-age=10');
    const TF = { '1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','2h':'120','4h':'240','6h':'360','12h':'720','1d':'D','1w':'W','1M':'M' };
    const bybitTf = TF[interval] || '60';

    const sources = [
      async () => {
        const r = await fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${bybitTf}&limit=${limit}`);
        const d = await r.json();
        if (d.retCode !== 0) throw new Error('Bybit: ' + d.retMsg);
        return d.result.list.reverse().map(k => [+k[0],+k[1],+k[2],+k[3],+k[4],+k[5]]);
      },
      async () => {
        const OKX_TF = {'1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','4h':'4H','1d':'1Dutc','1w':'1Wutc'};
        const r = await fetch(`https://www.okx.com/api/v5/market/candles?instId=${symbol.replace('USDT','-USDT')}&bar=${OKX_TF[interval]||'1H'}&limit=${limit}`);
        const d = await r.json();
        if (d.code !== '0') throw new Error('OKX: ' + d.msg);
        return d.data.reverse().map(k => [+k[0],+k[1],+k[2],+k[3],+k[4],+k[5]]);
      },
      async () => {
        const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
        const d = await r.json();
        return d.map(k => [+k[0],+k[1],+k[2],+k[3],+k[4],+k[5]]);
      },
    ];
    for (const fn of sources) {
      try { return res.status(200).json({ ok: true, data: await fn() }); }
      catch(e) { console.warn('[market/klines]', e.message); }
    }
    return res.status(502).json({ ok: false, error: 'Semua sumber klines gagal' });
  }

  // ── ticker ──────────────────────────────────────────────
  if (action === 'ticker') {
    const { symbol = 'BTCUSDT' } = req.query;
    res.setHeader('Cache-Control', 'public, max-age=5');
    const sources = [
      async () => {
        const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);
        const d = await r.json();
        if (d.retCode !== 0) throw new Error('Bybit: ' + d.retMsg);
        const t = d.result.list[0];
        return { lastPrice: t.lastPrice, priceChangePercent: (parseFloat(t.price24hPcnt)*100).toFixed(2) };
      },
      async () => {
        const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
        const d = await r.json();
        return { lastPrice: d.lastPrice, priceChangePercent: d.priceChangePercent };
      },
    ];
    for (const fn of sources) {
      try { return res.status(200).json({ ok: true, data: await fn() }); }
      catch(e) { console.warn('[market/ticker]', e.message); }
    }
    return res.status(502).json({ ok: false, error: 'Ticker tidak tersedia' });
  }

  // ── price-check (Cron) ───────────────────────────────────
  if (action === 'price-check') {
    const CRON_SECRET = process.env.CRON_SECRET || '';
    if (CRON_SECRET && req.headers['authorization'] !== `Bearer ${CRON_SECRET}`)
      return res.status(401).json({ error: 'Unauthorized' });

    const SB_URL = process.env.SUPABASE_URL || 'https://kpikyqafapclyirpqflp.supabase.co';
    const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SB_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });
    const sbH = { 'Content-Type':'application/json', 'apikey':SB_KEY, 'Authorization':`Bearer ${SB_KEY}` };

    try {
      // 1. Harga BTC
      let btcPrice = 0;
      try {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', { signal: AbortSignal.timeout(5000) });
        btcPrice = parseFloat((await r.json()).price) || 0;
      } catch(e) {
        try {
          const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', { signal: AbortSignal.timeout(5000) });
          btcPrice = (await r.json())?.bitcoin?.usd || 0;
        } catch(e2) {}
      }
      if (!btcPrice) return res.status(200).json({ skipped: true, reason: 'price fetch failed' });

      // 2. User data + tokens
      const [udRes, tkRes] = await Promise.all([
        fetch(`${SB_URL}/rest/v1/user_push_data?select=user_code,price_alerts,dca_reminders&active=eq.true`, { headers: sbH }),
        fetch(`${SB_URL}/rest/v1/push_subscriptions?select=fcm_token,user_code&fcm_token=not.is.null&order=updated_at.desc`, { headers: sbH }),
      ]);
      const userData  = await udRes.json();
      const tokenRows = await tkRes.json();

      const tokenMap = new Map();
      for (const r of (tokenRows || []))
        if (r.user_code && r.fcm_token && !tokenMap.has(r.user_code))
          tokenMap.set(r.user_code, r.fcm_token);
      if (!tokenMap.size) return res.status(200).json({ skipped: true, reason: 'no tokens' });

      const now     = new Date();
      const wib     = new Date(now.getTime() + 7*3600000);
      const nowWIB  = `${String(wib.getUTCHours()).padStart(2,'0')}:${String(wib.getUTCMinutes()).padStart(2,'0')}`;
      const nowDay  = wib.getUTCDay();
      const nowDate = wib.getUTCDate();
      const at      = await _getAccessToken();
      let alertsSent = 0, remindersSent = 0;

      // 3. Per-user processing
      for (const [code, fcmToken] of tokenMap) {
        const u = (userData||[]).find(x => x.user_code === code);
        if (!u) continue;

        // Price alerts
        const alerts = u.price_alerts || [];
        let changed = false;
        for (const a of alerts) {
          if (!a.active || a.triggered) continue;
          const hit = (a.type==='above' && btcPrice>=a.price) || (a.type==='below' && btcPrice<=a.price);
          if (!hit) continue;
          a.triggered = true; changed = true;
          await _fcm(fcmToken, '⚡ Price Alert BTC!',
            `BTC ${a.type==='above'?'naik di atas ⬆️':'turun di bawah ⬇️'} $${Number(a.price).toLocaleString('en-US')}!\nHarga sekarang: $${Number(btcPrice).toLocaleString('en-US')}`,
            'price-alert', at);
          alertsSent++;
        }
        if (changed) fetch(`${SB_URL}/rest/v1/user_push_data?user_code=eq.${code}`, {
          method:'PATCH', headers:{...sbH,'Prefer':'return=minimal'},
          body: JSON.stringify({ price_alerts: alerts, updated_at: now.toISOString() })
        }).catch(()=>{});

        // DCA reminders
        for (const r of (u.dca_reminders||[])) {
          if (!r.active) continue;
          const t = r.time||'08:00';
          let go = false;
          if      (r.freq==='daily')    go = nowWIB===t;
          else if (r.freq==='weekly')   go = String(nowDay)===String(r.day) && nowWIB===t;
          else if (r.freq==='monthly')  go = String(nowDate)===String(r.date) && nowWIB===t;
          else if (r.freq==='specific' && r.specificDatetime)
            go = Math.abs(now - new Date(r.specificDatetime))/60000 < 1;
          if (!go) continue;
          const amt  = r.amount ? ` Rp${Number(r.amount).toLocaleString('id-ID')}` : '';
          const freq = {daily:'Harian',weekly:'Mingguan',monthly:'Bulanan',specific:'Terjadwal'}[r.freq]||'';
          await _fcm(fcmToken, '⏰ Waktunya DCA!', `Saatnya beli Bitcoin${amt}.\n${freq} · ${t} WIB`, 'dca-reminder', at);
          remindersSent++;
        }
      }

      // 4. Cek berita (tiap 30 menit)
      let newsSent = 0;
      if ((Date.now()-(global._lastNewsCheck||0)) >= 30*60000 && tokenMap.size > 0) {
        global._lastNewsCheck = Date.now();
        try {
          const nd = (await (await fetch(`${SB_URL}/rest/v1/news_cache?id=eq.latest&select=bullish,bearish,updated_at`,{headers:sbH})).json())?.[0];
          if (nd && (Date.now()-new Date(nd.updated_at))/60000 <= 120) {
            if (!global._sentNewsTitles) global._sentNewsTitles = new Set();
            const allTk = [...tokenMap.values()];
            for (const [key, emoji] of [['bullish','📈'],['bearish','📉']]) {
              const item = (nd[key]||[])[0];
              if (item && !global._sentNewsTitles.has(item.title)) {
                global._sentNewsTitles.add(item.title);
                const body = (item.summary||`${emoji} ${item.source||'Crypto News'}`).slice(0,100);
                await Promise.allSettled(allTk.map(t => _fcm(t, item.title.slice(0,80), body, `news-${key}`, at)));
                newsSent++;
              }
            }
            if (global._sentNewsTitles.size > 200) global._sentNewsTitles.clear();
          }
        } catch(e) { console.warn('[market/price-check] news:', e.message); }
      }

      return res.status(200).json({ ok:true, btc_price:btcPrice, time_wib:nowWIB,
        users_checked:tokenMap.size, price_alerts_sent:alertsSent, reminders_sent:remindersSent, news_sent:newsSent });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── calendar (CoinMarketCal proxy) ─────────────────────
  if (action === 'calendar') {
    const { dateFrom, dateTo } = req.query;
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo required' });

    const apiKey = process.env.CMC_API_KEY;
    // Jika tidak ada API key, return empty array (graceful fallback)
    if (!apiKey) {
      res.setHeader('Cache-Control', 's-maxage=3600');
      return res.status(200).json([]);
    }

    try {
      const r = await fetch(
        `https://api.coinmarketcal.com/v1/events?access_token=${apiKey}&dateRangeStart=${dateFrom}&dateRangeEnd=${dateTo}&page=1&max=150&showOnly=hot_events`,
        { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) throw new Error(`CMC ${r.status}`);
      const data = await r.json();
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
      return res.status(200).json(data);
    } catch(e) {
      // Return empty array on error — frontend handles gracefully
      return res.status(200).json([]);
    }
  }

  return res.status(400).json({ error: 'Unknown action', available: ['btchistory','finnhub','klines','ticker','price-check','calendar'] });
}

// ── Shared helpers ────────────────────────────────────────
async function _fcm(token, title, body, tag, at) {
  try {
    await fetch('https://fcm.googleapis.com/v1/projects/z-wealth/messages:send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${at}` },
      body: JSON.stringify({ message: { token,
        notification: { title, body },
        webpush: { notification: { title, body, icon:'/icon-192.png', badge:'/icon-192.png', tag, renotify:true, vibrate:[200,100,200] }, fcm_options:{ link:'/' } }
      }})
    });
  } catch(e) { console.warn('[market/_fcm]', e.message); }
}

async function _getAccessToken() {
  const sa  = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
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
