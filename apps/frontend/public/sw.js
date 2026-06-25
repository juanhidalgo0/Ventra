self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch((err) => {
      // Prevent console spam on network errors (e.g. during dev server restarts or HMR issues)
      return new Response('Network error', { status: 503, statusText: 'Service Unavailable' });
    })
  );
});
