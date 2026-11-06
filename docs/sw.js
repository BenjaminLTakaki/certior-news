// Offline: keeps the app and the last feed it loaded, so headlines, Compare and Recap open without signal.
// Network first, always: a deploy or a new feed is never hidden behind the cache; the cache is only for no signal.
// ponytail: YouTube thumbnails and videos aren't kept (cross-origin, large); offline shows the text.
const CACHE = 'swipe-news-v1';
const SCOPE = new URL(self.registration.scope);

self.addEventListener('install', (e) => {
  self.skipWaiting();
  // the shell, so even a first visit opens offline next time (the feed is kept the first time it's fetched again)
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(['./', 'app.js', 'style.css'].map((p) => c.add(p).catch(() => {})))));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const mine = url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
  const feed = /\/(feed|search)(\.mock)?\.json$/.test(url.pathname);      // also the feed on GitHub Pages
  if (e.request.method !== 'GET' || !(mine || feed)) return;
  const key = url.origin + url.pathname;      // the app adds ?t=… to dodge HTTP caches: keep one copy per file
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return r;
  }).catch(async () => (await caches.match(key)) || (e.request.mode === 'navigate' && await caches.match(SCOPE.href)) || Response.error()));
});
