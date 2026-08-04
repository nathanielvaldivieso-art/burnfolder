/**
 * Shared Mux audio playback — one continuous session, like Spotify / Apple Music.
 *
 * Lock-screen / PWA rules (do not break these):
 * 1. One in-DOM media element stays alive for the whole visit (never torn down on nav).
 * 2. User taps play() the same turn as the gesture — never wait on `canplay` first.
 * 3. Queue advance never pause()s before swapping playback-id — iOS drops the
 *    background media session on pause, which kills lock-screen autoplay.
 * 4. Media Session (lock screen / Control Center) mirrors whatever the element
 *    is actually doing. It never drives playback itself beyond play/pause/next/prev.
 * 5. Exactly one timer (the watchdog) exists. It has three jobs, run on a
 *    plain interval so none of them depend on events that can stop firing
 *    (`timeupdate` stops the moment a track stalls, which is exactly when
 *    you need a backstop):
 *      a. Resume playback if we still want to be playing but the element is
 *         unexpectedly paused.
 *      b. Notice a track that stalled a hair before its real end (network
 *         hiccup on the last chunk) and advance the queue anyway, instead of
 *         hanging forever waiting for an `ended` that will never come.
 *      c. Notice a track that reports "playing" but whose clock has stopped
 *         moving (silent stall) and nudge `play()` again.
 *    None of these ever touch currentTime — that was the old stutter-on-advance
 *    bug (a second timer kept yanking currentTime back to 0 while the next
 *    track was still buffering, which looks like the first second repeating
 *    on a loop).
 *
 * Do not call player.load() after changing playback-id; mux-player updates itself.
 */
(function (root) {
  'use strict';

  const recallApi = root.BurnfolderPlaybackRecall;
  const mediaSessionApi = root.BurnfolderMediaSession;

  /** Watchdog tick — recovers a stalled/paused player while we want it playing. */
  const WATCHDOG_MS = 500;
  /** Near-end slack — the safety net for the rare case Mux skips `ended` in the background. */
  const END_SLACK_SECONDS = 0.2;
  /** A fresh track's clock should read ~0 the moment metadata loads; anything past this
   *  means the element inherited the previous track's playhead — correct it once. */
  const INHERITED_PLAYHEAD_SECONDS = 0.4;
  /** Ticks of a frozen clock while nominally playing before we treat it as a
   *  silent stall and retry play() — a few seconds, so real buffering blips
   *  don't trigger a needless retry. */
  const STALL_TICKS_BEFORE_RETRY = 4;

  /** No-op when shared/playback-debug.js isn't loaded on a given page. */
  function dbg(event, data) {
    if (root.BurnfolderPlaybackDebug) root.BurnfolderPlaybackDebug.log(event, data);
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
    let playbackRate = 1;

    /** Intentional play state — same idea as a native player's "isPlaying" flag. */
    let wantPlaying = false;
    /** True from the moment an end-of-track advance starts until the next
     *  startPlayback() runs — guards against `ended` + the near-end fallback
     *  both firing for the same track boundary. */
    let advancePending = false;

    let boundPlayer = null;
    let mediaActionsBound = false;
    let watchdogTimer = null;
    let recallTimer = null;
    let lifecycleBound = false;
    let startGeneration = 0;
    /** Silent-stall tracking for the watchdog — reset whenever a new track starts. */
    let lastWatchedTime = null;
    let stallTicks = 0;

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
      // Only play/pause/next/previous — seek handlers are omitted on purpose
      // (adding them breaks native next/prev on iOS lock screen).
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
            try {
              player.currentTime = 0;
            } catch (e) {
              /* noop */
            }
            notify();
          }
        },
        nexttrack: function () {
          if (activeQueueIdx + 1 < activeQueue.length) {
            playQueuedTrack(activeQueueIdx + 1, { queueHandoff: true });
          }
        }
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
     * Single play entry. Call from user gestures, queue advances, and the watchdog.
     * Never stacks competing retries — the watchdog is the only retry loop.
     */
    function playMedia(player) {
      if (!player || !activeSong) return;
      const id = activeSong.playbackId;
      upgradePlayer(player);
      if (typeof player.play !== 'function') {
        dbg('play:not-upgraded', { id: id });
        if (typeof customElements !== 'undefined') {
          customElements.whenDefined('mux-player').then(function () {
            upgradePlayer(player);
            if (wantPlaying && activeSong && typeof player.play === 'function') {
              player.play().then(
                function () {
                  dbg('play:resolved', { id: id, via: 'whenDefined' });
                },
                function (err) {
                  dbg('play:rejected', { id: id, via: 'whenDefined', name: err && err.name, message: err && err.message });
                }
              );
            }
          });
        }
        return;
      }
      dbg('play:call', { id: id, readyState: player.readyState, paused: player.paused });
      const playPromise = player.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(
          function () {
            dbg('play:resolved', { id: id });
          },
          function (err) {
            dbg('play:rejected', { id: id, name: err && err.name, message: err && err.message });
            /* Watchdog retries while wantPlaying. Optional page hook for UI. */
            if (typeof opts.onPlayBlocked === 'function') {
              opts.onPlayBlocked(player, activeSong);
            }
          }
        );
      }
    }

    function isNearEnd(player) {
      if (!player) return false;
      if (player.ended) return true;
      const duration = Number(player.duration);
      const current = Number(player.currentTime);
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) {
        return false;
      }
      return current >= duration - END_SLACK_SECONDS;
    }

    function advanceAfterEnd() {
      if (advancePending) return;
      advancePending = true;
      const nextIdx = activeQueueIdx + 1;
      dbg('advance', {
        fromIdx: activeQueueIdx,
        toIdx: nextIdx,
        queueLen: activeQueue.length,
        hasNext: nextIdx < activeQueue.length
      });
      if (nextIdx < activeQueue.length) {
        playQueuedTrack(nextIdx, { immediatePlay: true, queueHandoff: true });
        return;
      }
      wantPlaying = false;
      notify({ playing: false });
    }

    function watchdogTick() {
      const player = getPlayer();
      if (!player || !activeSong) return;

      // A track can stall a hair before its real end (last chunk slow to
      // arrive while backgrounded) and never fire `ended` or another
      // `timeupdate`. Check on a plain interval so this doesn't depend on
      // events that stop firing exactly when you need them.
      if (!advancePending && isNearEnd(player)) {
        dbg('watchdog:near-end-advance', { id: activeSong.playbackId, currentTime: player.currentTime, duration: player.duration });
        advanceAfterEnd();
        return;
      }

      if (!wantPlaying) {
        lastWatchedTime = null;
        stallTicks = 0;
        return;
      }

      if (player.paused) {
        lastWatchedTime = null;
        stallTicks = 0;
        dbg('watchdog:paused-retry', { id: activeSong.playbackId, readyState: player.readyState });
        playMedia(player);
        return;
      }

      // Silent stall: the element reports "playing" but its clock isn't
      // moving (seen on iOS during flaky background network conditions).
      // Retrying play() is a harmless no-op if it's actually fine.
      const t = Number(player.currentTime);
      if (!Number.isFinite(t)) return;
      if (lastWatchedTime !== null && t === lastWatchedTime) {
        stallTicks += 1;
        if (stallTicks >= STALL_TICKS_BEFORE_RETRY) {
          stallTicks = 0;
          dbg('watchdog:stall-retry', { id: activeSong.playbackId, currentTime: t, readyState: player.readyState });
          playMedia(player);
        }
      } else {
        stallTicks = 0;
      }
      lastWatchedTime = t;
    }

    function startWatchdog() {
      if (watchdogTimer !== null) return;
      watchdogTimer = window.setInterval(watchdogTick, WATCHDOG_MS);
    }

    function stopWatchdog() {
      if (watchdogTimer === null) return;
      window.clearInterval(watchdogTimer);
      watchdogTimer = null;
    }

    function bindPlayerListeners(player) {
      if (!player || boundPlayer === player) return;
      boundPlayer = player;

      function onEnded() {
        dbg('event:ended', { id: activeSong && activeSong.playbackId });
        advanceAfterEnd();
      }

      player.addEventListener('ended', onEnded);
      const nativeMedia = player.media;
      if (nativeMedia && nativeMedia !== player && typeof nativeMedia.addEventListener === 'function') {
        nativeMedia.addEventListener('ended', onEnded);
      }

      player.addEventListener('timeupdate', function () {
        if (!activeSong) return;
        // A fresh track's underlying <audio>/<video> element doesn't exist yet
        // the moment startPlayback() sets playback-id, so the rate applied
        // there can land on nothing and get lost once mux-player finishes
        // swapping to the new source (audible as "speed resets to 100% every
        // song"). Re-assert it here too — cheap (no-op once it already
        // matches) and it also keeps Media Session's reported rate honest,
        // which is what the lock-screen scrubber uses to interpolate
        // position between updates (a stale rate there looks like the
        // progress bar drifting out of sync with the actual audio).
        applyPlaybackRate(player);
        // Safety net for the rare case Mux/iOS skips `ended` while backgrounded.
        if (!advancePending && isNearEnd(player)) {
          dbg('timeupdate:near-end-advance', { id: activeSong.playbackId, currentTime: player.currentTime, duration: player.duration });
          advanceAfterEnd();
          return;
        }
        if (mediaSessionApi) mediaSessionApi.setPositionState(player);
        scheduleRecallSave();
      });

      player.addEventListener('play', notify);
      player.addEventListener('pause', notify);

      // Transient network hiccup mid-track (common on flaky background
      // cellular): give it one bounded retry instead of leaving the queue
      // stuck on a track that will never recover on its own.
      player.addEventListener('error', function () {
        const errObj = (player.media && player.media.error) || player.error || null;
        dbg('event:error', {
          id: activeSong && activeSong.playbackId,
          wantPlaying: wantPlaying,
          code: errObj && errObj.code,
          message: errObj && errObj.message
        });
        if (!activeSong || !wantPlaying) return;
        const id = activeSong.playbackId;
        window.setTimeout(function () {
          const live = getPlayer();
          if (!live || !activeSong || activeSong.playbackId !== id || !wantPlaying) return;
          dbg('event:error-retry', { id: id });
          playMedia(live);
        }, 500);
      });

      startWatchdog();
      bindLifecycleRecovery();
    }

    /** Recover playback after returning from the lock screen / app switcher / bfcache. */
    function bindLifecycleRecovery() {
      if (lifecycleBound || typeof document === 'undefined') return;
      lifecycleBound = true;

      function recover(source) {
        const live = getPlayer();
        if (!live || !activeSong) return;
        if (live.ended || isNearEnd(live)) {
          dbg('lifecycle:recover-advance', { source: source, id: activeSong.playbackId });
          advanceAfterEnd();
          return;
        }
        if (wantPlaying && live.paused) {
          dbg('lifecycle:recover-play', { source: source, id: activeSong.playbackId });
          playMedia(live);
        }
      }

      document.addEventListener('visibilitychange', function () {
        dbg('lifecycle:visibilitychange', { hidden: document.hidden });
        persistRecall();
        if (!document.hidden) recover('visibilitychange');
      });
      window.addEventListener('pagehide', function () {
        dbg('lifecycle:pagehide', null);
        persistRecall();
      });
      window.addEventListener('pageshow', function (event) {
        dbg('lifecycle:pageshow', { persisted: event.persisted });
        if (event.persisted) recover('pageshow');
      });
    }

    /**
     * One-shot correction for a stale playhead inherited from the previous
     * track. Fires at most once per track, right when the new source's
     * metadata is available — never a repeating timer, so it can't fight
     * legitimate buffering (that fight is what caused the old "first second
     * repeats 5 times" stutter on lock-screen advances).
     */
    function correctInheritedPlayhead(player, playbackId, generation) {
      function stillCurrent() {
        return (
          generation === startGeneration &&
          activeSong &&
          activeSong.playbackId === playbackId &&
          (player.getAttribute('playback-id') || '') === playbackId
        );
      }
      function correctOnce() {
        if (!stillCurrent()) return;
        const t = Number(player.currentTime) || 0;
        if (t > INHERITED_PLAYHEAD_SECONDS) {
          try {
            player.currentTime = 0;
          } catch (e) {
            /* noop */
          }
        }
      }
      player.addEventListener('loadedmetadata', correctOnce, { once: true });
    }

    function startPlayback(song, queueSongs, queueIdx, playbackOpts) {
      const player = getPlayer();
      const normalized = normalizeSong(song);
      const startOpts = playbackOpts || {};
      const isQueueHandoff =
        startOpts.queueHandoff === true || startOpts.seamlessAdvance === true;
      if (!player || !normalized) {
        dbg('startPlayback:no-op', { hasPlayer: !!player, hasSong: !!normalized });
        return false;
      }
      dbg('startPlayback', {
        id: normalized.playbackId,
        queueIdx: queueIdx,
        isQueueHandoff: isQueueHandoff,
        immediatePlay: startOpts.immediatePlay !== false
      });

      if (!player.getAttribute('audio')) player.setAttribute('audio', '');
      if (!player.getAttribute('playsinline')) player.setAttribute('playsinline', '');
      if (!player.getAttribute('stream-type')) player.setAttribute('stream-type', 'on-demand');

      // A fresh startPlayback means any in-flight advance has resolved, and
      // any stall tracking from the previous track no longer applies.
      advancePending = false;
      lastWatchedTime = null;
      stallTicks = 0;

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

      activeSong = normalized;
      activeQueue =
        Array.isArray(queueSongs) && queueSongs.length
          ? queueSongs.map(normalizeSong).filter(Boolean)
          : [normalized];
      activeQueueIdx = typeof queueIdx === 'number' ? queueIdx : 0;

      bindPlayerListeners(player);
      bindMediaSessionActions();

      if (!sameSource) {
        // CRITICAL: never pause() during a live queue handoff — iOS drops the
        // background media session and album autoplay dies on the lock screen.
        if (!isQueueHandoff) {
          try {
            player.pause();
          } catch (e) {
            /* noop */
          }
        }
        // Don't force currentTime here — the source change itself resets it
        // in the normal case, and writing to it before metadata exists is
        // one more thing that can race with mux-player/hls.js's own load on
        // a given track's timing and occasionally swallow the play() that
        // follows. correctInheritedPlayhead below is the (one-shot, not
        // repeating) safety net for the genuine inherited-playhead case.
        player.setAttribute('playback-id', normalized.playbackId);
        if (!recallAt) correctInheritedPlayhead(player, normalized.playbackId, generation);
        // The rate applied a few lines down can land before the new track's
        // underlying media element exists and get lost when mux-player
        // finishes swapping sources. Reassert once metadata is in (the
        // timeupdate listener keeps reasserting after that as a backstop).
        player.addEventListener(
          'loadedmetadata',
          function () {
            applyPlaybackRate(player);
          },
          { once: true }
        );
      }

      player.setAttribute('metadata-video-title', normalized.title);
      applyPlaybackRate(player);

      if (root.BurnfolderPlaybackPrefetch) {
        root.BurnfolderPlaybackPrefetch.setActivePlayer(player);
      }

      notify();

      if (recallAt) {
        const seek = function () {
          if ((player.getAttribute('playback-id') || '') !== normalized.playbackId) return;
          try {
            player.currentTime = recallAt;
          } catch (e) {
            /* noop */
          }
        };
        if (player.readyState >= 1) seek();
        else player.addEventListener('loadedmetadata', seek, { once: true });
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
      advancePending = false;
      lastWatchedTime = null;
      stallTicks = 0;
      stopWatchdog();
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
