// Clipo service worker. The build fills in VERSION, PRECACHE and ASSETS (see scripts/swPrecache.ts):
// - PRECACHE: the app shell (entry JS/CSS, icons, manifest, the most used fonts), stored on install
//   so the editor opens offline from the first visit.
// - ASSETS: every hashed file of this build. Other fonts, AI workers, WASM and vision files go to
//   the runtime cache the first time they are used; files of older builds are deleted on activate.
// AI models and voices live in their own caches (clipo-tone-*, clipo-voices-*, transformers-cache)
// and are never touched here.
const VERSION = '__VERSION__';
const PRECACHE = [/*__PRECACHE__*/];
const ASSETS = [/*__ASSETS__*/];
const CACHE = `clipo-${VERSION}`;
const RUNTIME = 'clipo-runtime';
/** With bad signal, a page load waits this long for the network before using the cached shell. */
const NAV_TIMEOUT_MS = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.length ? PRECACHE : ['./'])));
  self.skipWaiting();
});

/** Remove runtime-cached /assets/ files that this build no longer ships (hashed names never come back). */
async function purgeRuntime() {
  if (!ASSETS.length) return; // dev or an unfilled build: nothing to compare with
  const keep = new Set(ASSETS.map((a) => new URL(a, self.registration.scope).pathname));
  const cache = await caches.open(RUNTIME);
  for (const req of await cache.keys()) {
    const { pathname } = new URL(req.url);
    if (pathname.includes('/assets/') && !keep.has(pathname)) await cache.delete(req);
  }
}

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // Only Clipo's own shell caches of older versions; model/voice caches have other names.
      .then((keys) => Promise.all(keys.filter((k) => /^clipo-[0-9a-f]{10}$/.test(k) && k !== CACHE).map((k) => caches.delete(k))))
      .then(purgeRuntime)
      .catch(() => {})
      .then(() => self.clients.claim()),
  );
});

// Servers often answer with `Vary: Origin`, and module scripts send an Origin header that the
// precache requests didn't, so lookups must ignore Vary or nothing would match offline.
const match = (req) => caches.match(req, { ignoreVary: true, ignoreSearch: req.mode === 'navigate' });

const put = (name, req, res) => {
  if (res.ok && res.type !== 'opaque') {
    const copy = res.clone();
    caches.open(name).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
};

/** Network first; after NAV_TIMEOUT_MS without an answer, the cached shell (if there is one). */
function navigate(req) {
  const cached = () => match(req).then((r) => r || match(new Request('./')));
  return new Promise((resolve) => {
    let done = false;
    const finish = (p) => {
      if (done) return;
      done = true;
      resolve(p);
    };
    const timer = setTimeout(() => {
      cached().then((r) => {
        if (r) finish(r);
        // Nothing cached yet (first visit): keep waiting for the network.
      });
    }, NAV_TIMEOUT_MS);
    fetch(req)
      .then((res) => {
        clearTimeout(timer);
        finish(res);
      })
      .catch(() => {
        clearTimeout(timer);
        cached().then((r) => finish(r || Response.error()));
      });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Page loads: network first so updates arrive, cached shell when offline or too slow.
  if (req.mode === 'navigate') {
    e.respondWith(navigate(req));
    return;
  }

  // Hashed build files never change: serve from cache, store anything not precached (fonts, WASM, workers) on first use.
  // Range requests (media) go straight to the network: a partial answer can't be cached.
  if (url.pathname.includes('/assets/')) {
    if (req.headers.has('range')) return;
    e.respondWith(match(req).then((r) => r || fetch(req).then((res) => put(RUNTIME, req, res))));
    return;
  }

  // Everything else (manifest, icons, models and sounds in public/): network first, cache as fallback.
  e.respondWith(fetch(req).then((res) => put(RUNTIME, req, res)).catch(() => match(req).then((r) => r || Response.error())));
});
