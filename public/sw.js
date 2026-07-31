// Service worker — enables installability and a minimal offline fallback.
//
// Habitrack is an online-first app (server-rendered per request, auth-gated,
// realtime + Neon), so we deliberately DO NOT cache app HTML: caching it caused
// two reopen bugs — (1) stale HTML pointing at old hashed /_astro assets that
// 404 after a deploy, and (2) "a redirected response was used…" errors when a
// signed-out `/` (302 → /profile) got cached/returned for a navigation.
//
// Strategy:
//   navigations   → network, always fresh (via navigation preload when available);
//                   a static offline page if the network is unreachable.
//   /_astro/*     → cache-first. These are content-hashed, so the filename changes
//                   whenever the bytes do and a stale entry is simply never asked
//                   for again. This is what keeps a cold launch off the network:
//                   the CSS and the JS bundle come from disk, and only the HTML is
//                   fetched. It is safe for exactly the reason caching HTML was not.
//   everything else (API calls, non-hashed files) → untouched, normal network.
const CACHE = 'habitrack-v4';
const OFFLINE_URL = '/offline.html';
const ASSETS = '/_astro/';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    // Cloudflare Pages 308-redirects /offline.html → /offline, so cache.add would
    // store a *redirected* response (which can't be returned for a navigation).
    // Fetch it (following the redirect) and store a clean, non-redirected copy.
    try {
      const res = await fetch(OFFLINE_URL, { redirect: 'follow' });
      const cache = await caches.open(CACHE);
      await cache.put(OFFLINE_URL, new Response(await res.blob(), {
        status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }));
    } catch { /* offline during install — fallback simply won't be available */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Faster SW-controlled navigations (no-op on browsers without support, e.g. iOS).
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    // Purge any old (v1) caches that may hold stale HTML.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Content-hashed build output: serve from cache, populate on first miss. Entries
  // accumulate across deploys within one CACHE version; bumping the version above
  // purges them in `activate`, and the total is a few hundred KB either way.
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith(ASSETS)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      // Don't await the write: the response goes back immediately and waitUntil
      // keeps the SW alive long enough to finish storing it.
      if (res.ok) e.waitUntil(cache.put(req, res.clone()));
      return res;
    })());
    return;
  }

  if (req.mode !== 'navigate') return; // APIs and everything else: normal network
  e.respondWith((async () => {
    try {
      const res = (await e.preloadResponse) || (await fetch(req));
      // A response that already followed a redirect can't be returned for a
      // navigation in some browsers — hand back a clean copy so launch never errors.
      if (res && res.redirected) {
        return new Response(await res.clone().blob(), {
          status: res.status, statusText: res.statusText, headers: res.headers,
        });
      }
      return res;
    } catch {
      return (await caches.match(OFFLINE_URL)) || Response.error();
    }
  })());
});
