// clever service worker: network first, cache fallback, so updates arrive
// when online and the app still opens at a venue with no signal.
// Each copy of clever on the site (say /clever/ and /clever-alpha/) keeps its own cache, named after its folder,
// and only clears its own old versions.
const SCOPE = new URL(self.registration.scope).pathname;
const CACHE = 'clever-v38' + SCOPE;
const TEST_COPY = /\/clever-[^/]+\/$/.test(SCOPE);
// the transcript's library is versioned on jsDelivr, so it is cached once and kept across app updates
const LIB = 'clever-lib';
const SHELL = ['./', 'guide.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // only our own old versions: the speech model lives in the library's own cache ('transformers-cache')
      // (caches from before they were named per folder have no '/' and belong to the live copy)
      .then(keys => Promise.all(keys.filter(k => k.startsWith('clever-v') && k !== CACHE && (k.endsWith(SCOPE) || (!k.includes('/') && !TEST_COPY))).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@huggingface/transformers@')){
    e.respondWith(caches.open(LIB).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  if (!sameOrigin && !fonts) return;
  // leave audio/video alone: players use range requests, and partial (206) responses can't be cached
  if (req.headers.has('range') || req.destination === 'audio' || req.destination === 'video') return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const net = await Promise.race([
        fetch(req),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
      ]);
      if (net && (net.ok || net.type === 'opaque')) cache.put(req, net.clone());
      return net;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true })
        || (req.mode === 'navigate' ? await cache.match('./') : null);
      return hit || Response.error();
    }
  })());
});
