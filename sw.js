// sw.js — 離線快取：HTML 走網路優先（避免舊版黏住），資產走快取優先
const VERSION = 'kfh-v1.5.0';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/views.js',
  './js/store.js',
  './js/reports.js',
  './js/sync.js',
  './js/util.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // Apps Script 等跨網域一律直連

  if (e.request.mode === 'navigate') {
    // 網路優先：拿得到新版就用新版，離線才退回快取
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }))
  );
});
