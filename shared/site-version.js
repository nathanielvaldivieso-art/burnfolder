/**
 * Single source of truth for cache-bust ?v= on public-site scripts.
 * Loaded in HTML before other scripts; required by publish-artifacts in Node.
 */
(function (root) {
  'use strict';

  var SITE_SCRIPT_VERSION = '20260703b';

  if (root) {
    root.BurnfolderSiteVersion = SITE_SCRIPT_VERSION;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SITE_SCRIPT_VERSION: SITE_SCRIPT_VERSION };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {});
