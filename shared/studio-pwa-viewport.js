(function (root) {
  'use strict';

  var STANDALONE_VIEWPORT =
    'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

  function isStandalone() {
    return (
      (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) ||
      root.navigator.standalone === true
    );
  }

  function applyStandaloneViewport() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return null;
    meta.setAttribute('content', STANDALONE_VIEWPORT);
    return meta;
  }

  function resetZoom() {
    if (!isStandalone()) return;
    var meta = applyStandaloneViewport();
    if (!meta) return;
    // Nudge iOS to drop any input-focus zoom that stuck after the login field.
    meta.setAttribute(
      'content',
      STANDALONE_VIEWPORT.replace('initial-scale=1', 'initial-scale=1.0001')
    );
    root.requestAnimationFrame(function () {
      meta.setAttribute('content', STANDALONE_VIEWPORT);
      root.scrollTo(0, 0);
    });
  }

  if (isStandalone()) {
    applyStandaloneViewport();
    root.addEventListener('pageshow', function (event) {
      if (event.persisted) resetZoom();
    });
  }

  root.BurnfolderStudioPwaViewport = {
    isStandalone: isStandalone,
    apply: applyStandaloneViewport,
    resetZoom: resetZoom
  };
})(typeof window !== 'undefined' ? window : this);
