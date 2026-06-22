/* burnfolder.com — network-first HTML & live data; stale-while-revalidate for static assets. */
const CACHE = 'burnfolder-site-v1';

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

function isFreshContent(request) {
  const url = new URL(request.url);
  if (request.mode === 'navigate') return true;
  if (url.pathname.endsWith('.html')) return true;
  if (url.pathname === '/' || url.pathname === '') return true;
  if (url.pathname.endsWith('/entries.js')) return true;
  if (url.pathname.endsWith('/songs.js')) return true;
  return false;
}

function isStaticAsset(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (isFreshContent(request)) return false;
  return (
    /\.(css|js|png|jpe?g|webp|gif|svg|woff2?)$/i.test(url.pathname) ||
    url.pathname.indexOf('/shared/') === 0 ||
    url.pathname.indexOf('/IMAGES/') === 0
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

  if (isFreshContent(event.request)) {
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
