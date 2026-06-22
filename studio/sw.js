/* Stream PWA — always fetch fresh HTML; stale-while-revalidate for static assets. */
const CACHE = 'burnfolder-stream-v8';

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function isHtmlRequest(request) {
  const url = new URL(request.url);
  return request.mode === 'navigate' || url.pathname.endsWith('.html');
}

function isFreshData(request) {
  const url = new URL(request.url);
  return url.pathname.endsWith('/entries.js') || url.pathname.endsWith('/songs.js');
}

function isStaticAsset(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (isHtmlRequest(request) || isFreshData(request)) return false;
  return (
    url.pathname.indexOf('/studio/js/') > -1 ||
    url.pathname.indexOf('/studio/css/') > -1 ||
    url.pathname.indexOf('/shared/') > -1 ||
    /\.(css|js|png|jpe?g|webp|gif|svg|woff2?)$/i.test(url.pathname)
  );
}

function staleWhileRevalidate(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      const networkFetch = fetch(request)
        .then(function (response) {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(function () {
          return cached;
        });

      return cached || networkFetch;
    });
  });
}

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  if (isHtmlRequest(event.request) || isFreshData(event.request)) {
    event.respondWith(
      fetch(event.request).catch(function () {
        return caches.match(event.request);
      })
    );
    return;
  }

  if (isStaticAsset(event.request)) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});
