// Clipo service worker. The build fills in VERSION and PRECACHE (see scripts/swPrecache.ts),
// so the whole app shell is stored on install and the editor opens offline from the first visit.
const VERSION = '__VERSION__';
const PRECACHE = [/*__PRECACHE__*/];
const CACHE = `clipo-${VERSION}`;
const RUNTIME = 'clipo-runtime';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.length ? PRECACHE : ['./'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Servers often answer with `Vary: Origin`, and module scripts send an Origin header that the
// precache requests didn't, so lookups must ignore Vary or nothing would match offline.
const match = (req) => caches.match(req, { ignoreVary: true, ignoreSearch: req.mode === 'navigate' });

const put = (name, req, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(name).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Page loads: network first so updates arrive, cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => match(req).then((r) => r || match(new Request('./')))),
    );
    return;
  }

  // Hashed build files never change: serve from cache, store anything not precached (like the WASM) on first use.
  if (url.pathname.includes('/assets/')) {
    e.respondWith(match(req).then((r) => r || fetch(req).then((res) => put(RUNTIME, req, res))));
    return;
  }

  // Everything else (manifest, icons): network first, cache as fallback.
  e.respondWith(fetch(req).then((res) => put(RUNTIME, req, res)).catch(() => match(req).then((r) => r || Response.error())));
});
