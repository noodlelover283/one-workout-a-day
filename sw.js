// Service worker for One Workout a Day: keeps a copy of the app's files on the device so the app
// opens with no connection. When there is a connection it always fetches the newest files first and
// refreshes the saved copy, so updates arrive and old copies never linger. Workouts are stored by
// the app itself (in localStorage), so they are available offline either way.

const CACHE_NAME = "one-workout-a-day-files";

// Every file the app needs to start. A test checks that this list matches the files index.html loads.
const APP_FILES = [
  "./",
  "index.html",
  "style.css",
  "i18n.js",
  "lang-en.js",
  "lang-es.js",
  "lang-zh.js",
  "lang-hi.js",
  "lang-ar.js",
  "lang-fr.js",
  "lang-pt.js",
  "lang-ru.js",
  "strength-data.js",
  "logic.js",
  "app.js",
];

// Saved copies are keyed by address without the ?v=... part the published pages add to their links.
const keyFor = (url) => url.origin + url.pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          APP_FILES.map(async (file) => {
            const url = new URL(file, self.location);
            const response = await fetch(url, { cache: "reload" });
            if (!response.ok) throw new Error(`Could not save ${file} for offline use`);
            await cache.put(keyFor(url), response);
          })
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only the app's own files; everything else (such as YouTube) is left to the browser.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(networkThenSavedCopy(event.request, url));
});

async function networkThenSavedCopy(request, url) {
  const cache = await caches.open(CACHE_NAME);
  try {
    // "no-cache" asks the server whether the file changed, so the browser never hands us a stale copy.
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) await cache.put(keyFor(url), response.clone()).catch(() => {});
    return response;
  } catch (error) {
    const saved =
      (await cache.match(keyFor(url))) ||
      (request.mode === "navigate" ? await cache.match(keyFor(new URL("./", self.location))) : undefined);
    if (saved) return saved;
    throw error;
  }
}
