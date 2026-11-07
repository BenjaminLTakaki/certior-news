// Offline: keeps the app and the last feed it loaded, so headlines, Compare and Recap open without signal.
// Network first, but never waiting long: if the network hasn't answered in SLOW_MS and a copy is saved, the copy is
// served and the network's answer still updates it. On a phone that just woke up, the network can hang for many
// seconds, and waiting on it left the app reopening on "Loading stories…" for good.
// ponytail: YouTube thumbnails and videos aren't kept (cross-origin, large); offline shows the text.
const CACHE = 'swipe-news-v1';
const SCOPE = new URL(self.registration.scope);
const SLOW_MS = 3000;

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
  const net = fetch(e.request).then(async (r) => {
    if (r.ok) await (await caches.open(CACHE)).put(key, r.clone());
    return r;
  });
  e.waitUntil(net.catch(() => {}));      // keep going after a saved copy answered, so the copy gets updated
  e.respondWith((async () => {
    const saved = (await caches.match(key)) || (e.request.mode === 'navigate' && await caches.match(SCOPE.href));
    if (!saved) return net.catch(() => Response.error());
    return Promise.race([net.then((r) => (r.ok ? r : saved), () => saved), new Promise((done) => setTimeout(() => done(saved), SLOW_MS))]);
  })());
});
