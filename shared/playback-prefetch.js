/**
 * Preload Mux streams like a streaming app: CDN warm-up, hidden player pool,
 * queue-ahead, and duration cache (avoids spawning a new mux-player per row).
 */
(function (root) {
  'use strict';

  const POOL_SIZE = 2;
  const DURATION_KEY = 'burnfolderMuxDurations';
  const PRECONNECT_ORIGINS = [
    'https://cdn.jsdelivr.net',
    'https://stream.mux.com',
    'https://image.mux.com',
    'https://www.mux.com'
  ];

  let poolHost = null;
  let pool = [];
  let preconnectDone = false;
  let activePlayer = null;
  const scheduled = new Set();
  const artworkWarmed = new Set();

  function initPreconnect() {
    if (preconnectDone || !document.head) return;
    preconnectDone = true;
    PRECONNECT_ORIGINS.forEach(function (origin) {
      if (document.querySelector('link[rel="preconnect"][href="' + origin + '"]')) return;
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = origin;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    });
  }

  function readDurationCache() {
    try {
      const raw = root.sessionStorage.getItem(DURATION_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeDurationCache(playbackId, seconds) {
    if (!playbackId || !Number.isFinite(seconds) || seconds <= 0) return;
    try {
      const cache = readDurationCache();
      cache[playbackId] = Math.round(seconds * 10) / 10;
      root.sessionStorage.setItem(DURATION_KEY, JSON.stringify(cache));
    } catch (e) {
      /* ignore quota */
    }
  }

  function getCachedDuration(playbackId) {
    if (!playbackId) return null;
    const hit = readDurationCache()[playbackId];
    return Number.isFinite(hit) && hit > 0 ? hit : null;
  }

  function formatDuration(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return '';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function warmArtwork(playbackId, coverArt) {
    if (coverArt) {
      const url =
        window.BurnfolderMediaSession && window.BurnfolderMediaSession.resolveArtworkUrl
          ? window.BurnfolderMediaSession.resolveArtworkUrl(coverArt)
          : String(coverArt).trim();
      if (url) {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
      }
      return;
    }
    if (!playbackId || artworkWarmed.has(playbackId)) return;
    artworkWarmed.add(playbackId);
    const img = new Image();
    img.decoding = 'async';
    img.src =
      'https://image.mux.com/' +
      playbackId +
      '/thumbnail.jpg?time=1&width=512';
  }

  function ensurePool() {
    if (pool.length) return;
    poolHost = document.createElement('div');
    poolHost.id = 'burnfolderPrefetchPool';
    poolHost.hidden = true;
    poolHost.setAttribute('aria-hidden', 'true');
    poolHost.style.cssText =
      'position:absolute;width:0;height:0;overflow:hidden;clip:rect(0,0,0,0);';
    document.body.appendChild(poolHost);

    for (let i = 0; i < POOL_SIZE; i += 1) {
      const el = document.createElement('mux-player');
      el.setAttribute('preload', 'metadata');
      el.setAttribute('playsinline', '');
      el.setAttribute('audio', '');
      el.setAttribute('stream-type', 'on-demand');
      el.setAttribute('muted', '');
      el.style.cssText = 'width:0;height:0;position:absolute;left:-9999px;';
      poolHost.appendChild(el);
      pool.push({ el: el, playbackId: '' });
    }
  }

  function pickPoolSlot(playbackId) {
    ensurePool();
    let slot = pool.find(function (entry) {
      return entry.playbackId === playbackId;
    });
    if (slot) return slot;
    slot = pool.find(function (entry) {
      return !entry.playbackId;
    });
    if (slot) return slot;
    return pool[0];
  }

  function prefetch(playbackId, opts) {
    const id = String(playbackId || '').trim();
    if (!id || scheduled.has(id)) return;
    if (activePlayer && activePlayer.getAttribute('playback-id') === id) return;

    const options = opts || {};
    scheduled.add(id);

    const slot = pickPoolSlot(id);
    slot.playbackId = id;
    slot.el.setAttribute('playback-id', id);
    slot.el.setAttribute('preload', options.aggressive ? 'auto' : 'metadata');

    warmArtwork(id);

    slot.el.addEventListener(
      'loadedmetadata',
      function () {
        scheduled.delete(id);
        const d = slot.el.duration;
        if (d && Number.isFinite(d)) writeDurationCache(id, d);
        if (options.durEl) options.durEl.textContent = formatDuration(d);
        root.dispatchEvent(
          new CustomEvent('burnfolder-duration-ready', {
            detail: { playbackId: id, duration: d }
          })
        );
      },
      { once: true }
    );
    slot.el.addEventListener(
      'error',
      function () {
        scheduled.delete(id);
      },
      { once: true }
    );
  }

  function prefetchUpcoming(queue, idx) {
    if (!Array.isArray(queue)) return;
    const next = queue[idx + 1];
    const after = queue[idx + 2];
    if (next && next.playbackId) prefetch(next.playbackId, { aggressive: true });
    if (after && after.playbackId) {
      root.setTimeout(function () {
        prefetch(after.playbackId);
      }, 350);
    }
  }

  function prefetchList(playbackIds, limit) {
    const max = typeof limit === 'number' ? limit : 5;
    (playbackIds || [])
      .filter(Boolean)
      .slice(0, max)
      .forEach(function (id, index) {
        root.setTimeout(function () {
          prefetch(id);
        }, index * 100);
      });
  }

  function attachRow(row, getPlaybackId) {
    if (!row || row.dataset.prefetchBound === '1') return;
    row.dataset.prefetchBound = '1';
    const run = function () {
      const id =
        typeof getPlaybackId === 'function' ? getPlaybackId() : getPlaybackId;
      if (id) prefetch(id);
    };
    row.addEventListener('pointerenter', run, { passive: true });
    row.addEventListener('touchstart', run, { passive: true });
  }

  function applyDurationToElement(durEl, playbackId, knownSeconds) {
    if (!durEl) return false;
    const seconds =
      Number.isFinite(Number(knownSeconds)) && Number(knownSeconds) > 0
        ? Number(knownSeconds)
        : getCachedDuration(playbackId);
    if (!seconds) return false;
    durEl.textContent = formatDuration(seconds);
    return true;
  }

  function requestDuration(durEl, playbackId, knownSeconds) {
    if (applyDurationToElement(durEl, playbackId, knownSeconds)) return;
    if (!playbackId || !durEl) return;
    prefetch(playbackId, { durEl: durEl });
  }

  function pinOffscreenPlayer(player) {
    const guard = root.BurnfolderPlaybackScrollGuard;
    if (guard && guard.pinHiddenPlayer) {
      guard.pinHiddenPlayer(player);
      return;
    }
    if (!player || !player.style) return;
    player.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;clip:rect(0,0,0,0);';
  }

  function setActivePlayer(player) {
    activePlayer = player || null;
    if (!player) return;
    player.setAttribute('stream-type', 'on-demand');
    player.setAttribute('preload', 'auto');
    player.setAttribute('playsinline', '');
    pinOffscreenPlayer(player);
  }

  function warmLibraryItems(items, isVideoFn, limit) {
    const ids = (items || [])
      .filter(function (item) {
        if (!item || !item.playbackId) return false;
        if (typeof isVideoFn === 'function' && isVideoFn(item)) return false;
        return true;
      })
      .slice(0, limit || 6)
      .map(function (item) {
        return item.playbackId;
      });
    prefetchList(ids, ids.length);
  }

  initPreconnect();

  root.BurnfolderPlaybackPrefetch = {
    init: initPreconnect,
    prefetch: prefetch,
    prefetchUpcoming: prefetchUpcoming,
    prefetchList: prefetchList,
    attachRow: attachRow,
    getCachedDuration: getCachedDuration,
    formatDuration: formatDuration,
    applyDurationToElement: applyDurationToElement,
    requestDuration: requestDuration,
    setActivePlayer: setActivePlayer,
    warmArtwork: warmArtwork,
    warmLibraryItems: warmLibraryItems
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
