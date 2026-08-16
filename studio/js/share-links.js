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

  function sitePageUrl(page, token) {
    const loc = root.location;
    if (!loc) return '/' + page + '?t=' + encodeURIComponent(token);
    let origin = loc.origin || '';
    if (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') {
      origin = 'http://' + loc.host;
    }
    const prefix = String(origin).indexOf('/studio') > -1 ? origin.replace(/\/studio\/?$/, '') : origin;
    return (prefix || '') + '/' + page + '?t=' + encodeURIComponent(token);
  }

  // /w picks the right page for the share and carries its link-preview metadata.
  function listenPageUrl(token) {
    return sitePageUrl('w', token);
  }

  function watchPageUrl(token) {
    return sitePageUrl('w', token);
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

  function trackPlay(token, type) {
    return fetch(getApiBase() + '/share-listen?t=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type === 'download' ? 'download' : 'play' })
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

  /** Prefer OS share sheet on phones; fall back to clipboard copy. */
  function shareOrCopy(text, opts) {
    const options = opts || {};
    const url = String(text || '').trim();
    if (!url) return Promise.reject(new Error('nothing to share'));
    const nav = root.navigator;
    if (nav && typeof nav.share === 'function') {
      const payload = { url: url };
      if (options.title) payload.title = options.title;
      if (options.text) payload.text = options.text;
      return Promise.resolve()
        .then(function () {
          return nav.share(payload);
        })
        .then(function () {
          return { method: 'share' };
        })
        .catch(function (err) {
          // User dismissed the sheet — not an error to surface.
          if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
            return { method: 'cancelled' };
          }
          return copyText(url).then(function () {
            return { method: 'copy' };
          });
        });
    }
    return copyText(url).then(function () {
      return { method: 'copy' };
    });
  }

  root.BurnfolderShareLinks = {
    listShares: listShares,
    createShare: createShare,
    revokeShare: revokeShare,
    resolveShare: resolveShare,
    trackPlay: trackPlay,
    listenPageUrl: listenPageUrl,
    watchPageUrl: watchPageUrl,
    copyText: copyText,
    shareOrCopy: shareOrCopy
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
