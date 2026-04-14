// HonorBase Service Worker — stub for PWA install support
// Full offline support can be added later

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

// Pass-through fetch — no caching yet
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
