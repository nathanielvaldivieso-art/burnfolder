/**
 * Loads Cloudflare Web Analytics beacon on production public pages only.
 * Token comes from shared/analytics-config.js (BurnfolderAnalytics.cloudflareToken).
 */
(function () {
  'use strict';

  var cfg = window.BurnfolderAnalytics || {};
  var token = String(cfg.cloudflareToken || '').trim();
  if (!token) return;

  var host = location.hostname || '';
  var isProduction = /(^|\.)burnfolder\.com$/i.test(host);
  if (!isProduction) return;

  // Studio is internal — don't pollute public traffic stats.
  if ((location.pathname || '').indexOf('/studio/') === 0) return;

  if (document.querySelector('script[data-cf-beacon]')) return;

  var script = document.createElement('script');
  script.defer = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  // spa:true so album/song query-param navigations still count via spa-router.
  script.setAttribute(
    'data-cf-beacon',
    JSON.stringify({ token: token, spa: true })
  );
  document.head.appendChild(script);
})();
