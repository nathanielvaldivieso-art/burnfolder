/**
 * Studio share links — create private listen URLs with play analytics.
 */
(function (root) {
  'use strict';

  function getApiBase() {
    const cfg = root.BurnfolderStudioConfig || {};
    if (cfg.muxApiBase) return String(cfg.muxApiBase).replace(/\/$/, '');
    const host = root.location && root.location.hostname;
    const isLocalDevServer =
      (host === 'localhost' || host === '127.0.0.1') &&
      root.location.port &&
      root.location.port !== '8888';
    if (isLocalDevServer) return 'http://localhost:8888/.netlify/functions';
    return '/.netlify/functions';
  }

  function whenReady() {
    if (root.BurnfolderStudioAuth && root.BurnfolderStudioAuth.whenReady) {
      return root.BurnfolderStudioAuth.whenReady();
    }
    return Promise.resolve();
  }

  function listenPageUrl(token) {
    const loc = root.location;
    if (!loc) return '/listen.html?t=' + encodeURIComponent(token);
    let origin = loc.origin || '';
    if (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') {
      origin = 'http://' + loc.host;
    }
    const prefix = String(origin).indexOf('/studio') > -1 ? origin.replace(/\/studio\/?$/, '') : origin;
    return (prefix || '') + '/listen.html?t=' + encodeURIComponent(token);
  }

  function apiFetch(path, options) {
    return whenReady().then(function () {
      return fetch(getApiBase() + path, options || {});
    });
  }

  function listShares(filters) {
    const qs = new URLSearchParams();
    const f = filters || {};
    if (f.groupKey) qs.set('groupKey', f.groupKey);
    if (f.albumId) qs.set('albumId', f.albumId);
    const q = qs.toString();
    return apiFetch('/studio-share-links' + (q ? '?' + q : ''))
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (txt) {
            throw new Error(txt || 'Could not load share links');
          });
        }
        return res.json();
      })
      .then(function (data) {
        return Array.isArray(data.shares) ? data.shares : [];
      });
  }

  function createShare(payload) {
    return apiFetch('/studio-share-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: 'create' }, payload || {}))
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (txt) {
          throw new Error(txt || 'Could not create share link');
        });
      }
      return res.json();
    });
  }

  function revokeShare(token) {
    return apiFetch('/studio-share-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke', token: token })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (txt) {
          throw new Error(txt || 'Could not revoke link');
        });
      }
      return res.json();
    });
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

  function copyText(text) {
    if (root.navigator && root.navigator.clipboard && root.isSecureContext) {
      return root.navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      const ta = root.document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      root.document.body.appendChild(ta);
      ta.select();
      try {
        root.document.execCommand('copy');
        root.document.body.removeChild(ta);
        resolve();
      } catch (e) {
        root.document.body.removeChild(ta);
        reject(e);
      }
    });
  }

  root.BurnfolderShareLinks = {
    listShares: listShares,
    createShare: createShare,
    revokeShare: revokeShare,
    resolveShare: resolveShare,
    trackPlay: trackPlay,
    listenPageUrl: listenPageUrl,
    copyText: copyText
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
