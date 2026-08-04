/**
 * Playback diagnostics — a rolling, on-device log of what the playback
 * engine actually did (not just what it meant to do).
 *
 * Why this exists: lock-screen / backgrounded PWA audio bugs on iOS are
 * notoriously hard to fix blind. There's no way to attach a debugger to a
 * phone that's locked in someone's pocket, and iOS's background JS/network
 * throttling behavior is inconsistent across versions and not something we
 * can reproduce from a dev machine. Instead of guessing again, this records
 * exactly what happened (which events fired, whether play() resolved or
 * rejected and why, whether the tab was foreground/background at the time)
 * to localStorage, so a report can include a real timeline instead of "it
 * didn't work."
 *
 * Safe to remove `shared/playback-debug.js` from a page's script list; every
 * call site checks it's present first.
 *
 * View the recorded log at /studio/debug-playback.html (or open it and tap
 * "Copy" after a failure happens) — no phone access needed either way, since
 * installed-PWA sessions also beacon new entries to /api/playback-debug-log
 * in the background (see enableAutoUpload below), which can be fetched from
 * anywhere with the shared key baked into that function.
 */
(function (root) {
  'use strict';

  const KEY = 'burnfolderPlaybackDebugLog';
  const MAX_ENTRIES = 300;
  const UPLOAD_URL = '/api/playback-debug-log';
  const DEVICE_KEY = 'burnfolderPlaybackDebugDeviceId';
  const MIN_FLUSH_INTERVAL_MS = 2000;

  function storage() {
    try {
      return root.localStorage;
    } catch (e) {
      return null;
    }
  }

  function readLog() {
    const ls = storage();
    if (!ls) return [];
    try {
      const raw = ls.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeLog(entries) {
    const ls = storage();
    if (!ls) return;
    try {
      ls.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    } catch (e) {
      /* quota or private mode — degrade silently */
    }
  }

  function log(event, data) {
    try {
      const entries = readLog();
      entries.push({
        t: Date.now(),
        hidden: typeof document !== 'undefined' ? !!document.hidden : null,
        event: String(event || ''),
        data: data === undefined ? null : data
      });
      writeLog(entries);
      scheduleFlush();
    } catch (e) {
      /* noop — diagnostics must never break playback */
    }
  }

  function clear() {
    const ls = storage();
    if (!ls) return;
    try {
      ls.removeItem(KEY);
      lastUploadedT = 0;
    } catch (e) {
      /* noop */
    }
  }

  // ---- Auto-upload (installed-PWA sessions only) ----------------------
  //
  // Lets a failure be inspected without needing hands-on access to the
  // phone: beacon new entries to the server as they're logged, so the run
  // that just happened on the lock screen can be fetched from anywhere.
  // Scoped to standalone/installed-PWA display mode so regular site
  // visitors (who aren't hitting this bug and outnumber testers by a lot)
  // never generate this traffic.

  // Tracked by timestamp, not array index — the local log trims its oldest
  // entries once it hits MAX_ENTRIES, which would silently shift indices
  // out from under a plain counter and either re-send or drop entries.
  let lastUploadedT = 0;
  let flushTimer = null;
  let lastFlushAt = 0;

  function isStandalone() {
    try {
      return (
        (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) ||
        (root.navigator && root.navigator.standalone === true)
      );
    } catch (e) {
      return false;
    }
  }

  function deviceId() {
    const ls = storage();
    if (!ls) return '';
    try {
      let id = ls.getItem(DEVICE_KEY);
      if (!id) {
        id = Math.random().toString(36).slice(2, 8);
        ls.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      return '';
    }
  }

  function flush(force) {
    try {
      if (!isStandalone()) return;
      const now = Date.now();
      if (!force && now - lastFlushAt < MIN_FLUSH_INTERVAL_MS) return;
      const entries = readLog();
      const pending = entries.filter(function (entry) { return entry.t > lastUploadedT; });
      if (!pending.length) return;
      const payload = JSON.stringify({ device: deviceId(), entries: pending });
      const sent = sendPayload(payload);
      if (sent) {
        lastUploadedT = pending[pending.length - 1].t;
        lastFlushAt = now;
      }
    } catch (e) {
      /* noop — uploading diagnostics must never break playback */
    }
  }

  function sendPayload(payload) {
    try {
      if (root.navigator && typeof root.navigator.sendBeacon === 'function') {
        const blob = new root.Blob([payload], { type: 'application/json' });
        return root.navigator.sendBeacon(UPLOAD_URL, blob);
      }
    } catch (e) {
      /* fall through to fetch */
    }
    try {
      if (typeof root.fetch === 'function') {
        root.fetch(UPLOAD_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(function () {});
        return true;
      }
    } catch (e) {
      /* noop */
    }
    return false;
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = root.setTimeout(function () {
      flushTimer = null;
      flush(false);
    }, 1000);
  }

  function enableAutoUpload() {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) flush(true);
    });
    root.addEventListener('pagehide', function () {
      flush(true);
    });
  }

  enableAutoUpload();

  function pad(n, width) {
    const s = String(n);
    return s.length >= width ? s : '0'.repeat(width - s.length) + s;
  }

  function formatEntry(entry, firstT) {
    const d = new Date(entry.t);
    const time =
      pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2) + '.' + pad(d.getMilliseconds(), 3);
    const rel = firstT != null ? '+' + (entry.t - firstT) + 'ms' : '';
    const vis = entry.hidden === true ? 'bg' : entry.hidden === false ? 'fg' : '??';
    let extra = '';
    if (entry.data !== null && entry.data !== undefined) {
      try {
        extra = ' ' + JSON.stringify(entry.data);
      } catch (e) {
        extra = ' ' + String(entry.data);
      }
    }
    return time + '  [' + vis + ']  ' + rel.padEnd(9) + entry.event + extra;
  }

  function getText() {
    const entries = readLog();
    if (!entries.length) return '(no playback events recorded yet)';
    const firstT = entries[0].t;
    return entries.map(function (entry) {
      return formatEntry(entry, firstT);
    }).join('\n');
  }

  root.BurnfolderPlaybackDebug = {
    log: log,
    clear: clear,
    getLog: readLog,
    getText: getText,
    flushNow: function () { flush(true); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
