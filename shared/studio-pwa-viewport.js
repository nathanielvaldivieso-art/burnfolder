(function () {
  'use strict';

  var meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;

  var standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;

  if (!standalone) return;

  meta.setAttribute(
    'content',
    'width=device-width, initial-scale=1, viewport-fit=cover'
  );
})();
