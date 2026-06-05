/**
 * Persist last playback session so headphones / lock-screen can resume after navigation.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'burnfolderPlaybackRecall';

  function readRaw() {
    try {
      const raw = root.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function normalizeSong(song) {
    if (!song || !song.playbackId) return null;
    return {
      title: String(song.title || song.displayTitle || 'untitled').trim(),
      playbackId: String(song.playbackId).trim()
    };
  }

  function save(payload) {
    if (!payload || !payload.song || !payload.song.playbackId) return;
    try {
      root.sessionStorage.setItem(
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
    try {
      root.sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* noop */
    }
  }

  root.BurnfolderPlaybackRecall = {
    save: save,
    load: load,
    clear: clear,
    STORAGE_KEY: STORAGE_KEY
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
