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
 * "Copy" after a failure happens).
 */
(function (root) {
  'use strict';

  const KEY = 'burnfolderPlaybackDebugLog';
  const MAX_ENTRIES = 300;

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
    } catch (e) {
      /* noop — diagnostics must never break playback */
    }
  }

  function clear() {
    const ls = storage();
    if (!ls) return;
    try {
      ls.removeItem(KEY);
    } catch (e) {
      /* noop */
    }
  }

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
    getText: getText
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
