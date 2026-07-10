/**
 * Cloudflare Web Analytics token — paste from Cloudflare dashboard.
 * Leave empty until you create the site; the beacon will no-op.
 *
 * Cloudflare → Web Analytics → Add site → burnfolder.com → copy token
 */
(function (root) {
  'use strict';
  root.BurnfolderAnalytics = root.BurnfolderAnalytics || {};
  // Paste your site token between the quotes:
  root.BurnfolderAnalytics.cloudflareToken = '6d61fd50ddfc434094b2018d0a8dd257';
})(typeof window !== 'undefined' ? window : globalThis);
