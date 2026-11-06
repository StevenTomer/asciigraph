// The service worker: keeps the app working offline. Built by vite.config.ts, which fills in
// FILES (everything the build writes) and VERSION (which changes whenever any of them does).
//  - install: cache every file of this version;
//  - activate: drop older versions' caches, and take over open pages;
//  - the page itself: from the network when there is one (so a new version shows up on the next
//    load), else from the cache; everything else: from the cache, else the network.
/* global self, caches, fetch */
const FILES = __FILES__;
const CACHE = "asciigraph-" + __VERSION__;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("asciigraph-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.open(CACHE).then((c) => c.match("index.html", { ignoreVary: true }))));
    return;
  }
  e.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true, ignoreVary: true })).then((hit) => hit ?? fetch(req)));
});
