// ================================================================
// firebase-messaging-sw.js — z-wealth Push Notification SW
// WAJIB di root project (sama level dengan index.html)
// ================================================================

// ⚠️ CACHE VERSION — Ganti angka ini setiap kali deploy agar cache lama dihapus
const CACHE_VERSION = 'v4'; // <-- UBAH INI setiap deploy (v1, v2, v3, dst)
const CACHE_NAME = 'z-wealth-' + CACHE_VERSION;

// File yang di-cache untuk offline
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install: cache semua asset
self.addEventListener('install', e => {
  self.skipWaiting(); // langsung aktif tanpa tunggu tab lama ditutup
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
});

// Activate: hapus cache versi lama
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('z-wealth-') && key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => clients.claim()) // ambil alih semua tab tanpa reload
  );
});

// Fetch: Network First (selalu ambil dari server, fallback ke cache)
self.addEventListener('fetch', e => {
  // Hanya handle GET request
  if (e.request.method !== 'GET') return;

  // Skip API calls (biarkan langsung ke network)
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Simpan response terbaru ke cache
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, responseClone));
        }
        return response;
      })
      .catch(() => {
        // Offline: gunakan cache
        return caches.match(e.request);
      })
  );
});

// ================================================================
// FIREBASE MESSAGING (push notification)
// ================================================================
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBUQINFDWLkr2M1eDnAJdXXw5RiQYvP-QA",
  authDomain: "z-wealth.firebaseapp.com",
  projectId: "z-wealth",
  storageBucket: "z-wealth.firebasestorage.app",
  messagingSenderId: "638430159788",
  appId: "1:638430159788:web:e787c228dfadf3ca995009"
});

const messaging = firebase.messaging();

// Handle push saat app DITUTUP / BACKGROUND
messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(n.title || 'z-wealth', {
    body: n.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || ('zw-' + Date.now()),
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' }
  });
});

// Handle SHOW_NOTIF dari halaman (in-app trigger via postMessage)
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'SHOW_NOTIF') return;
  const d = e.data;
  self.registration.showNotification(d.title || 'z-wealth', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || ('zw-' + Date.now()),
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: d.url || '/' }
  });
});

// Klik notif -> buka app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); return; }
      clients.openWindow(url);
    })
  );
});
