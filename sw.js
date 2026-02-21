// z-wealth Service Worker v1.0
const CACHE_NAME = 'z-wealth-v1';
const STATIC_CACHE = 'z-wealth-static-v1';
const API_CACHE = 'z-wealth-api-v1';

// File yang di-cache saat install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
];

// API endpoints yang di-cache sementara (max 5 menit)
const API_PATTERNS = [
  'api.kraken.com',
  'api.coingecko.com',
  'open.er-api.com',
  'api.frankfurter.app'
];

// ── INSTALL ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets...');
        // Cache satu per satu agar satu gagal tidak block semua
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

// ── FETCH ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension, etc
  if (!url.protocol.startsWith('http')) return;

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

  // CDN assets (Chart.js dll) → Cache first
  if (url.hostname.includes('cdnjs.cloudflare.com')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // App shell (index.html, manifest, icons) → Cache first, update in background
  if (url.pathname === '/' || url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.json') || url.pathname.endsWith('.png')) {
    event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
    return;
  }

  // Default → network
  event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
});

// ── STRATEGIES ──

// Cache first — cocok untuk asset statis
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
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

// Network first dengan fallback cache — cocok untuk API
async function networkFirstWithCache(request, cacheName, maxAgeSeconds) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const toCache = response.clone();
      const headers = new Headers(toCache.headers);
      headers.append('sw-cached-at', Date.now().toString());
      cache.put(request, new Response(await toCache.blob(), {
        status: toCache.status,
        statusText: toCache.statusText,
        headers
      }));
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const cachedAt = parseInt(cached.headers.get('sw-cached-at') || '0');
      const age = (Date.now() - cachedAt) / 1000;
      if (age < maxAgeSeconds) return cached;
    }
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Stale while revalidate — cocok untuk app shell
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await fetchPromise || new Response('Offline', { status: 503 });
}

// ── PUSH NOTIFICATION (untuk future use) ──
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'z-wealth', {
      body: data.body || 'Ada update untuk portofolio kamu',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'z-wealth-notification'
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
