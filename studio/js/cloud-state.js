/**
 * Personal cloud state — single-user key/value sync backed by the
 * studio-state Netlify function (Netlify Blobs). Used to keep studio-authored
 * data (projects/albums, drafts) in sync across browsers and devices.
 *
 * Model: last-write-wins. Each key holds one JSON document. Reads return the
 * stored value (or null); writes are debounced per key.
 */
(function () {
  'use strict';

  function getApiBase() {
    const cfg = window.BurnfolderStudioConfig || {};
    if (cfg.muxApiBase) return String(cfg.muxApiBase).replace(/\/$/, '');
    if (location.port === '8888' || location.hostname.endsWith('.netlify.app')) {
      return '/.netlify/functions';
    }
    return 'http://localhost:8888/.netlify/functions';
  }

  function whenReady() {
    if (window.BurnfolderStudioAuth && window.BurnfolderStudioAuth.whenReady) {
      return window.BurnfolderStudioAuth.whenReady();
    }
    return Promise.resolve();
  }

  // --- sync status (drives the header "cloud" indicator) -------------------
  let inflight = 0;
  let currentStatus = 'idle';

  function emitStatus(status) {
    currentStatus = status;
    try {
      window.dispatchEvent(new CustomEvent('burnfolder-cloud-state', { detail: { status: status } }));
    } catch (e) {
      /* noop */
    }
  }

  function begin() {
    inflight += 1;
    emitStatus('syncing');
  }

  function settle(ok) {
    inflight = Math.max(0, inflight - 1);
    if (inflight > 0) {
      emitStatus('syncing');
      return;
    }
    emitStatus(ok ? 'synced' : 'offline');
  }

  function get(key) {
    return whenReady().then(function () {
      begin();
      return fetch(getApiBase() + '/studio-state?key=' + encodeURIComponent(key))
        .then(function (res) {
          if (!res.ok) throw new Error('cloud read failed (' + res.status + ')');
          return res.json();
        })
        .then(function (data) {
          settle(true);
          return data && 'value' in data ? data.value : null;
        })
        .catch(function (err) {
          settle(false);
          throw err;
        });
    });
  }

  const pending = {};

  function pushNow(key, value, keepalive) {
    return whenReady().then(function () {
      begin();
      return fetch(getApiBase() + '/studio-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key, value: value }),
        keepalive: !!keepalive
      }).then(function (res) {
        if (!res.ok) throw new Error('cloud write failed (' + res.status + ')');
        return res.json();
      }).then(function (data) {
        settle(true);
        return data;
      }).catch(function (err) {
        settle(false);
        throw err;
      });
    });
  }

  /** Debounced write — coalesces rapid edits (typing a project name, etc.). */
  function put(key, value, delayMs) {
    const wait = typeof delayMs === 'number' ? delayMs : 600;
    if (pending[key]) {
      window.clearTimeout(pending[key].timer);
    }
    const entry = { value: value };
    entry.promise = new Promise(function (resolve, reject) {
      entry.timer = window.setTimeout(function () {
        delete pending[key];
        pushNow(key, entry.value).then(resolve).catch(reject);
      }, wait);
    });
    pending[key] = entry;
    // Swallow rejection on the stored promise so unhandled rejections don't
    // surface; callers that care can use put(...).catch().
    entry.promise.catch(function () {});
    return entry.promise;
  }

  function flush(key) {
    const entry = pending[key];
    if (!entry) return Promise.resolve();
    window.clearTimeout(entry.timer);
    delete pending[key];
    return pushNow(key, entry.value);
  }

  // When the tab is hidden / backgrounded (e.g. switching apps on a phone),
  // flush any debounced writes immediately with keepalive so nothing is lost.
  function flushAllKeepalive() {
    Object.keys(pending).forEach(function (key) {
      const entry = pending[key];
      if (!entry) return;
      window.clearTimeout(entry.timer);
      delete pending[key];
      pushNow(key, entry.value, true).catch(function () {});
    });
  }

  window.addEventListener('pagehide', flushAllKeepalive);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushAllKeepalive();
  });

  const STATUS_LABELS = {
    idle: 'cloud',
    syncing: 'saving…',
    synced: 'synced',
    offline: 'offline'
  };

  // Small "cloud" indicator in the studio header so you can trust your data is
  // saved before closing the app on the go.
  function ensureNavTools() {
    const nav = document.querySelector('.studio-main-nav');
    if (!nav) return null;
    let tools = nav.querySelector('.studio-nav-tools');
    if (!tools) {
      tools = document.createElement('span');
      tools.className = 'studio-nav-tools';
      nav.appendChild(tools);
    }
    return tools;
  }

  function mountIndicator() {
    const tools = ensureNavTools();
    if (!tools || tools.querySelector('.studio-sync')) return;

    const el = document.createElement('span');
    el.className = 'studio-sync is-idle';
    el.innerHTML =
      '<span class="studio-sync-dot" aria-hidden="true"></span>' +
      '<span class="studio-sync-label"></span>';
    tools.appendChild(el);

    function render(status) {
      const known = STATUS_LABELS[status] ? status : 'idle';
      el.classList.remove('is-idle', 'is-syncing', 'is-synced', 'is-offline');
      el.classList.add('is-' + known);
      el.querySelector('.studio-sync-label').textContent = STATUS_LABELS[known];
      el.setAttribute('title', 'personal cloud: ' + STATUS_LABELS[known]);
    }

    window.addEventListener('burnfolder-cloud-state', function (event) {
      render(event.detail && event.detail.status);
    });
    render(currentStatus);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountIndicator);
  } else {
    mountIndicator();
  }

  window.BurnfolderCloudState = {
    get: get,
    put: put,
    pushNow: pushNow,
    flush: flush,
    getStatus: function () {
      return currentStatus;
    },
    isAvailable: function () {
      return location.port === '8888' || location.hostname.endsWith('.netlify.app') ||
        !!(window.BurnfolderStudioConfig && window.BurnfolderStudioConfig.muxApiBase);
    }
  };
})();
