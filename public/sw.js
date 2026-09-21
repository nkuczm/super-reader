/**
 * Keeps the app openable with no connection. Article bodies live in
 * IndexedDB (see lib/offline.ts); this only has to cover the shell and the
 * static assets it needs to boot.
 */
const SHELL = "super-reader-shell-v1";
/**
 * Photographs from inside articles. Kept apart from the shell so that
 * clearing one never clears the other, and so the offline download can fill
 * it from the page (lib/offline.ts) as well as this worker filling it from
 * what gets read.
 */
const PHOTOS = "super-reader-photos-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(["/"])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Both of ours survive an update. Without this the activate step
            // deleted every article photograph on the device each time the
            // worker changed.
            .filter((key) => key !== SHELL && key !== PHOTOS)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /*
   * Article photographs, which live on publishers' own CDNs.
   *
   * The offline store keeps an article's text and nothing else, so a
   * downloaded story opened on a train had a headline, its words, and a
   * column of empty boxes where the pictures should be. They are cached here
   * instead of in IndexedDB because this is the only place that can answer
   * the browser's own image request with them.
   *
   * Cache first: a photograph does not change under its URL, and serving the
   * stored copy also spares the reader downloading the same picture again
   * every time they reopen the article.
   */
  if (url.origin !== self.location.origin) {
    if (request.destination === "image") {
      event.respondWith(
        caches.open(PHOTOS).then((cache) =>
          cache.match(request).then(
            (hit) =>
              hit ??
              fetch(request)
                .then((response) => {
                  if (response.ok || response.type === "opaque") {
                    cache.put(request, response.clone()).catch(() => {});
                  }
                  return response;
                })
                // Offline and never cached: let the <img> fail, which the
                // reader marks rather than leaving a grey slab.
                .catch(() => Response.error()),
          ),
        ),
      );
    }
    return;
  }
  // API responses are handled by the app's own cache, not here.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: try the network, fall back to the cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/").then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Static assets are content-hashed, so serving a hit straight from the
  // cache is safe and fast.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
