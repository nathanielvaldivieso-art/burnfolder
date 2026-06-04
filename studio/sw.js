/* Stream PWA — always fetch fresh HTML; cache static assets lightly. */
const CACHE = 'burnfolder-stream-v3';

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) {
            return key !== CACHE;
          })
          .map(function (key) {
            return caches.delete(key);
          })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function isHtmlRequest(request) {
  const url = new URL(request.url);
  return request.mode === 'navigate' || url.pathname.endsWith('.html');
}

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  if (isHtmlRequest(event.request)) {
    event.respondWith(
      fetch(event.request).catch(function () {
        return caches.match(event.request);
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        if (response && response.ok && event.request.url.indexOf('/studio/js/') > -1) {
          const copy = response.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(event.request, copy);
          });
        }
        return response;
      })
      .catch(function () {
        return caches.match(event.request);
      })
  );
});
