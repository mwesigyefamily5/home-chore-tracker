
const CACHE_NAME = "home-chore-tracker-v3";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icons/icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cache Firebase SDK files after they are loaded online.
  if (url.hostname === "www.gstatic.com") {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);

        const network = fetch(request).then(response => {
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        });

        if (cached) {
          event.waitUntil(network.catch(() => {}));
          return cached;
        }

        return network;
      })
    );
    return;
  }

  // Only handle requests from this website.
  if (url.origin !== self.location.origin) return;

  // For pages, try the internet first and use the saved page offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache =>
          cache.put("./index.html", copy)
        );
        return response;
      }).catch(async () => {
        return await caches.match("./index.html") ||
          Response.error();
      })
    );
    return;
  }

  // For other website files, use the cache first.
  event.respondWith(
    caches.match(request).then(async cached => {
      if (cached) return cached;

      const response = await fetch(request);

      if (response.ok) {
        const copy = response.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, copy);
      }

      return response;
    })
  );
});
