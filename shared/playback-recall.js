/**
 * Persist last playback session so lock-screen / PWA relaunch can resume.
 *
 * Uses localStorage (not sessionStorage): iOS clears sessionStorage when the
 * standalone PWA is closed or the WebContent process is evicted, which made
 * queues vanish after "closing" Studio.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'burnfolderPlaybackRecall';
  const LEGACY_SESSION_KEY = 'burnfolderPlaybackRecall';

  function storage() {
    try {
      return root.localStorage;
    } catch (e) {
      return null;
    }
  }

  function sessionStore() {
    try {
      return root.sessionStorage;
    } catch (e) {
      return null;
    }
  }

  function readRaw() {
    const ls = storage();
    if (ls) {
      try {
        const raw = ls.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {
        /* fall through */
      }
    }
    /* One-time migrate from older sessionStorage recalls. */
    const ss = sessionStore();
    if (!ss) return null;
    try {
      const legacy = ss.getItem(LEGACY_SESSION_KEY);
      if (!legacy) return null;
      const parsed = JSON.parse(legacy);
      if (parsed && parsed.song) {
        save(parsed);
        try {
          ss.removeItem(LEGACY_SESSION_KEY);
        } catch (e2) {
          /* noop */
        }
        return parsed;
      }
    } catch (e) {
      /* noop */
    }
    return null;
  }

  function normalizeSong(song) {
    if (!song || !song.playbackId) return null;
    return {
      title: String(song.title || song.displayTitle || 'untitled').trim(),
      playbackId: String(song.playbackId).trim(),
      coverArt: song.coverArt || null
    };
  }

  function save(payload) {
    if (!payload || !payload.song || !payload.song.playbackId) return;
    const ls = storage();
    if (!ls) return;
    try {
      ls.setItem(
        STORAGE_KEY,
        JSON.stringify({
          song: normalizeSong(payload.song),
          queue: (payload.queue || []).map(normalizeSong).filter(Boolean),
          queueIdx: typeof payload.queueIdx === 'number' ? payload.queueIdx : 0,
          currentTime: Number(payload.currentTime) || 0,
          wasPlaying: payload.wasPlaying === true,
          savedAt: Date.now()
        })
      );
    } catch (e) {
      /* ignore quota */
    }
  }

  function load(maxAgeMs) {
    const row = readRaw();
    if (!row || !row.song) return null;
    const age = Date.now() - (row.savedAt || 0);
    if (maxAgeMs && age > maxAgeMs) {
      clear();
      return null;
    }
    return {
      song: normalizeSong(row.song),
      queue: (row.queue || []).map(normalizeSong).filter(Boolean),
      queueIdx: typeof row.queueIdx === 'number' ? row.queueIdx : 0,
      currentTime: Number(row.currentTime) || 0,
      wasPlaying: row.wasPlaying === true
    };
  }

  function clear() {
    const ls = storage();
    if (ls) {
      try {
        ls.removeItem(STORAGE_KEY);
      } catch (e) {
        /* noop */
      }
    }
    const ss = sessionStore();
    if (ss) {
      try {
        ss.removeItem(LEGACY_SESSION_KEY);
      } catch (e) {
        /* noop */
      }
    }
  }

  root.BurnfolderPlaybackRecall = {
    save: save,
    load: load,
    clear: clear,
    STORAGE_KEY: STORAGE_KEY
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
