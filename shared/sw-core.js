/**
 * Shared service-worker core for burnfolder.com + studio PWA.
 *
 * Both /sw.js and /studio/sw.js importScripts this file and call
 * self.createBurnfolderServiceWorker(config). One caching strategy, two configs.
 *
 * Strategy:
 *   - Fresh content (HTML, navigations, live data) → network-first, cache fallback.
 *   - Static assets (versioned JS/CSS/images, /shared/, app dirs) → stale-while-revalidate.
 *   - Everything else → passthrough (no respondWith).
 */
(function (self) {
  'use strict';

  var STATIC_EXT = /\.(css|js|png|jpe?g|webp|gif|svg|woff2?)$/i;

  function createBurnfolderServiceWorker(config) {
    var cfg = config || {};
    var CACHE = cfg.cacheName || 'burnfolder-cache';
    var freshSuffixes = cfg.freshSuffixes || ['/entries.js', '/songs.js'];
    var includeRoot = cfg.includeRoot !== false;
    var staticPrefixes = cfg.staticPrefixes || ['/shared/'];

    function isFreshContent(request) {
      var url = new URL(request.url);
      if (request.mode === 'navigate') return true;
      if (url.pathname.endsWith('.html')) return true;
      if (includeRoot && (url.pathname === '/' || url.pathname === '')) return true;
      for (var i = 0; i < freshSuffixes.length; i += 1) {
        if (url.pathname.endsWith(freshSuffixes[i])) return true;
      }
      return false;
    }

    function isStaticAsset(request) {
      var url = new URL(request.url);
      if (url.origin !== self.location.origin) return false;
      if (isFreshContent(request)) return false;
      if (STATIC_EXT.test(url.pathname)) return true;
      for (var i = 0; i < staticPrefixes.length; i += 1) {
        if (url.pathname.indexOf(staticPrefixes[i]) === 0) return true;
      }
      return false;
    }

    function staleWhileRevalidate(request) {
      return caches.open(CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
          var networkFetch = fetch(request)
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

    self.addEventListener('install', function () {
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
  }

  self.createBurnfolderServiceWorker = createBurnfolderServiceWorker;
})(self);
