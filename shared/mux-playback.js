/**
 * Shared Mux audio playback — same core logic as scripts.js (burnfolder.com).
 * Do not call player.load() after changing playback-id; mux-player updates automatically.
 */
(function (root) {
  'use strict';

  const recallApi = root.BurnfolderPlaybackRecall;
  const mediaSessionApi = root.BurnfolderMediaSession;
  const playerEventBindings =
    typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  let activePlaybackBinding = null;
  let documentLifecycleBound = false;

  function bindDocumentLifecycle(binding) {
    activePlaybackBinding = binding;
    if (documentLifecycleBound || typeof document === 'undefined') return;
    documentLifecycleBound = true;

    document.addEventListener('visibilitychange', function () {
      const b = activePlaybackBinding;
      if (!b) return;
      const livePlayer = b.getPlayer();
      if (!livePlayer) return;
      if (document.hidden) {
        b.persistRecall();
        b.startHiddenAdvancePoll(livePlayer);
        b.maybeAdvanceQueue(livePlayer);
        return;
      }
      b.reconcilePlayerWithEngine();
      b.startHiddenAdvancePoll(livePlayer);
      if (livePlayer.ended && b.playerMatchesActiveSong(livePlayer)) {
        b.advanceQueueAfterEnd(livePlayer);
        return;
      }
      b.maybeAdvanceQueue(livePlayer);
      b.resumeIfBackgroundPaused(livePlayer);
    });
    window.addEventListener('pagehide', function () {
      const b = activePlaybackBinding;
      if (b) b.persistRecall();
    });
    window.addEventListener('pageshow', function (event) {
      if (!event.persisted) return;
      const b = activePlaybackBinding;
      if (!b) return;
      const livePlayer = b.getPlayer();
      if (!livePlayer) return;
      b.reconcilePlayerWithEngine();
      if (livePlayer.ended && b.playerMatchesActiveSong(livePlayer)) {
        b.advanceQueueAfterEnd(livePlayer);
        return;
      }
      b.maybeAdvanceQueue(livePlayer);
      b.resumeIfBackgroundPaused(livePlayer);
    });
  }

  function ensurePlayerEventHooks(player, binding) {
    if (!player || !binding) return;
    if (playerEventBindings) playerEventBindings.set(player, binding);
    activePlaybackBinding = binding;
    if (player.__bfMuxEventsBound) return;
    player.__bfMuxEventsBound = true;

    function resolveBinding(target) {
      return playerEventBindings ? playerEventBindings.get(target) : binding;
    }

    function onEnded() {
      const b = resolveBinding(player);
      if (b) b.handleEnded(player);
    }
    function onTimeupdate() {
      const b = resolveBinding(player);
      if (b) b.handleTimeupdate(player);
    }
    function onPlay() {
      const b = resolveBinding(player);
      if (b) b.handlePlay();
    }
    function onPause() {
      const b = resolveBinding(player);
      if (b) b.handlePause();
    }

    player.addEventListener('ended', onEnded);
    player.addEventListener('timeupdate', onTimeupdate);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    const nativeMedia = player.media;
    if (nativeMedia && nativeMedia !== player && typeof nativeMedia.addEventListener === 'function') {
      nativeMedia.addEventListener('ended', onEnded);
    }
  }

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
    let queueMonitorTimer = null;
    let handoffStartedAt = 0;
    let lastDriftReconcileAt = 0;

    function stopQueueMonitorPoll() {
      if (queueMonitorTimer === null) return;
      window.clearInterval(queueMonitorTimer);
      queueMonitorTimer = null;
    }

    function stopHiddenAdvancePoll() {
      stopQueueMonitorPoll();
    }

    function trackFinished(player) {
      if (!player) return false;
      if (player.ended) return true;
      const duration = Number(player.duration);
      const current = Number(player.currentTime);
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) {
        return false;
      }
      const hidden = typeof document !== 'undefined' && document.hidden;
      const tailSlack = hidden ? 0.2 : 0.04;
      return current >= duration - tailSlack;
    }

    function ensureQueueHandoffPlaying(player, normalized, immediatePlay) {
      if (
        !player ||
        !normalized ||
        !activeSong ||
        activeSong.playbackId !== normalized.playbackId
      ) {
        return;
      }
      try {
        if (player.readyState >= 1) player.currentTime = 0;
      } catch (e) {
        /* noop */
      }
      if (immediatePlay) {
        if (player.paused) {
          retryPlay(player, normalized, false);
        }
      }
      notify();
    }

    function ensureQueueHandoffComplete(player) {
      if (!queueAdvanceLock || !player || !activeSong) return;
      const elapsed = handoffStartedAt ? Date.now() - handoffStartedAt : 0;
      if (playerMatchesActiveSong(player) && !player.paused) {
        queueAdvanceLock = false;
        handoffStartedAt = 0;
        return;
      }
      if (elapsed < 400) return;
      if (playerMatchesActiveSong(player) && player.paused) {
        retryPlay(player, activeSong, false);
      }
      if (elapsed >= 6000) {
        queueAdvanceLock = false;
        handoffStartedAt = 0;
      }
    }

    function startQueueMonitorPoll(player) {
      if (queueMonitorTimer !== null || !player) return;
      queueMonitorTimer = window.setInterval(function () {
        const livePlayer = getPlayer();
        if (!livePlayer || !activeSong) {
          stopQueueMonitorPoll();
          return;
        }
        const hasNext = activeQueueIdx + 1 < activeQueue.length;
        if (!hasNext && !queueAdvanceLock) {
          stopQueueMonitorPoll();
          return;
        }
        if (queueAdvanceLock) {
          ensureQueueHandoffComplete(livePlayer);
          return;
        }
        maybeAdvanceQueue(livePlayer);
      }, 500);
    }

    function startHiddenAdvancePoll(player) {
      startQueueMonitorPoll(player);
    }

    function maybeReconcileOnDrift(player) {
      if (queueAdvanceLock || !player || !activeSong || playerMatchesActiveSong(player)) return;
      const now = Date.now();
      if (now - lastDriftReconcileAt < 800) return;
      lastDriftReconcileAt = now;
      reconcilePlayerWithEngine();
    }

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

    function flushRecallSave() {
      if (opts.recall === false || !recallApi) return;
      window.clearTimeout(recallTimer);
      recallTimer = null;
      persistRecall();
    }

    function playerMatchesActiveSong(player) {
      if (!player || !activeSong) return false;
      return player.getAttribute('playback-id') === activeSong.playbackId;
    }

    function persistRecall() {
      if (opts.recall === false || !recallApi || !activeSong) return;
      const player = getPlayer();
      const sourceAligned = playerMatchesActiveSong(player);
      recallApi.save({
        song: activeSong,
        queue: activeQueue,
        queueIdx: activeQueueIdx,
        currentTime: sourceAligned && player ? player.currentTime : 0,
        wasPlaying: !!(sourceAligned && player && !player.paused)
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
            handoffStartedAt = Date.now();
            queueAdvanceLock = true;
            playQueuedTrack(activeQueueIdx + 1, { immediatePlay: true, queueHandoff: true });
            startQueueMonitorPoll(getPlayer());
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
      if (!playerMatchesActiveSong(player)) return false;
      if (trackFinished(player)) {
        advanceQueueAfterEnd(player);
        return true;
      }
      return false;
    }

    function advanceQueueAfterEnd(player) {
      if (queueAdvanceLock) return;
      if (player && activeSong && !playerMatchesActiveSong(player)) {
        if (!queueAdvanceLock) reconcilePlayerWithEngine();
        return;
      }
      const nextIdx = activeQueueIdx + 1;
      if (nextIdx < activeQueue.length) {
        window.clearTimeout(recallTimer);
        recallTimer = null;
        queueAdvanceLock = true;
        handoffStartedAt = Date.now();
        playQueuedTrack(nextIdx, { immediatePlay: true, queueHandoff: true });
        startQueueMonitorPoll(player || getPlayer());
      } else {
        stopQueueMonitorPoll();
        notify({ playing: false });
        flushRecallSave();
      }
    }

    function bindEnded(player) {
      if (opts.bindEnded === false || !player) return;
      endedPlayer = player;
      endedBound = true;
      positionBound = false;

      const binding = {
        getPlayer: getPlayer,
        persistRecall: persistRecall,
        reconcilePlayerWithEngine: reconcilePlayerWithEngine,
        maybeAdvanceQueue: maybeAdvanceQueue,
        advanceQueueAfterEnd: advanceQueueAfterEnd,
        resumeIfBackgroundPaused: resumeIfBackgroundPaused,
        playerMatchesActiveSong: playerMatchesActiveSong,
        startHiddenAdvancePoll: startHiddenAdvancePoll,
        stopHiddenAdvancePoll: stopHiddenAdvancePoll,
        handleEnded: function (target) {
          if (!playerMatchesActiveSong(target)) {
            if (!queueAdvanceLock) reconcilePlayerWithEngine();
            return;
          }
          advanceQueueAfterEnd(target);
        },
        handleTimeupdate: function (target) {
          maybeReconcileOnDrift(target);
          maybeAdvanceQueue(target);
        },
        handlePlay: function () {
          queueAdvanceLock = false;
          handoffStartedAt = 0;
          startQueueMonitorPoll(getPlayer());
          notify();
        },
        handlePause: function () {
          notify();
        }
      };

      ensurePlayerEventHooks(player, binding);
      bindDocumentLifecycle(binding);
      bindPositionUpdates(player);
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

    function reconcilePlayerWithEngine() {
      const player = getPlayer();
      if (!player || !activeSong) return false;
      if (playerMatchesActiveSong(player)) return false;
      if (queueAdvanceLock) return false;

      const playerId = String(player.getAttribute('playback-id') || '').trim();
      const queueIdxForPlayer = activeQueue.findIndex(function (song) {
        return song && song.playbackId === playerId;
      });

      if (queueIdxForPlayer >= 0 && queueIdxForPlayer > activeQueueIdx) {
        activeQueueIdx = queueIdxForPlayer;
        activeSong = activeQueue[queueIdxForPlayer];
        notify();
        flushRecallSave();
        return true;
      }

      if (queueIdxForPlayer >= 0 && queueIdxForPlayer < activeQueueIdx) {
        const wasPlaying = !player.paused;
        startPlayback(activeSong, activeQueue, activeQueueIdx, {
          immediatePlay: wasPlaying,
          queueHandoff: true
        });
        return true;
      }

      if (!playerId) return false;

      const wasPlaying = !player.paused;
      startPlayback(activeSong, activeQueue, activeQueueIdx, {
        immediatePlay: wasPlaying,
        queueHandoff: !playerMatchesActiveSong(player)
      });
      return true;
    }

    function startPlayback(song, queueSongs, queueIdx, playbackOpts) {
      const player = getPlayer();
      const normalized = normalizeSong(song);
      if (!player || !normalized) {
        if (!(playbackOpts && (playbackOpts.queueHandoff || playbackOpts.seamlessAdvance))) {
          queueAdvanceLock = false;
        }
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

      const startOpts = playbackOpts || {};
      const isQueueHandoff = startOpts.queueHandoff === true || startOpts.seamlessAdvance === true;
      if (!isQueueHandoff) {
        queueAdvanceLock = false;
      }
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
      const wasPlayingBeforeSwap = !player.paused;
      if (!sameSource) {
        if (!isQueueHandoff || !wasPlayingBeforeSwap) {
          player.pause();
        }
        player.setAttribute('playback-id', normalized.playbackId);
        if (!(startOpts.recall && startOpts.recall.currentTime)) {
          if (isQueueHandoff) {
            if (!handoffStartedAt) handoffStartedAt = Date.now();
            function runHandoffPlay() {
              ensureQueueHandoffPlaying(player, normalized, immediatePlay);
            }
            player.addEventListener('loadedmetadata', runHandoffPlay, { once: true });
            player.addEventListener('canplay', runHandoffPlay, { once: true });
            player.addEventListener('loadeddata', runHandoffPlay, { once: true });
            if (player.readyState >= 1) runHandoffPlay();
            [120, 500, 1200, 2500].forEach(function (delayMs) {
              window.setTimeout(function () {
                if (
                  !activeSong ||
                  activeSong.playbackId !== normalized.playbackId ||
                  !player.paused
                ) {
                  if (
                    activeSong &&
                    activeSong.playbackId === normalized.playbackId &&
                    !player.paused
                  ) {
                    queueAdvanceLock = false;
                    handoffStartedAt = 0;
                  }
                  return;
                }
                runHandoffPlay();
              }, delayMs);
            });
          } else {
            try {
              player.currentTime = 0;
            } catch (e) {
              /* noop */
            }
            player.addEventListener(
              'loadedmetadata',
              function () {
                if (
                  !activeSong ||
                  activeSong.playbackId !== normalized.playbackId ||
                  (startOpts.recall && startOpts.recall.currentTime)
                ) {
                  return;
                }
                try {
                  player.currentTime = 0;
                } catch (err) {
                  /* noop */
                }
              },
              { once: true }
            );
          }
        }
      }
      player.setAttribute('metadata-video-title', normalized.title);

      if (root.BurnfolderPlaybackPrefetch) {
        root.BurnfolderPlaybackPrefetch.setActivePlayer(player);
      }

      notify();

      if (activeQueueIdx + 1 < activeQueue.length || isQueueHandoff) {
        startQueueMonitorPoll(player);
      }

      if (isQueueHandoff) {
        flushRecallSave();
      }

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
      if (immediatePlay && !isQueueHandoff) {
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
        if (isQueueHandoff) return;
        if (player.paused) ensurePlaying();
      }

      player.addEventListener('canplay', onMediaReady, { once: true });
      player.addEventListener('loadedmetadata', onMediaReady, { once: true });

      window.setTimeout(function () {
        if (isQueueHandoff) {
          if (
            player.paused &&
            activeSong &&
            activeSong.playbackId === normalized.playbackId &&
            !(startOpts.recall && startOpts.recall.wasPlaying === false)
          ) {
            ensurePlaying();
          }
        } else if (
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
      if (queueAdvanceLock) return;
      reconcilePlayerWithEngine();
      const player = getPlayer();
      if (!player || !activeSong) return;
      const shouldPlay = typeof forcePlay === 'boolean' ? forcePlay : player.paused;
      if (shouldPlay) {
        const playPromise = player.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise
            .then(function () {
              notify({ playing: true });
            })
            .catch(function () {
              notify({ playing: false });
              retryPlay(player, activeSong);
            });
          return;
        }
        notify({ playing: !player.paused });
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
      queueAdvanceLock = false;
      handoffStartedAt = 0;
      stopQueueMonitorPoll();
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
        if (activeSong) return;
        const player = getPlayer();
        if (player && player.getAttribute('playback-id') && !player.paused) return;
        restoreRecall(opts.recallOptions);
        window.setTimeout(reconcilePlayerWithEngine, 50);
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
      reconcilePlayer: reconcilePlayerWithEngine,
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
