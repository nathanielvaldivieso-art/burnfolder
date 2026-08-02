/**
 * Shared Mux audio playback — continuous session like Spotify / Apple Music.
 *
 * Lock-screen / PWA rules:
 * 1. One in-DOM media element stays alive (never tear down on nav).
 * 2. User gesture → play() immediately (do not wait for canplay).
 * 3. Queue advance → never pause() before swapping playback-id (iOS drops
 *    the background media session on pause).
 * 4. One watchdog owns end-of-track advance + "should be playing" recovery.
 * 5. Media Session is the lock-screen / Control Center transport.
 *
 * Do not call player.load() after changing playback-id; mux-player updates itself.
 */
(function (root) {
  'use strict';

  const recallApi = root.BurnfolderPlaybackRecall;
  const mediaSessionApi = root.BurnfolderMediaSession;

  /** How long after a start/handoff before the watchdog may call play() again. */
  const PLAY_GRACE_MS = 400;
  /** Watchdog tick — also the near-end poll when Mux skips `ended` on lock screen. */
  const WATCHDOG_MS = 500;
  /** Near-end slack: keep tiny so outros aren't chopped when a next track exists. */
  const END_SLACK_VISIBLE = 0.08;
  const END_SLACK_HIDDEN = 0.15;

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
    let lifecycleBound = false;
    let watchdogTimer = null;
    let startGeneration = 0;
    let playbackRate = 1;

    /** Intentional play state — same idea as a native player's "isPlaying" flag. */
    let wantPlaying = false;
    /** True while swapping to the next queue track (blocks double-advance). */
    let advancing = false;
    /** Timestamp of last startPlayback / playMedia — grace before watchdog retries. */
    let lastPlayAttemptAt = 0;
    let zeroGuardTimer = null;

    function notify(extra) {
      const player = getPlayer();
      const detail = Object.assign(
        {
          song: activeSong,
          playing: !!(activeSong && player && !player.paused),
          queue: activeQueue.slice(),
          queueIdx: activeQueueIdx,
          playbackRate: playbackRate
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
      if (liveId && liveId !== activeSong.playbackId) return;
      let t = Number(player.currentTime) || 0;
      if (!Number.isFinite(t) || t < 0) t = 0;
      recallApi.save({
        song: activeSong,
        queue: activeQueue,
        queueIdx: activeQueueIdx,
        currentTime: t,
        wasPlaying: !!wantPlaying
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
        player.currentTime = 0;
      } catch (e) {
        /* noop */
      }
    }

    /**
     * Queue handoffs must not inherit the previous track's playhead.
     * One short reassert window — not a long yank loop that fights live audio.
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
        const t = Number(player.currentTime) || 0;
        // Only yank inherited mid-track starts, not intentional seeks.
        if (t > 0.35 && t < 3) seekToZero(player);
      }

      player.addEventListener('loadedmetadata', reassert, { once: true });
      player.addEventListener('canplay', reassert, { once: true });

      let ticks = 0;
      zeroGuardTimer = window.setInterval(function () {
        ticks += 1;
        if (!stillCurrent() || ticks > 12) {
          stopZeroGuard();
          return;
        }
        reassert();
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
            seekToZero(player);
            notify();
          }
        },
        nexttrack: function () {
          if (activeQueueIdx + 1 < activeQueue.length) {
            advanceTo(activeQueueIdx + 1);
          }
        },
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

    function upgradePlayer(player) {
      if (!player || typeof player.play === 'function') return;
      if (typeof customElements === 'undefined') return;
      if (customElements.get('mux-player')) {
        try {
          customElements.upgrade(player);
        } catch (e) {
          /* noop */
        }
      }
    }

    /**
     * Single play entry. Call from user gestures and from the watchdog.
     * Never stacks competing retries — the watchdog is the only retry loop.
     */
    function playMedia(player) {
      if (!player || !activeSong) return;
      upgradePlayer(player);
      if (typeof player.play !== 'function') {
        if (typeof customElements !== 'undefined') {
          customElements.whenDefined('mux-player').then(function () {
            upgradePlayer(player);
            if (wantPlaying && activeSong && typeof player.play === 'function') {
              lastPlayAttemptAt = Date.now();
              player.play().catch(function () {});
            }
          });
        }
        return;
      }
      lastPlayAttemptAt = Date.now();
      const playPromise = player.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(function () {
          /* Watchdog retries while wantPlaying. Optional page hook for UI. */
          if (typeof opts.onPlayBlocked === 'function') {
            opts.onPlayBlocked(player, activeSong);
          }
        });
      }
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
      const slack = hidden ? END_SLACK_HIDDEN : END_SLACK_VISIBLE;
      return current >= duration - slack;
    }

    function stopWatchdog() {
      if (watchdogTimer === null) return;
      window.clearInterval(watchdogTimer);
      watchdogTimer = null;
    }

    function startWatchdog() {
      if (watchdogTimer !== null) return;
      watchdogTimer = window.setInterval(watchdogTick, WATCHDOG_MS);
    }

    function watchdogTick() {
      const player = getPlayer();
      if (!player || !activeSong) {
        stopWatchdog();
        return;
      }

      const liveId = player.getAttribute('playback-id') || '';
      const matches = liveId === activeSong.playbackId;

      if (advancing && matches && !player.paused) {
        advancing = false;
      }

      if (!advancing && trackFinished(player)) {
        advanceAfterEnd();
        return;
      }

      // Intentional play + unexpectedly paused (common during lock-screen handoffs
      // while the next Mux asset buffers). One play() per grace window.
      if (
        wantPlaying &&
        matches &&
        player.paused &&
        Date.now() - lastPlayAttemptAt >= PLAY_GRACE_MS
      ) {
        playMedia(player);
      }
    }

    function advanceTo(nextIdx) {
      if (nextIdx < 0 || nextIdx >= activeQueue.length) return false;
      advancing = true;
      return playQueuedTrack(nextIdx, { immediatePlay: true, queueHandoff: true });
    }

    function advanceAfterEnd() {
      const nextIdx = activeQueueIdx + 1;
      if (nextIdx < activeQueue.length) {
        advanceTo(nextIdx);
        return;
      }
      advancing = false;
      wantPlaying = false;
      stopWatchdog();
      notify({ playing: false });
    }

    function bindEnded(player) {
      if (opts.bindEnded === false || !player) return;
      if (endedPlayer === player && endedBound) return;
      endedPlayer = player;
      endedBound = true;
      positionBound = false;

      function onEnded() {
        advanceAfterEnd();
      }

      player.addEventListener('ended', onEnded);
      const nativeMedia = player.media;
      if (nativeMedia && nativeMedia !== player && typeof nativeMedia.addEventListener === 'function') {
        nativeMedia.addEventListener('ended', onEnded);
      }

      // Safety net when Mux skips `ended` (common on lock screen).
      player.addEventListener('timeupdate', function () {
        if (!advancing && trackFinished(player)) advanceAfterEnd();
      });

      player.addEventListener('play', function () {
        if (wantPlaying) advancing = false;
        notify();
      });
      player.addEventListener('pause', function () {
        // User/OS pause — don't clear wantPlaying here; togglePlayPause owns that.
        // Media Session pause and our toggle set wantPlaying=false first.
        notify();
      });
      bindPositionUpdates(player);

      if (typeof document !== 'undefined' && !lifecycleBound) {
        lifecycleBound = true;
        document.addEventListener('visibilitychange', function () {
          const live = getPlayer();
          if (!live) return;
          persistRecall();
          startWatchdog();
          if (document.hidden) return;
          // Returning from lock screen / Control Center / app switcher.
          if (live.ended || trackFinished(live)) {
            advanceAfterEnd();
            return;
          }
          if (wantPlaying && live.paused) playMedia(live);
        });
        window.addEventListener('pagehide', persistRecall);
        window.addEventListener('pageshow', function (event) {
          if (!event.persisted) return;
          const live = getPlayer();
          if (!live) return;
          startWatchdog();
          if (live.ended || trackFinished(live)) {
            advanceAfterEnd();
            return;
          }
          if (wantPlaying && live.paused) playMedia(live);
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
        if (!isQueueHandoff) advancing = false;
        return false;
      }

      if (!player.getAttribute('audio')) player.setAttribute('audio', '');
      if (!player.getAttribute('playsinline')) player.setAttribute('playsinline', '');
      if (!player.getAttribute('stream-type')) player.setAttribute('stream-type', 'on-demand');

      if (!isQueueHandoff) advancing = false;

      const immediatePlay =
        startOpts.immediatePlay !== false &&
        !(startOpts.recall && startOpts.recall.wasPlaying === false);

      wantPlaying = !!immediatePlay;

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
      // CRITICAL: never pause() during a live queue handoff — iOS drops the
      // background media permission and album autoplay dies on the lock screen.
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

      const keepPlayhead =
        sameSource &&
        !startOpts.forceRestart &&
        (Number(player.currentTime) || 0) > 0.35;
      if (!recallAt && !keepPlayhead) {
        forceStartAtZero(player, normalized.playbackId, generation);
        if (recallApi && opts.recall !== false) {
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
      applyPlaybackRate(player);

      if (root.BurnfolderPlaybackPrefetch) {
        root.BurnfolderPlaybackPrefetch.setActivePlayer(player);
      }

      notify();
      startWatchdog();

      if (recallAt) {
        applyRecallPosition(player, recall, normalized.playbackId);
      }

      if (recall && recall.wasPlaying === false) {
        wantPlaying = false;
        try {
          player.pause();
        } catch (e) {
          /* noop */
        }
        notify({ playing: false });
      } else if (immediatePlay) {
        // Foreground taps: play in this turn (iOS gesture window).
        // Background handoffs: play now; watchdog recovers if Mux isn't ready yet.
        playMedia(player);
      }

      if (typeof opts.onAfterStart === 'function') {
        window.setTimeout(function () {
          if (generation !== startGeneration) return;
          opts.onAfterStart(player, normalized);
        }, 0);
      }

      persistRecall();

      if (root.BurnfolderPlaybackPrefetch) {
        root.BurnfolderPlaybackPrefetch.prefetchUpcoming(activeQueue, activeQueueIdx);
        root.BurnfolderPlaybackPrefetch.warmArtwork(normalized.playbackId, normalized.coverArt);
      }

      return true;
    }

    function primeTrack(song) {
      const normalized = normalizeSong(song);
      if (!normalized) return false;
      // Prefer the prefetch pool. Never rewrite the live player on hover/touch-down.
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
      wantPlaying = shouldPlay;
      if (shouldPlay) {
        notify({ playing: true });
        playMedia(player);
        startWatchdog();
      } else {
        try {
          player.pause();
        } catch (e) {
          /* noop */
        }
        notify({ playing: false });
      }
    }

    /** Same-turn gesture nudge after startPlayback — never rewrite playback-id. */
    function nudgePlay(playbackId) {
      const player = getPlayer();
      if (!player || !activeSong) return;
      if (playbackId && activeSong.playbackId !== playbackId) return;
      if (playbackId && (player.getAttribute('playback-id') || '') !== playbackId) return;
      wantPlaying = true;
      if (player.paused) playMedia(player);
    }

    function disablePitchPreservation(el) {
      if (!el) return;
      try {
        if ('preservesPitch' in el) el.preservesPitch = false;
        if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = false;
        if ('mozPreservesPitch' in el) el.mozPreservesPitch = false;
      } catch (e) {
        /* noop */
      }
    }

    function mediaTargets(player) {
      const targets = [];
      if (!player) return targets;
      targets.push(player);
      try {
        if (player.media) targets.push(player.media);
      } catch (e) {
        /* noop */
      }
      try {
        if (player.nativeEl) targets.push(player.nativeEl);
      } catch (e) {
        /* noop */
      }
      try {
        const nested =
          typeof player.querySelector === 'function'
            ? player.querySelector('audio, video')
            : null;
        if (nested) targets.push(nested);
      } catch (e) {
        /* noop */
      }
      return targets;
    }

    function applyPlaybackRate(player) {
      const target = player || getPlayer();
      if (!target) return;
      const rate = Math.max(0, Math.min(2, Number(playbackRate) || 0));
      playbackRate = rate;
      const targets = mediaTargets(target);
      let i;
      for (i = 0; i < targets.length; i++) {
        disablePitchPreservation(targets[i]);
      }
      if (rate === 0) {
        wantPlaying = false;
        try {
          target.pause();
        } catch (e) {
          /* noop */
        }
        return;
      }
      const effective = Math.max(0.0625, rate);
      for (i = 0; i < targets.length; i++) {
        try {
          if (Math.abs((Number(targets[i].playbackRate) || 1) - effective) > 0.001) {
            targets[i].playbackRate = effective;
          }
        } catch (e) {
          /* noop */
        }
      }
    }

    function setPlaybackRate(rate) {
      const next = Number(rate);
      if (!Number.isFinite(next)) return playbackRate;
      playbackRate = Math.max(0, Math.min(2, next));
      applyPlaybackRate();
      const player = getPlayer();
      notify({
        playbackRate: playbackRate,
        playing: !!(activeSong && player && !player.paused && playbackRate > 0)
      });
      return playbackRate;
    }

    function getPlaybackRate() {
      return playbackRate;
    }

    function stop() {
      const player = getPlayer();
      activeSong = null;
      activeQueue = [];
      activeQueueIdx = 0;
      wantPlaying = false;
      advancing = false;
      stopWatchdog();
      stopZeroGuard();
      if (player) {
        try {
          player.pause();
        } catch (e) {
          /* noop */
        }
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
      if (activeSong && activeSong.playbackId) return false;
      const player = getPlayer();
      if (player && !player.paused && player.getAttribute('playback-id')) {
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
      nudgePlay: nudgePlay,
      setPlaybackRate: setPlaybackRate,
      getPlaybackRate: getPlaybackRate,
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
