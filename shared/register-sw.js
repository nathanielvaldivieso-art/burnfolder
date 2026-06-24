(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;

  var isLocal =
    location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  if (isLocal) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) {
        reg.unregister();
      });
    });
    return;
  }

  window.addEventListener('load', function () {
    var inStudio = location.pathname.indexOf('/studio/') === 0;
    var swUrl = inStudio ? '/studio/sw.js' : '/sw.js';
    // Bust the SW script URL on every site-version bump so installed PWAs
    // always pick up new playback/tap logic instead of serving stale code.
    var version = window.BurnfolderSiteVersion || '';
    if (version) swUrl += '?v=' + version;
    // updateViaCache:'none' forces the SW script AND its importScripts (sw-core.js)
    // to bypass the HTTP cache on update checks, so new logic always propagates.
    navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' }).catch(function () {});
  });
})();
