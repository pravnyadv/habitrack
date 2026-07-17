// Minimal service worker — enables PWA installability (the browser's address-bar
// install icon needs a registered SW with a fetch handler) and a light offline
// shell. Network-first for navigations so online users always get fresh code;
// API responses (Cache-Control: no-store) are never cached.
const CACHE = 'habitrack-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // never touch writes/logins
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    );
  }
  // other GETs (hashed assets) pass through normally — the handler's presence
  // is what makes the app installable.
});
