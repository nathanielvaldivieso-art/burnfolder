/**
 * Public share link API (no studio auth).
 */
(function (root) {
  'use strict';

  function getApiBase() {
    const host = root.location && root.location.hostname;
    const isLocalDevServer =
      (host === 'localhost' || host === '127.0.0.1') &&
      root.location.port &&
      root.location.port !== '8888';
    if (isLocalDevServer) return 'http://localhost:8888/.netlify/functions';
    return '/.netlify/functions';
  }

  function resolveShare(token) {
    return fetch(getApiBase() + '/share-listen?t=' + encodeURIComponent(token)).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (txt) {
          const err = new Error(txt || 'Link unavailable');
          err.status = res.status;
          throw err;
        });
      }
      return res.json();
    });
  }

  function trackPlay(token) {
    return fetch(getApiBase() + '/share-listen?t=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    });
  }

  root.BurnfolderShareLinks = {
    resolveShare: resolveShare,
    trackPlay: trackPlay
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
