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
    let queueMonitorTimer = null;
    let handoffStartedAt = 0;
    let lifecycleBound = false;
    let startGeneration = 0;
    let zeroGuardTimer = null;

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
      if (!player) return;
      const liveId = player.getAttribute('playback-id') || '';
      // Never persist a playhead that still belongs to the previous asset.
      if (liveId && liveId !== activeSong.playbackId) return;
      let t = Number(player.currentTime) || 0;
      if (!Number.isFinite(t) || t < 0) t = 0;
      recallApi.save({
        song: activeSong,
        queue: activeQueue,
        queueIdx: activeQueueIdx,
        currentTime: t,
        wasPlaying: !player.paused
      });
    }

    function stopZeroGuard() {
      if (zeroGuardTimer !== null) {
        window.clearInterval(zeroGuardTimer);
        zeroGuardTimer = null;
      }
    }

    function seekToZero(player) {
      if (!player) return;
      try {
        if (typeof player.currentTime === 'number' && player.currentTime > 0.05) {
          player.currentTime = 0;
        } else {
          player.currentTime = 0;
        }
      } catch (e) {
        /* noop */
      }
    }

    /**
     * Queue handoffs must never inherit the previous track's playhead.
     * Mux can keep currentTime across playback-id changes if we don't re-assert
     * after the new asset is ready — that produced mid-track starts (e.g. 0:15).
     */
    function forceStartAtZero(player, playbackId, generation) {
      if (!player || !playbackId) return;
      stopZeroGuard();
      seekToZero(player);

      function stillCurrent() {
        return (
          generation === startGeneration &&
          activeSong &&
          activeSong.playbackId === playbackId &&
          (player.getAttribute('playback-id') || '') === playbackId
        );
      }

      function reassert() {
        if (!stillCurrent()) return;
        seekToZero(player);
      }

      player.addEventListener('loadedmetadata', reassert, { once: true });
      player.addEventListener('loadeddata', reassert, { once: true });
      player.addEventListener('canplay', reassert, { once: true });
      player.addEventListener(
        'playing',
        function onPlaying() {
          if (!stillCurrent()) return;
          // If the new asset somehow began mid-track, yank it back once.
          if ((Number(player.currentTime) || 0) > 0.35) {
            seekToZero(player);
            if (player.paused) retryPlay(player, activeSong, false);
          }
        },
        { once: true }
      );

      let ticks = 0;
      zeroGuardTimer = window.setInterval(function () {
        ticks += 1;
        if (!stillCurrent() || ticks > 25) {
          stopZeroGuard();
          return;
        }
        const t = Number(player.currentTime) || 0;
        // Inherited playheads from the previous asset often land mid-track (e.g. 0:15).
        // Yank any non-zero start back during the first ~2.5s of a fresh handoff.
        if (t > 0.35) {
          seekToZero(player);
        } else {
          stopZeroGuard();
        }
      }, 100);
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
            playQueuedTrack(activeQueueIdx + 1, {
              immediatePlay: true,
              queueHandoff: true
            });
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

    function stopQueueMonitorPoll() {
      if (queueMonitorTimer === null) return;
      window.clearInterval(queueMonitorTimer);
      queueMonitorTimer = null;
    }

    function stopHiddenAdvancePoll() {
      /* Alias kept for older call sites / mental model. */
      stopQueueMonitorPoll();
    }

    /**
     * Detect end-of-track for queue advance.
     * Visible tabs use a tiny tail slack so we don't chop the last notes.
     * Hidden/lock-screen uses a larger window because iOS throttles timeupdate
     * and timers while the screen is off — waiting for true `ended` stalls albums.
     */
    function trackFinished(player) {
      if (!player) return false;
      if (player.ended) return true;
      const duration = Number(player.duration);
      const current = Number(player.currentTime);
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) {
        return false;
      }
      const hidden = typeof document !== 'undefined' && document.hidden;
      const tailSlack = hidden ? 1.5 : 0.08;
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
      seekToZero(player);
      if (immediatePlay && player.paused) {
        retryPlay(player, normalized, false);
      }
      notify();
    }

    function ensureQueueHandoffComplete(player) {
      if (!queueAdvanceLock || !player || !activeSong) return;
      const elapsed = handoffStartedAt ? Date.now() - handoffStartedAt : 0;
      const liveId = player.getAttribute('playback-id') || '';
      const matches = liveId === activeSong.playbackId;
      if (matches && !player.paused) {
        queueAdvanceLock = false;
        handoffStartedAt = 0;
        return;
      }
      if (elapsed < 400) return;
      if (matches && player.paused) {
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
      if (trackFinished(player)) {
        advanceQueueAfterEnd(player);
        return true;
      }
      return false;
    }

    function advanceQueueAfterEnd(player) {
      const nextIdx = activeQueueIdx + 1;
      if (nextIdx < activeQueue.length) {
        queueAdvanceLock = true;
        handoffStartedAt = Date.now();
        playQueuedTrack(nextIdx, { immediatePlay: true, queueHandoff: true });
        startQueueMonitorPoll(player || getPlayer());
      } else {
        stopQueueMonitorPoll();
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
        handoffStartedAt = 0;
        startQueueMonitorPoll(getPlayer());
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
            startQueueMonitorPoll(livePlayer);
            maybeAdvanceQueue(livePlayer);
            return;
          }
          /* Keep the monitor alive when returning from lock screen / Control Center.
             Stopping it here used to stall the rest of the album until the PWA was opened. */
          startQueueMonitorPoll(livePlayer);
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
          startQueueMonitorPoll(livePlayer);
          if (livePlayer.ended) {
            advanceQueueAfterEnd(livePlayer);
            return;
          }
          maybeAdvanceQueue(livePlayer);
          resumeIfBackgroundPaused(livePlayer);
        });
      }
    }

    function applyRecallPosition(player, recall, playbackId) {
      if (!player || !recall) return;
      const recallId = recall.song && recall.song.playbackId;
      if (recallId && playbackId && recallId !== playbackId) return;
      const t = Number(recall.currentTime);
      if (!Number.isFinite(t) || t <= 0) return;
      const seek = function () {
        try {
          // Only apply if we're still on the recalled asset.
          if (playbackId && (player.getAttribute('playback-id') || '') !== playbackId) return;
          player.currentTime = t;
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
      const startOpts = playbackOpts || {};
      const isQueueHandoff =
        startOpts.queueHandoff === true || startOpts.seamlessAdvance === true;
      if (!player || !normalized) {
        if (!isQueueHandoff) queueAdvanceLock = false;
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

      /* Keep advance lock through a queue handoff so we don't double-fire next. */
      if (!isQueueHandoff) {
        queueAdvanceLock = false;
        handoffStartedAt = 0;
      }
      const immediatePlay =
        startOpts.immediatePlay !== false &&
        !(startOpts.recall && startOpts.recall.wasPlaying === false);

      const prevId = player.getAttribute('playback-id') || '';
      const sameSource = prevId === normalized.playbackId;
      const recall = startOpts.recall || null;
      const recallForThisSong =
        recall &&
        Number(recall.currentTime) > 0 &&
        (!recall.song || !recall.song.playbackId || recall.song.playbackId === normalized.playbackId);
      const recallAt = recallForThisSong ? Number(recall.currentTime) : 0;

      startGeneration += 1;
      const generation = startGeneration;
      stopZeroGuard();

      activeSong = normalized;
      activeQueue =
        Array.isArray(queueSongs) && queueSongs.length
          ? queueSongs.map(normalizeSong).filter(Boolean)
          : [normalized];
      activeQueueIdx = typeof queueIdx === 'number' ? queueIdx : 0;

      bindEnded(player);
      bindMediaSessionActions();

      const wasPlayingBeforeSwap = !player.paused;
      // Queue handoffs must NOT pause when already playing — iOS drops background
      // media permission on pause(), which stops album autoplay on a locked phone.
      // Zero-guard below still forces the new asset to start at 0:00.
      if (!sameSource) {
        if (!isQueueHandoff || !wasPlayingBeforeSwap) {
          try {
            player.pause();
          } catch (e) {
            /* noop */
          }
          seekToZero(player);
        }
        player.setAttribute('playback-id', normalized.playbackId);
      }

      /* Fresh track / queue handoff: start at 0 unless recalling THIS song.
       * Same-source with an established playhead must never yank to 0 — soft nav
       * / accidental re-start used to audibly restart the song. */
      const keepPlayhead =
        sameSource &&
        !startOpts.forceRestart &&
        (Number(player.currentTime) || 0) > 0.35;
      if (!recallAt && !keepPlayhead) {
        forceStartAtZero(player, normalized.playbackId, generation);
        if (recallApi && opts.recall !== false) {
          // Drop any stale mid-track recall so a later restore can't resurrect it.
          recallApi.save({
            song: normalized,
            queue: activeQueue,
            queueIdx: activeQueueIdx,
            currentTime: 0,
            wasPlaying: !!immediatePlay
          });
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

      function ensurePlaying() {
        if (
          !activeSong ||
          activeSong.playbackId !== normalized.playbackId ||
          generation !== startGeneration ||
          !player.paused
        ) {
          return;
        }
        retryPlay(player, normalized, true);
      }

      function runHandoffPlay() {
        if (generation !== startGeneration) return;
        if (
          !activeSong ||
          activeSong.playbackId !== normalized.playbackId ||
          (player.getAttribute('playback-id') || '') !== normalized.playbackId
        ) {
          return;
        }
        ensureQueueHandoffPlaying(player, normalized, immediatePlay);
        if (!player.paused) {
          queueAdvanceLock = false;
          handoffStartedAt = 0;
        }
      }

      // iOS requires play() during the tap handler — don't wait for canplay first.
      // For background queue handoffs, also arm retries: loadedmetadata often won't
      // fire until the phone is unlocked, so timed fallbacks keep the session alive.
      if (immediatePlay) {
        if (isQueueHandoff) {
          if (!handoffStartedAt) handoffStartedAt = Date.now();
          player.addEventListener('loadedmetadata', runHandoffPlay, { once: true });
          player.addEventListener('canplay', runHandoffPlay, { once: true });
          player.addEventListener('loadeddata', runHandoffPlay, { once: true });
          if (player.readyState >= 1) runHandoffPlay();
          else retryPlay(player, normalized, false);
          [120, 500, 1200, 2500].forEach(function (delayMs) {
            window.setTimeout(function () {
              if (generation !== startGeneration) return;
              if (
                activeSong &&
                activeSong.playbackId === normalized.playbackId &&
                !player.paused
              ) {
                queueAdvanceLock = false;
                handoffStartedAt = 0;
                return;
              }
              runHandoffPlay();
            }, delayMs);
          });
        } else {
          retryPlay(player, normalized, false);
        }
      }

      function onMediaReady() {
        if (generation !== startGeneration) return;
        if (
          !activeSong ||
          activeSong.playbackId !== normalized.playbackId ||
          (player.getAttribute('playback-id') || '') !== normalized.playbackId
        ) {
          return;
        }
        if (recallAt) {
          applyRecallPosition(player, recall, normalized.playbackId);
        } else if (!keepPlayhead) {
          seekToZero(player);
        }
        if (recall && recall.wasPlaying === false) {
          player.pause();
          notify({ playing: false });
          return;
        }
        if (player.paused) ensurePlaying();
      }

      player.addEventListener('canplay', onMediaReady, { once: true });
      player.addEventListener('loadedmetadata', onMediaReady, { once: true });

      window.setTimeout(function () {
        if (generation !== startGeneration) return;
        if (
          player.paused &&
          activeSong &&
          activeSong.playbackId === normalized.playbackId &&
          !(recall && recall.wasPlaying === false)
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
          if (generation !== startGeneration) return;
          if (
            player.paused &&
            activeSong &&
            activeSong.playbackId === normalized.playbackId &&
            !(recall && recall.wasPlaying === false)
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
      queueAdvanceLock = false;
      handoffStartedAt = 0;
      stopQueueMonitorPoll();
      stopZeroGuard();
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
      // Never clobber a live session — soft-nav / script re-entry must not restart.
      if (activeSong && activeSong.playbackId) return false;
      const player = getPlayer();
      if (
        player &&
        !player.paused &&
        player.getAttribute('playback-id')
      ) {
        return false;
      }
      const queue = recall.queue && recall.queue.length ? recall.queue : [recall.song];
      let idx = recall.queueIdx;
      if (idx < 0 || idx >= queue.length) idx = 0;
      const wasPlaying = recall.wasPlaying === true;
      return startPlayback(recall.song, queue, idx, {
        recall: recall,
        immediatePlay: wasPlaying
      });
    }

    if (opts.restoreRecall !== false && recallApi) {
      window.setTimeout(function () {
        if (
          root.document &&
          root.document.body &&
          root.document.body.classList.contains('index-home')
        ) {
          return;
        }
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
