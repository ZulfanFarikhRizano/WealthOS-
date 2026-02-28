// ═══════════════════════════════════════════════════════
// firebase-messaging-sw.js — z-wealth Push Notification SW
// File ini HARUS ada di root project (sama level dengan index.html)
// ═══════════════════════════════════════════════════════

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

// ── Handle notif saat app di BACKGROUND / DITUTUP ──
messaging.onBackgroundMessage(payload => {
  const { title, body, icon, tag, data } = payload.notification || {};
  const notifOptions = {
    body: body || 'Ada update dari z-wealth',
    icon: icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: tag || data?.tag || 'zwealth-' + Date.now(),
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    data: data || {},
    actions: [
      { action: 'open', title: '🔍 Lihat' },
      { action: 'dismiss', title: 'Tutup' }
    ]
  };
  self.registration.showNotification(title || 'z-wealth', notifOptions);
});

// ── Handle klik notif ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;

  const urlToOpen = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Cek apakah ada tab z-wealth yang sudah terbuka
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.postMessage({ type: 'NOTIF_CLICK', tag: e.notification.tag, url: urlToOpen });
      } else {
        clients.openWindow(urlToOpen);
      }
    })
  );
});

// ── Handle SHOW_NOTIF dari halaman (in-app trigger) ──
self.addEventListener('message', e => {
  if (e.data?.type === 'SHOW_NOTIF') {
    const d = e.data;
    self.registration.showNotification(d.title || 'z-wealth', {
      body: d.body || '',
      icon: d.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: d.tag || 'zw-' + Date.now(),
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: d.url || '/' }
    });
  }
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
