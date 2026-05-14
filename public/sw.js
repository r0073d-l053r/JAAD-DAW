const CACHE_NAME = 'gaw-cache-v1';
const urlsToCache = [
  './',
  './index.html',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .catch(() => {}) // Don't crash if caching fails during dev
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  // Only handle same-origin GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        return fetch(event.request).catch(() => {
          // Network failed and no cache — return a simple offline fallback
          return new Response('', { status: 503, statusText: 'Offline' });
        });
      })
  );
});
