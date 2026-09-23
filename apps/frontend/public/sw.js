// Service worker de la app web/PWA de Ventra.
// Solo guarda la interfaz (HTML, JS, CSS, íconos) para que abra rápido y se pueda
// instalar. Los datos (API, sockets, fotos subidas) SIEMPRE van a la red: nunca se
// muestran ventas o stock viejos desde el caché.
const CACHE = 'ventra-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isData = (url) =>
  url.pathname.startsWith('/api') ||
  url.pathname.startsWith('/socket.io') ||
  url.pathname.startsWith('/uploads');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || isData(url)) return;

  // HTML: primero la red (así cada deploy se ve al instante); sin conexión, la copia guardada.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Sin sesión la nube redirige al login: eso no se guarda como la app
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./'))
    );
    return;
  }

  // Archivos del build (llevan hash en el nombre) e íconos: caché y se refresca de fondo.
  e.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
