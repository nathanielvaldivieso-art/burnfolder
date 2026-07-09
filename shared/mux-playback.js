/**
 * Shared Mux audio playback — same core logic as scripts.js (burnfolder.com).
 * Do not call player.load() after changing playback-id; mux-player updates automatically.
 */
(function (root) {
  'use strict';

  const recallApi = root.BurnfolderPlaybackRecall;
  const mediaSessionApi = root.BurnfolderMediaSession;

  function resolvePlayer(playerOrId) {
    if (!playerOrId) return null;
    if (typeof playerOrId === 'string') return document.getElementById(playerOrId);
    return playerOrId;
  }

  function normalizeSong(song) {
    if (!song || !song.playbackId) return null;
    return {
      title: String(song.title || song.displayTitle || 'untitled').trim(),
      playbackId: String(song.playbackId).trim(),
      coverArt: song.coverArt || null,
      album: song.album || null,
      artist: song.artist || null
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
    let positionBound = false;
    let endedPlayer = null;
    let recallTimer = null;
    let mediaActionsBound = false;
    let queueAdvanceLock = false;
    let hiddenAdvanceTimer = null;
    let lifecycleBound = false;

    function notify(extra) {
      const player = getPlayer();
      const detail = Object.assign(
        {
          song: activeSong,
          playing: !!(activeSong && player && !player.paused),
          queue: activeQueue.slice(),
          queueIdx: activeQueueIdx
        },
        extra || {}
      );
      if (typeof opts.onStateChange === 'function') {
        opts.onStateChange(detail);
      }
      try {
        root.dispatchEvent(new CustomEvent('burnfolder-playback-changed', { detail: detail }));
      } catch (e) {
        /* noop */
      }
      syncMediaSession(detail);
      scheduleRecallSave();
    }

    function scheduleRecallSave() {
      if (opts.recall === false || !recallApi) return;
      window.clearTimeout(recallTimer);
      recallTimer = window.setTimeout(persistRecall, 350);
    }

    function persistRecall() {
      if (opts.recall === false || !recallApi || !activeSong) return;
      const player = getPlayer();
      recallApi.save({
        song: activeSong,
        queue: activeQueue,
        queueIdx: activeQueueIdx,
        currentTime: player ? player.currentTime : 0,
        wasPlaying: !!(player && !player.paused)
      });
    }

    function syncMediaSession(detail) {
      if (!mediaSessionApi) return;
      const player = getPlayer();
      if (!detail.song) {
        mediaSessionApi.setPlaybackState(false);
        return;
      }
      mediaSessionApi.setMetadata(detail.song, detail, {
        artist: opts.artist,
        album: opts.album,
        artworkForSong: opts.artworkForSong
      });
      mediaSessionApi.setPositionState(player);
    }

    function bindMediaSessionActions() {
      if (!mediaSessionApi || mediaActionsBound) return;
      mediaActionsBound = true;
      mediaSessionApi.bindActions({
        play: function () {
          togglePlayPause(true);
        },
        pause: function () {
          togglePlayPause(false);
        },
        previoustrack: function () {
          if (activeQueueIdx > 0) {
            playQueuedTrack(activeQueueIdx - 1);
            return;
          }
          const player = getPlayer();
          if (player) {
            player.currentTime = 0;
            notify();
          }
        },
        nexttrack: function () {
          if (activeQueueIdx + 1 < activeQueue.length) {
            playQueuedTrack(activeQueueIdx + 1);
          }
        },
        seekbackward: function (details) {
          const player = getPlayer();
          if (!player) return;
          const skip = (details && Number(details.seekOffset)) || 10;
          player.currentTime = Math.max(0, (player.currentTime || 0) - skip);
          notify();
          mediaSessionApi.setPositionState(player);
        },
        seekforward: function (details) {
          const player = getPlayer();
          if (!player) return;
          const skip = (details && Number(details.seekOffset)) || 10;
          const duration = Number(player.duration);
          const next = (player.currentTime || 0) + skip;
          player.currentTime = Number.isFinite(duration) ? Math.min(next, duration) : next;
          notify();
          mediaSessionApi.setPositionState(player);
        },
        seekto: function (details) {
          const player = getPlayer();
          if (!player || !details || !Number.isFinite(details.seekTime)) return;
          const duration = Number(player.duration);
          const target = details.seekTime;
          player.currentTime = Number.isFinite(duration)
            ? Math.max(0, Math.min(target, duration))
            : Math.max(0, target);
          notify();
          mediaSessionApi.setPositionState(player);
        }
      });
    }

    function bindPositionUpdates(player) {
      if (!player || positionBound || !mediaSessionApi) return;
      if (endedPlayer !== player) return;
      positionBound = true;
      player.addEventListener('timeupdate', function () {
        if (!activeSong) return;
        mediaSessionApi.setPositionState(player);
        scheduleRecallSave();
      });
    }

    function retryPlay(player, song, allowBlockedFallback) {
      if (!player || !song) return;
      if (typeof player.play !== 'function') {
        if (typeof customElements !== 'undefined' && customElements.get('mux-player')) {
          try {
            customElements.upgrade(player);
          } catch (e) {
            /* noop */
          }
        }
        if (typeof player.play !== 'function' && typeof customElements !== 'undefined') {
          customElements.whenDefined('mux-player').then(function () {
            try {
              customElements.upgrade(player);
            } catch (e) {
              /* noop */
            }
            retryPlay(player, song, allowBlockedFallback);
          });
          return;
        }
      }
      const playPromise = player.play();
      if (playPromise === undefined) return;
      playPromise.catch(function () {
        if (allowBlockedFallback === false) return;
        if (typeof opts.onPlayBlocked === 'function') {
          opts.onPlayBlocked(player, song);
          return;
        }
        if (typeof player.play === 'function') {
          player.play().catch(function () {});
        }
      });
    }

    function advanceThresholdSec() {
      /* iOS throttles timeupdate when locked — advance slightly early. */
      if (typeof document !== 'undefined' && document.hidden) return 1.5;
      return 0.5;
    }

    function stopHiddenAdvancePoll() {
      if (hiddenAdvanceTimer === null) return;
      window.clearInterval(hiddenAdvanceTimer);
      hiddenAdvanceTimer = null;
    }

    function startHiddenAdvancePoll(player) {
      if (hiddenAdvanceTimer !== null || !player) return;
      hiddenAdvanceTimer = window.setInterval(function () {
        if (!document.hidden) {
          stopHiddenAdvancePoll();
          return;
        }
        if (!activeSong || queueAdvanceLock) return;
        if (player.ended) {
          advanceQueueAfterEnd(player);
          return;
        }
        maybeAdvanceQueue(player);
      }, 400);
    }

    function resumeIfBackgroundPaused(player) {
      if (!player || !activeSong || !player.paused) return;
      if (opts.recall === false || !recallApi) return;
      const recall = recallApi.load(1000 * 60 * 60 * 12);
      if (
        !recall ||
        !recall.wasPlaying ||
        !recall.song ||
        recall.song.playbackId !== activeSong.playbackId
      ) {
        return;
      }
      retryPlay(player, activeSong, false);
    }

    function maybeAdvanceQueue(player) {
      if (queueAdvanceLock || !player || !activeSong) return false;

      if (player.ended) {
        advanceQueueAfterEnd(player);
        return true;
      }

      const duration = Number(player.duration);
      const current = Number(player.currentTime);
      const atEnd =
        Number.isFinite(duration) &&
        duration > 0 &&
        Number.isFinite(current) &&
        current >= duration - 0.08;
      if (atEnd) {
        advanceQueueAfterEnd(player);
        return true;
      }

      const hidden = typeof document !== 'undefined' && document.hidden;
      if (player.paused && !hidden) return false;

      if (!Number.isFinite(duration) || duration <= 0) return false;
      if (!Number.isFinite(current) || current < 0) return false;
      const remaining = duration - current;
      if (remaining > advanceThresholdSec()) return false;

      const nextIdx = activeQueueIdx + 1;
      if (nextIdx >= activeQueue.length) return false;

      queueAdvanceLock = true;
      playQueuedTrack(nextIdx, { immediatePlay: true, seamlessAdvance: true });
      return true;
    }

    function advanceQueueAfterEnd(player) {
      const nextIdx = activeQueueIdx + 1;
      if (nextIdx < activeQueue.length) {
        queueAdvanceLock = true;
        playQueuedTrack(nextIdx, { immediatePlay: true, seamlessAdvance: true });
      } else {
        notify({ playing: false });
      }
    }

    function bindEnded(player) {
      if (opts.bindEnded === false || !player) return;
      if (endedPlayer === player && endedBound) return;
      endedPlayer = player;
      endedBound = true;
      positionBound = false;
      function onEnded() {
        advanceQueueAfterEnd(player);
      }
      player.addEventListener('ended', onEnded);
      const nativeMedia = player.media;
      if (nativeMedia && nativeMedia !== player && typeof nativeMedia.addEventListener === 'function') {
        nativeMedia.addEventListener('ended', onEnded);
      }
      player.addEventListener('timeupdate', function () {
        maybeAdvanceQueue(player);
      });
      player.addEventListener('play', function () {
        queueAdvanceLock = false;
        notify();
      });
      player.addEventListener('pause', notify);
      bindPositionUpdates(player);

      if (typeof document !== 'undefined' && !lifecycleBound) {
        lifecycleBound = true;
        document.addEventListener('visibilitychange', function () {
          const livePlayer = getPlayer();
          if (!livePlayer) return;
          if (document.hidden) {
            persistRecall();
            startHiddenAdvancePoll(livePlayer);
            maybeAdvanceQueue(livePlayer);
            return;
          }
          stopHiddenAdvancePoll();
          if (livePlayer.ended) {
            advanceQueueAfterEnd(livePlayer);
            return;
          }
          maybeAdvanceQueue(livePlayer);
          resumeIfBackgroundPaused(livePlayer);
        });
        window.addEventListener('pagehide', persistRecall);
        window.addEventListener('pageshow', function (event) {
          if (!event.persisted) return;
          const livePlayer = getPlayer();
          if (!livePlayer) return;
          if (livePlayer.ended) {
            advanceQueueAfterEnd(livePlayer);
            return;
          }
          maybeAdvanceQueue(livePlayer);
          resumeIfBackgroundPaused(livePlayer);
        });
      }
    }

    function applyRecallPosition(player, recall) {
      if (!player || !recall || !recall.currentTime) return;
      const seek = function () {
        try {
          player.currentTime = recall.currentTime;
        } catch (e) {
          /* noop */
        }
      };
      if (player.readyState >= 1) seek();
      else player.addEventListener('loadedmetadata', seek, { once: true });
    }

    function startPlayback(song, queueSongs, queueIdx, playbackOpts) {
      const player = getPlayer();
      const normalized = normalizeSong(song);
      if (!player || !normalized) {
        queueAdvanceLock = false;
        return false;
      }

      if (!player.getAttribute('audio')) {
        player.setAttribute('audio', '');
      }
      if (!player.getAttribute('playsinline')) {
        player.setAttribute('playsinline', '');
      }
      if (!player.getAttribute('stream-type')) {
        player.setAttribute('stream-type', 'on-demand');
      }

      queueAdvanceLock = false;
      const startOpts = playbackOpts || {};
      const immediatePlay =
        startOpts.immediatePlay !== false &&
        !(startOpts.recall && startOpts.recall.wasPlaying === false);

      activeSong = normalized;
      activeQueue =
        Array.isArray(queueSongs) && queueSongs.length
          ? queueSongs.map(normalizeSong).filter(Boolean)
          : [normalized];
      activeQueueIdx = typeof queueIdx === 'number' ? queueIdx : 0;

      bindEnded(player);
      bindMediaSessionActions();

      const sameSource = player.getAttribute('playback-id') === normalized.playbackId;
      if (!sameSource) {
        if (!startOpts.seamlessAdvance) {
          player.pause();
          player.currentTime = 0;
        }
        player.setAttribute('playback-id', normalized.playbackId);
      }
      player.setAttribute('metadata-video-title', normalized.title);

      if (root.BurnfolderPlaybackPrefetch) {
        root.BurnfolderPlaybackPrefetch.setActivePlayer(player);
      }

      notify();

      function ensurePlaying() {
        if (
          !activeSong ||
          activeSong.playbackId !== normalized.playbackId ||
          !player.paused
        ) {
          return;
        }
        retryPlay(player, normalized, true);
      }

      // iOS requires play() during the tap handler — don't wait for canplay first.
      if (immediatePlay) {
        retryPlay(player, normalized, false);
      }

      function onMediaReady() {
        if (startOpts.recall && startOpts.recall.currentTime) {
          applyRecallPosition(player, startOpts.recall);
        }
        if (startOpts.recall && startOpts.recall.wasPlaying === false) {
          player.pause();
          notify({ playing: false });
          return;
        }
        if (player.paused) ensurePlaying();
      }

      player.addEventListener('canplay', onMediaReady, { once: true });
      player.addEventListener('loadedmetadata', onMediaReady, { once: true });

      window.setTimeout(function () {
        if (
          player.paused &&
          activeSong &&
          activeSong.playbackId === normalized.playbackId &&
          !(startOpts.recall && startOpts.recall.wasPlaying === false)
        ) {
          ensurePlaying();
        }
        if (typeof opts.onAfterStart === 'function') {
          opts.onAfterStart(player, normalized);
        }
        persistRecall();
      }, 100);

      if (typeof document !== 'undefined' && document.hidden) {
        window.setTimeout(function () {
          if (
            player.paused &&
            activeSong &&
            activeSong.playbackId === normalized.playbackId &&
            !(startOpts.recall && startOpts.recall.wasPlaying === false)
          ) {
            ensurePlaying();
          }
        }, 800);
      }

      if (root.BurnfolderPlaybackPrefetch) {
        root.BurnfolderPlaybackPrefetch.prefetchUpcoming(activeQueue, activeQueueIdx);
        root.BurnfolderPlaybackPrefetch.warmArtwork(normalized.playbackId, normalized.coverArt);
      }

      return true;
    }

    function primeTrack(song) {
      const normalized = normalizeSong(song);
      if (!normalized) return false;
      // Prefer the prefetch pool. Rewriting #activeMuxPlayer on hover/touch-down
      // caused intermittent wrong-song starts when the live element raced play().
      if (root.BurnfolderPlaybackPrefetch && root.BurnfolderPlaybackPrefetch.prefetch) {
        root.BurnfolderPlaybackPrefetch.prefetch(normalized.playbackId);
        if (normalized.coverArt && root.BurnfolderPlaybackPrefetch.warmArtwork) {
          root.BurnfolderPlaybackPrefetch.warmArtwork(normalized.playbackId, normalized.coverArt);
        }
        return true;
      }
      const player = getPlayer();
      if (!player) return false;
      if (activeSong && activeSong.playbackId && activeSong.playbackId !== normalized.playbackId) {
        return false;
      }
      if (player.getAttribute('playback-id') === normalized.playbackId) return true;
      player.setAttribute('preload', 'auto');
      player.setAttribute('playback-id', normalized.playbackId);
      player.setAttribute('metadata-video-title', normalized.title);
      return true;
    }

    function playTrackQueue(queueSongs, queueStartIdx, playbackOpts) {
      if (!Array.isArray(queueSongs) || !queueSongs.length) return false;
      const start = typeof queueStartIdx === 'number' ? queueStartIdx : 0;
      const song = normalizeSong(queueSongs[start]);
      if (!song) return false;
      return startPlayback(song, queueSongs, start, playbackOpts);
    }

    function playQueuedTrack(queueIdx, playbackOpts) {
      const song = activeQueue[queueIdx];
      if (!song) return false;
      const trackOpts = playbackOpts || {};
      if (trackOpts.immediatePlay == null) trackOpts.immediatePlay = true;
      return startPlayback(song, activeQueue, queueIdx, trackOpts);
    }

    function togglePlayPause(forcePlay) {
      const player = getPlayer();
      if (!player || !activeSong) return;
      const shouldPlay = typeof forcePlay === 'boolean' ? forcePlay : player.paused;
      if (shouldPlay) {
        notify({ playing: true });
        player.play().catch(function () {
          notify({ playing: false });
          retryPlay(player, activeSong);
        });
      } else {
        player.pause();
        notify({ playing: false });
      }
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
      if (recallApi && opts.recall !== false) recallApi.clear();
      notify();
      return true;
    }

    function restoreRecall(recallOpts) {
      if (opts.recall === false || !recallApi) return false;
      const maxAge = recallOpts && recallOpts.maxAgeMs ? recallOpts.maxAgeMs : 1000 * 60 * 60 * 12;
      const recall = recallApi.load(maxAge);
      if (!recall || !recall.song) return false;
      const queue = recall.queue && recall.queue.length ? recall.queue : [recall.song];
      let idx = recall.queueIdx;
      if (idx < 0 || idx >= queue.length) idx = 0;
      return startPlayback(recall.song, queue, idx, {
        recall: Object.assign({}, recall, { wasPlaying: false }),
        immediatePlay: false
      });
    }

    if (opts.restoreRecall !== false && recallApi) {
      window.setTimeout(function () {
        if (!activeSong) restoreRecall(opts.recallOptions);
      }, 0);
    }

    return {
      startPlayback: startPlayback,
      playTrackQueue: playTrackQueue,
      playQueuedTrack: playQueuedTrack,
      primeTrack: primeTrack,
      togglePlayPause: togglePlayPause,
      stop: stop,
      restoreRecall: restoreRecall,
      persistRecall: persistRecall,
      getActiveSong: function () {
        return activeSong;
      },
      getActiveQueue: function () {
        return activeQueue.slice();
      },
      getActiveQueueIdx: function () {
        return activeQueueIdx;
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
