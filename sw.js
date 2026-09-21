// Caches only the static shell for installability. Dashboard data always comes from
// the network (Supabase Edge Functions) - never cache API responses, they must stay live.
//
// Bump CACHE whenever this file changes so old service workers evict their cache; the
// browser only re-installs a service worker when sw.js's bytes change, so a v1->v2 bump
// is also how already-installed clients get unstuck from a previous version.
const CACHE = 'steri-care-shell-v2';
const SHELL = ['./manifest.json', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase API calls

  // The HTML document changes often (new features/schema fixes) - always prefer a fresh
  // copy over the network, only falling back to whatever's cached if actually offline.
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Rarely-changing shell assets (manifest, icon): cache-first is fine.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
