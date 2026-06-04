/**
 * Shared Mux audio playback — same core logic as scripts.js (burnfolder.com).
 * Do not call player.load() after changing playback-id; mux-player updates automatically.
 */
(function (root) {
  'use strict';

  function resolvePlayer(playerOrId) {
    if (!playerOrId) return null;
    if (typeof playerOrId === 'string') return document.getElementById(playerOrId);
    return playerOrId;
  }

  function normalizeSong(song) {
    if (!song || !song.playbackId) return null;
    return {
      title: String(song.title || song.displayTitle || 'untitled').trim(),
      playbackId: String(song.playbackId).trim()
    };
  }

  function create(options) {
    const opts = options || {};
    const getPlayer =
      opts.getPlayer ||
      function () {
        return resolvePlayer(opts.playerId || 'activeMuxPlayer');
      };

    let activeSong = null;
    let activeQueue = [];
    let activeQueueIdx = 0;
    let endedBound = false;

    function notify() {
      const player = getPlayer();
      const detail = {
        song: activeSong,
        playing: !!(activeSong && player && !player.paused)
      };
      if (typeof opts.onStateChange === 'function') {
        opts.onStateChange(detail);
      }
      try {
        root.dispatchEvent(new CustomEvent('burnfolder-playback-changed', { detail: detail }));
      } catch (e) {
        /* noop */
      }
    }

    function retryPlay(player, song) {
      if (!player || !song) return;
      if (typeof opts.onPlayBlocked === 'function') {
        opts.onPlayBlocked(player, song);
        return;
      }
      player.play().catch(function () {});
    }

    function bindEnded(player) {
      if (opts.bindEnded === false || !player || endedBound) return;
      endedBound = true;
      player.addEventListener('ended', function () {
        const nextIdx = activeQueueIdx + 1;
        if (nextIdx < activeQueue.length) {
          playQueuedTrack(nextIdx);
        } else {
          notify();
        }
      });
      player.addEventListener('play', notify);
      player.addEventListener('pause', notify);
    }

    function startPlayback(song, queueSongs, queueIdx) {
      const player = getPlayer();
      const normalized = normalizeSong(song);
      if (!player || !normalized) return false;

      activeSong = normalized;
      activeQueue =
        Array.isArray(queueSongs) && queueSongs.length
          ? queueSongs.map(normalizeSong).filter(Boolean)
          : [normalized];
      activeQueueIdx = typeof queueIdx === 'number' ? queueIdx : 0;

      bindEnded(player);

      player.pause();
      player.currentTime = 0;
      player.setAttribute('playback-id', normalized.playbackId);
      player.setAttribute('metadata-video-title', normalized.title);

      notify();

      const playPromise = player.play();
      if (playPromise !== undefined) {
        playPromise.catch(function () {
          retryPlay(player, normalized);
        });
      }

      window.setTimeout(function () {
        if (
          player.paused &&
          activeSong &&
          activeSong.playbackId === normalized.playbackId
        ) {
          retryPlay(player, normalized);
        }
        if (typeof opts.onAfterStart === 'function') {
          opts.onAfterStart(player, normalized);
        }
      }, 100);

      return true;
    }

    function playTrackQueue(queueSongs, queueStartIdx) {
      if (!Array.isArray(queueSongs) || !queueSongs.length) return false;
      const start = typeof queueStartIdx === 'number' ? queueStartIdx : 0;
      const song = normalizeSong(queueSongs[start]);
      if (!song) return false;
      return startPlayback(song, queueSongs, start);
    }

    function playQueuedTrack(queueIdx) {
      const song = activeQueue[queueIdx];
      if (!song) return false;
      return startPlayback(song, activeQueue, queueIdx);
    }

    function togglePlayPause() {
      const player = getPlayer();
      if (!player || !activeSong) return;
      if (player.paused) {
        player.play().catch(function () {
          retryPlay(player, activeSong);
        });
      } else {
        player.pause();
      }
      notify();
    }

    function stop() {
      const player = getPlayer();
      activeSong = null;
      activeQueue = [];
      activeQueueIdx = 0;
      if (player) {
        player.pause();
        player.removeAttribute('playback-id');
      }
      notify();
      return true;
    }

    return {
      startPlayback: startPlayback,
      playTrackQueue: playTrackQueue,
      playQueuedTrack: playQueuedTrack,
      togglePlayPause: togglePlayPause,
      stop: stop,
      getActiveSong: function () {
        return activeSong;
      },
      isPlayingPlaybackId: function (id) {
        const player = getPlayer();
        return !!(
          activeSong &&
          activeSong.playbackId === id &&
          player &&
          !player.paused
        );
      },
      isActivePlaybackId: function (id) {
        return !!(activeSong && activeSong.playbackId === id);
      }
    };
  }

  root.BurnfolderMuxPlayback = {
    create: create,
    normalizeSong: normalizeSong
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
