// ── SketchLair Service Worker ─────────────────────────────────────────────────
// Cache versioning — bump this constant to invalidate all caches on next deploy
const CACHE_NAME = 'SKETCHLAIR_CACHE_V1';

// App shell assets to pre-cache on install
const APP_SHELL = [
  '/',
  '/index.html',
];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  // Take control immediately without waiting for old SW to go away
  self.skipWaiting();
});

// ── Activate: clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// ── Fetch: three-strategy routing ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET requests (POST canister update calls, etc.)
  if (request.method !== 'GET') return;

  // ── Strategy 1: ICP canister calls → Network first, fallback to cache ──────
  // Matches icp-api.io, .ic0.app, .raw.ic0.app, and local canister dev
  if (
    url.hostname.includes('icp-api.io') ||
    url.hostname.endsWith('.ic0.app') ||
    url.hostname.endsWith('.raw.ic0.app') ||
    (url.hostname === 'localhost' && url.pathname.startsWith('/api/'))
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful canister query responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // ── Strategy 2: Blob storage assets → Cache first, network fallback ────────
  // Blob assets have hash patterns in their URLs — immutable once fetched
  if (
    url.pathname.includes('/assets/') &&
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── Strategy 3: App shell (HTML, JS, CSS, fonts, icons) → Cache first ──────
  // Serve from cache immediately; update cache in the background
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback: return cached index.html for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('', { status: 503 });
        });

      return cached || networkFetch;
    })
  );
});
