const CACHE_PREFIX = 'wtw-shell-';
const CACHE_REVISION = "850ecd634dc389c9";
const CACHE = CACHE_PREFIX + CACHE_REVISION;
const SHELL = ['/', '/icon.svg'];

function isContentAddressed(url) {
  return /\.[a-f0-9]{16}\.(?:ktx2|json)$/u.test(url.pathname) ||
    /\/decoders\/basis\/[a-f0-9]{16}\//u.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached && isContentAddressed(url)) return cached;

    try {
      const response = await fetch(request);
      if (response.ok && response.type !== 'opaque') {
        const cacheWrite = cache.put(request, response.clone()).catch(() => {});
        event.waitUntil(cacheWrite);
      }
      return response;
    } catch {
      if (cached) return cached;
      if (request.mode === 'navigate') return (await cache.match('/')) || Response.error();
      return Response.error();
    }
  })());
});
