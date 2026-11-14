// Service Worker: holt eigene Dateien immer frisch vom Server (kein veralteter Stand nach
// einem Update) und fällt ohne Netz auf die zuletzt geladene Fassung zurück.
const VERSION = 'dev'; // wird beim Deploy durch die Commit-Kennung ersetzt
const CACHE = `tft-guide-${VERSION}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('tft-guide-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' && (await cache.match('./', { ignoreSearch: true })))
        || Response.error();
    }
  })());
});
