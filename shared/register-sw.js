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
    navigator.serviceWorker.register(swUrl).catch(function () {});
  });
})();
