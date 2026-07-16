// Journery service worker — Phase 1: offline app shell + read-only data cache.
// Served from /sw.js (root scope) by a Flask route, re-rendered on each deploy
// so `static_v` bumps invalidate the shell cache. Writes still require the
// network (offline writes/sync come in a later phase).

const SHELL_CACHE = 'journery-shell-{{ static_v }}';
const DATA_CACHE  = 'journery-data-v1';        // survives shell-version bumps
const SHELL = [
  '/',
  '/manifest.json',
  '/static/style.css?v={{ static_v }}',
  '/static/app.js?v={{ static_v }}',
  '/static/demo.js?v={{ static_v }}',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('journery-shell-') && k !== SHELL_CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                     // mutations: always network (offline writes = later)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // ignore cross-origin

  // Exports must be fresh and are large — never cache; just let them hit network.
  if (url.pathname.startsWith('/api/export')) return;

  if (url.pathname.startsWith('/api/')) {
    // Data: network-first (always fresh online), fall back to the last cached
    // response when offline so notes stay readable.
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(DATA_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  if (req.mode === 'navigate') {
    // App shell: network-first for fresh HTML online, cached shell when offline.
    e.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }

  // Static assets (versioned URLs): cache-first, network fallback.
  e.respondWith(caches.match(req).then((c) => c || fetch(req)));
});
