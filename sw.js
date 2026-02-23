// ╔══════════════════════════════════════════════════════════════╗
// ║  z-wealth Service Worker v2.0                               ║
// ║  - PWA caching strategies (dari v1)                         ║
// ║  - Web Push Notification lengkap (baru)                     ║
// ╚══════════════════════════════════════════════════════════════╝

const SW_VERSION   = 'v2.0';
const STATIC_CACHE = 'z-wealth-static-v2';
const API_CACHE    = 'z-wealth-api-v2';

// ── File yang di-cache saat install ──
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
];

// ── API endpoints yang di-cache sementara (max 5 menit) ──
const API_PATTERNS = [
  'api.kraken.com',
  'api.coingecko.com',
  'open.er-api.com',
  'api.frankfurter.app'
];

// ══════════════════════════════════════════════════════════════
//  LIFECYCLE
// ══════════════════════════════════════════════════════════════

// ── INSTALL ──
self.addEventListener('install', event => {
  console.log('[SW] Install', SW_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets...');
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(e => console.warn('[SW] Cache miss:', url, e.message))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', event => {
  console.log('[SW] Activate', SW_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== API_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ══════════════════════════════════════════════════════════════
//  FETCH — Caching Strategies
// ══════════════════════════════════════════════════════════════

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // Skip Supabase (realtime, auth, storage — jangan di-cache)
  if (url.hostname.includes('supabase.co')) return;

  // API calls → Network first, fallback ke cache (max 5 menit)
  const isAPI = API_PATTERNS.some(p => url.hostname.includes(p));
  if (isAPI) {
    event.respondWith(networkFirstWithCache(event.request, API_CACHE, 300));
    return;
  }

  // Google Fonts → Cache first
  if (url.hostname.includes('fonts.g') || url.hostname.includes('fonts.gstatic')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // CDN assets (Chart.js, jsQR dll) → Cache first
  if (url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('jsdelivr.net')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // App shell → Stale while revalidate
  if (url.pathname === '/' || url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.json') || url.pathname.endsWith('.png')) {
    event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
    return;
  }

  // Default → network
  event.respondWith(
    fetch(event.request).catch(() => caches.match('/index.html'))
  );
});

// ══════════════════════════════════════════════════════════════
//  CACHING STRATEGIES
// ══════════════════════════════════════════════════════════════

async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirstWithCache(request, cacheName, maxAgeSeconds) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const toCache = response.clone();
      const headers = new Headers(toCache.headers);
      headers.append('sw-cached-at', Date.now().toString());
      cache.put(request, new Response(await toCache.blob(), {
        status: toCache.status, statusText: toCache.statusText, headers
      }));
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const cachedAt = parseInt(cached.headers.get('sw-cached-at') || '0');
      if ((Date.now() - cachedAt) / 1000 < maxAgeSeconds) return cached;
    }
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache        = await caches.open(cacheName);
  const cached       = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await fetchPromise || new Response('Offline', { status: 503 });
}

// ══════════════════════════════════════════════════════════════
//  PUSH NOTIFICATION
// ══════════════════════════════════════════════════════════════

self.addEventListener('push', event => {
  console.log('[SW] Push received');

  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'z-wealth', body: event.data ? event.data.text() : 'Pesan baru masuk' };
  }

  const roomId = data.roomId || null;
  const url    = data.url    || ('/?page=chat' + (roomId ? '&room=' + roomId : ''));

  event.waitUntil(
    self.registration.showNotification(data.title || 'z-wealth Chat', {
      body:     data.body  || 'Kamu punya pesan baru',
      icon:     data.icon  || '/icon-192.png',
      badge:    data.badge || '/icon-192.png',
      tag:      data.tag   || ('room-' + (roomId || 'general')),
      renotify: true,
      vibrate:  [200, 100, 200],
      data:     { url, roomId },
      actions:  [
        { action: 'open',    title: '💬 Buka Chat' },
        { action: 'dismiss', title: '✕ Tutup'      }
      ]
    })
  );
});

// ── NOTIFIKASI DIKLIK ──
self.addEventListener('notificationclick', event => {
  console.log('[SW] Notification click:', event.action);
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Cari window z-wealth yang sudah terbuka → focus + navigasi ke room
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({
            type:   'PUSH_OPEN_ROOM',
            roomId: event.notification.data?.roomId,
            url
          });
          return;
        }
      }
      // Tidak ada window terbuka → buka tab baru
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('notificationclose', event => {
  console.log('[SW] Notification dismissed');
});
