// Service worker — enables installability and a minimal offline fallback.
//
// Habitrack is an online-first app (server-rendered per request, auth-gated,
// realtime + Neon), so we deliberately DO NOT cache app HTML: caching it caused
// two reopen bugs — (1) stale HTML pointing at old hashed /_astro assets that
// 404 after a deploy, and (2) "a redirected response was used…" errors when a
// signed-out `/` (302 → /profile) got cached/returned for a navigation.
//
// Strategy: navigations go to the network (via navigation preload when
// available), always fresh; if the network is unreachable we show a small
// static offline page. Hashed assets and API calls are left to the browser.
const CACHE = 'habitrack-v3';
const OFFLINE_URL = '/offline.html';

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
  if (req.method !== 'GET' || req.mode !== 'navigate') return; // assets/APIs: normal network
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
