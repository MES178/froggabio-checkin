/**
 * Offline shell. Caches the app files so a reload with no connectivity still
 * brings the scanner up. Attendee data is never cached here — it lives in
 * IndexedDB and is cleared by the "Clear local data" button.
 *
 * Bump CACHE when any shell file changes, otherwise phones keep the old copy.
 */
const CACHE = 'ls2026-shell-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './db.js',
  './app.js',
  './manifest.json',
  './vendor/jsQR.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Never cache API traffic — a stale roster or a replayed check-in is worse
  // than an honest network error.
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  // Network-first, cache as fallback. Cache-first would pin every phone to the
  // build it first loaded — so a fix pushed at 8:45 on event day would never
  // arrive. Offline still works: the cached copy answers the moment fetch fails.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Promise.reject(new Error('offline'))))
  );
});
