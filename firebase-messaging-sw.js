// ================================================================
// firebase-messaging-sw.js — z-wealth Push Notification SW
// WAJIB di root project (sama level dengan index.html)
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

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
