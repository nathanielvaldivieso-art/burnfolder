/**
 * Loads Cloudflare Web Analytics beacon on production public pages only.
 * Token comes from shared/analytics-config.js (BurnfolderAnalytics.cloudflareToken).
 * Also boots first-party site-analytics.js (plays / linger / UTM / outbound).
 */
(function () {
  'use strict';

  var host = location.hostname || '';
  var path = location.pathname || '';
  var port = location.port || '';
  var isStudio = path.indexOf('/studio/') === 0;
  var isProduction = /(^|\.)burnfolder\.com$/i.test(host);
  var isLocal = host === 'localhost' || host === '127.0.0.1';
  // Static `python -m http.server` (e.g. :8765) has no functions — skip ingest.
  // Local analytics only when served by netlify dev (:8888).
  var isStaticLocal = isLocal && !!port && port !== '8888';

  function scriptBase() {
    var current = document.currentScript;
    if (current && current.src) {
      return current.src.replace(/[^/]+$/, '');
    }
    return '/shared/';
  }

  function loadSiteAnalytics() {
    if (isStudio) return;
    if (!isProduction && !isLocal) return;
    if (isStaticLocal) return;
    if (window.BurnfolderSiteAnalytics) return;
    if (document.querySelector('script[data-bf-site-analytics]')) return;
    var script = document.createElement('script');
    script.src = scriptBase() + 'site-analytics.js?v=20260723zebra';
    script.defer = true;
    script.setAttribute('data-bf-site-analytics', '1');
    document.head.appendChild(script);
  }

  loadSiteAnalytics();

  var cfg = window.BurnfolderAnalytics || {};
  var token = String(cfg.cloudflareToken || '').trim();
  if (!token || !isProduction || isStudio) return;

  if (document.querySelector('script[data-cf-beacon]')) return;

  var cf = document.createElement('script');
  cf.defer = true;
  cf.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  // spa:true so album/song query-param navigations still count via spa-router.
  cf.setAttribute(
    'data-cf-beacon',
    JSON.stringify({ token: token, spa: true })
  );
  document.head.appendChild(cf);
})();
