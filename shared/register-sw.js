(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;

  var host = location.hostname || '';

  // Production = the real burnfolder.com domain (apex or any subdomain).
  // Everything else — localhost, 127.0.0.1, LAN IPs (e.g. 172.20.10.2 from
  // `netlify dev` on a phone), *.local, Netlify previews, custom ports — is
  // treated as DEV and must NOT run a service worker. A stale SW cache on a dev
  // host serves old JS/CSS and makes edits appear not to land ("clicking is
  // broken", "fix didn't stick"). Disable + actively unregister there.
  var isProduction = /(^|\.)burnfolder\.com$/i.test(host);

  if (!isProduction) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) {
        reg.unregister();
      });
    }).catch(function () {});

    if (window.caches && caches.keys) {
      caches.keys().then(function (keys) {
        keys.forEach(function (key) {
          if (/burnfolder/i.test(key)) caches.delete(key);
        });
      }).catch(function () {});
    }
    return;
  }

  // When a new service worker takes control, drop in-memory stale pages.
  // Without this, studio can keep old dashboard JS until a force-quit.
  var refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', function () {
    var inStudio = location.pathname.indexOf('/studio/') === 0;
    var swUrl = inStudio ? '/studio/sw.js' : '/sw.js';
    // Bust the SW script URL on every site-version bump so installed PWAs
    // always pick up new playback/tap logic instead of serving stale code.
    var version = window.BurnfolderSiteVersion || window.BurnfolderStudioVersion || '';
    if (version) swUrl += '?v=' + version;
    // updateViaCache:'none' forces the SW script AND its importScripts (sw-core.js)
    // to bypass the HTTP cache on update checks, so new logic always propagates.
    navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' }).then(function (reg) {
      if (reg && reg.update) reg.update().catch(function () {});
    }).catch(function () {});
  });
})();
