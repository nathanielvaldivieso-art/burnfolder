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
    const getPrimaryPlayer =
      opts.getPlayer ||
      function () {
        return resolvePlayer(opts.playerId || 'activeMuxPlayer');
      };

    /** Always the live element — after a bridge promote, ids are swapped. */
    function getPlayer() {
      return getPrimaryPlayer();
    }

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
    let hiddenAdvanceTimer = null;
    let endWatchTimer = null;
    let handoffStartedAt = 0;
    let lifecycleBound = false;
    let startGeneration = 0;
    let zeroGuardTimer = null;
    let playbackRate = 1;
    let lastProgressAt = 0;
    let lastProgressTime = -1;
    let lastKnownDuration = 0;
    let nativeEndedBound = false;
    let bridgeHandoffGeneration = 0;

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

    function bridgePlayerId() {
      const stack = root.BurnfolderStudioPlaybackStack;
      return (stack && stack.BRIDGE_PLAYER_ID) || 'bridgeMuxPlayer';
    }

    function ensureBridgePlayer() {
      const stack = root.BurnfolderStudioPlaybackStack;
      if (stack && typeof stack.ensureBridgePlayerMarkup === 'function') {
        const fromStack = stack.ensureBridgePlayerMarkup();
        if (fromStack) return fromStack;
      }
      let bridge = document.getElementById(bridgePlayerId());
      if (bridge) return bridge;
      const primary = getPlayer();
      if (!primary || !primary.parentNode) return null;
      bridge = document.createElement('mux-player');
      bridge.id = bridgePlayerId();
      bridge.setAttribute('audio', '');
      bridge.setAttribute('playsinline', '');
      bridge.setAttribute('stream-type', 'on-demand');
      bridge.setAttribute('preload', 'auto');
      bridge.setAttribute(
        'style',
        primary.getAttribute('style') ||
          'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;'
      );
      primary.parentNode.insertBefore(bridge, primary.nextSibling);
      return bridge;
    }

    function swapLivePlayerIds(outgoing, incoming) {
      if (!outgoing || !incoming || outgoing === incoming) return;
      const liveId = outgoing.id || 'activeMuxPlayer';
      const standbyId = incoming.id || bridgePlayerId();
      outgoing.id = 'bf-mux-swap-tmp';
      incoming.id = liveId;
      outgoing.id = standbyId;
    }

    /**
     * Preload the next queue item onto the standby bridge player while the
     * live track is still playing. Required for locked-phone handoffs.
     */
    function prepareBridgeForNext() {
      if (activeQueueIdx + 1 >= activeQueue.length) return null;
      const next = activeQueue[activeQueueIdx + 1];
      if (!next || !next.playbackId) return null;
      const bridge = ensureBridgePlayer();
      if (!bridge) return null;
      const live = getPlayer();
      if (live && bridge === live) return null;
      if ((bridge.getAttribute('playback-id') || '') !== next.playbackId) {
        try {
          bridge.pause();
        } catch (e) {
          /* noop */
        }
        try {
          bridge.muted = false;
        } catch (e2) {
          /* noop */
        }
        bridge.setAttribute('preload', 'auto');
        bridge.setAttribute('playback-id', next.playbackId);
        bridge.setAttribute('metadata-video-title', next.title || '');
        seekToZero(bridge);
      }
      applyPlaybackRate(bridge);
      return bridge;
    }

    /**
     * Locked-phone album advance: play the next track on a SECOND mux-player
     * while the current one is still playing, then swap ids.
     * Reloading playback-id on the same element pauses media and iOS drops the
     * background session — play() then only works after the app is foregrounded
     * (exactly the "opens and plays without touching" symptom).
     */
    function beginBridgeHandoff() {
      if (queueAdvanceLock) return false;
      const nextIdx = activeQueueIdx + 1;
      if (nextIdx >= activeQueue.length) return false;
      const next = normalizeSong(activeQueue[nextIdx]);
      if (!next) return false;

      const outgoing = getPlayer();
      if (!outgoing) return false;
      const bridge = prepareBridgeForNext();
      if (!bridge) return false;

      queueAdvanceLock = true;
      handoffStartedAt = Date.now();
      bridgeHandoffGeneration += 1;
      const handoffGen = bridgeHandoffGeneration;
      stopEndWatch();
      window.clearTimeout(recallTimer);
      recallTimer = null;
      lastProgressAt = 0;
      lastProgressTime = -1;

      seekToZero(bridge);
      applyPlaybackRate(bridge);
      bridge.setAttribute('metadata-video-title', next.title);

      function promote() {
        if (handoffGen !== bridgeHandoffGeneration) return false;
        if (playbackSnapshot(bridge).paused) return false;

        startGeneration += 1;
        activeSong = next;
        activeQueueIdx = nextIdx;
        lastKnownDuration = 0;

        /* Kill outgoing audio immediately so we don't layer two tracks. */
        try {
          outgoing.muted = true;
        } catch (e) {
          /* noop */
        }
        try {
          outgoing.pause();
        } catch (e) {
          /* noop */
        }

        swapLivePlayerIds(outgoing, bridge);
        const live = getPlayer();
        try {
          live.muted = false;
        } catch (e) {
          /* noop */
        }

        endedBound = false;
        endedPlayer = null;
        positionBound = false;
        nativeEndedBound = false;
        bindEnded(live);
        bindMediaSessionActions();

        queueAdvanceLock = false;
        handoffStartedAt = 0;

        if (root.BurnfolderPlaybackPrefetch) {
          root.BurnfolderPlaybackPrefetch.setActivePlayer(live);
          root.BurnfolderPlaybackPrefetch.prefetchUpcoming(activeQueue, activeQueueIdx);
          root.BurnfolderPlaybackPrefetch.warmArtwork(next.playbackId, next.coverArt);
        }

        notify();
        persistRecall();
        startQueueMonitorPoll(live);
        if (typeof document !== 'undefined' && document.hidden) {
          startHiddenAdvancePoll(live);
          scheduleEndWatch(live);
        } else {
          scheduleEndWatch(live);
        }
        prepareBridgeForNext();
        return true;
      }

      function attemptBridgePlay() {
        if (handoffGen !== bridgeHandoffGeneration) return;
        if ((bridge.getAttribute('playback-id') || '') !== next.playbackId) {
          bridge.setAttribute('playback-id', next.playbackId);
        }
        seekToZero(bridge);
        if (typeof bridge.play !== 'function' && typeof customElements !== 'undefined') {
          try {
            customElements.upgrade(bridge);
          } catch (e) {
            /* noop */
          }
        }
        const playPromise = typeof bridge.play === 'function' ? bridge.play() : undefined;
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise
            .then(function () {
              promote();
            })
            .catch(function () {
              /* Retries below — keep outgoing playing as long as possible. */
            });
        } else if (!playbackSnapshot(bridge).paused) {
          promote();
        }
      }

      /* Must call play() while outgoing is still playing to keep iOS audio permission. */
      attemptBridgePlay();
      [40, 120, 280, 600, 1200, 2400, 4000].forEach(function (delayMs) {
        window.setTimeout(function () {
          if (handoffGen !== bridgeHandoffGeneration) return;
          if (!queueAdvanceLock) return;
          if (promote()) return;
          attemptBridgePlay();
        }, delayMs);
      });

      /* If bridge never started, fall back to same-element handoff (works in foreground). */
      window.setTimeout(function () {
        if (handoffGen !== bridgeHandoffGeneration) return;
        if (!queueAdvanceLock) return;
        if (!playbackSnapshot(bridge).paused) {
          promote();
          return;
        }
        queueAdvanceLock = false;
        handoffStartedAt = 0;
        playQueuedTrack(nextIdx, { immediatePlay: true, queueHandoff: true });
      }, 5500);

      return true;
    }

    function shouldUseBridgeHandoff() {
      /* Locked/background only — foreground same-element handoff is reliable and
         must not trim outros. */
      return typeof document !== 'undefined' && document.hidden;
    }

    /** Inner media element — mux-player host props often go stale while locked. */
    function nativeMediaEl(player) {
      if (!player) return null;
      try {
        if (player.media) return player.media;
      } catch (e) {
        /* noop */
      }
      try {
        if (player.nativeEl) return player.nativeEl;
      } catch (e) {
        /* noop */
      }
      try {
        if (typeof player.querySelector === 'function') {
          return player.querySelector('audio, video');
        }
      } catch (e) {
        /* noop */
      }
      return null;
    }

    /**
     * Best-effort playhead/ended state from host + native media.
     * Prefer the larger finite currentTime/duration so a stale host cannot hide end-of-track.
     */
    function playbackSnapshot(player) {
      const native = nativeMediaEl(player);
      const sources = [];
      if (player) sources.push(player);
      if (native && native !== player) sources.push(native);
      let ended = false;
      let paused = true;
      let current = NaN;
      let duration = NaN;
      for (let i = 0; i < sources.length; i++) {
        const el = sources[i];
        if (!el) continue;
        if (el.ended) ended = true;
        if (el.paused === false) paused = false;
        const c = Number(el.currentTime);
        const d = Number(el.duration);
        if (Number.isFinite(c) && c >= 0 && (!Number.isFinite(current) || c > current)) {
          current = c;
        }
        if (Number.isFinite(d) && d > 0 && (!Number.isFinite(duration) || d > duration)) {
          duration = d;
        }
      }
      if (!Number.isFinite(duration) && lastKnownDuration > 0) {
        duration = lastKnownDuration;
      }
      if (Number.isFinite(duration) && duration > 0) {
        lastKnownDuration = duration;
      }
      return {
        ended: ended,
        paused: paused,
        current: current,
        duration: duration,
        remaining:
          Number.isFinite(duration) && Number.isFinite(current) ? duration - current : NaN
      };
    }

    function stopEndWatch() {
      if (endWatchTimer === null) return;
      window.clearTimeout(endWatchTimer);
      endWatchTimer = null;
    }

    /**
     * Locked-phone advance cannot rely on interval polls alone — iOS throttles them.
     * Arm a one-shot so the bridge player can start WHILE the current track is
     * still playing (pause-at-end / same-element reload drops iOS audio permission).
     */
    function scheduleEndWatch(player) {
      stopEndWatch();
      if (!player || !activeSong) return;
      if (queueAdvanceLock) return;
      if (activeQueueIdx + 1 >= activeQueue.length) return;
      const snap = playbackSnapshot(player);
      if (
        !Number.isFinite(snap.duration) ||
        snap.duration <= 0 ||
        !Number.isFinite(snap.current) ||
        snap.current < 0
      ) {
        return;
      }
      const remainingMs = (snap.duration - snap.current) * 1000;
      if (!Number.isFinite(remainingMs)) return;
      const hidden = typeof document !== 'undefined' && document.hidden;
      /* Warm the bridge a few seconds out; start handoff ~1.2s before end when locked. */
      if (hidden && remainingMs <= 8000) {
        prepareBridgeForNext();
      }
      const leadMs = hidden ? 1200 : 0;
      const delay = Math.min(Math.max(remainingMs - leadMs, 80), 180000);
      const gen = startGeneration;
      const songId = activeSong.playbackId;
      endWatchTimer = window.setTimeout(function () {
        endWatchTimer = null;
        if (gen !== startGeneration) return;
        if (!activeSong || activeSong.playbackId !== songId) return;
        const livePlayer = getPlayer() || player;
        if (queueAdvanceLock) {
          ensureQueueHandoffComplete(livePlayer);
          return;
        }
        if (shouldUseBridgeHandoff()) {
          prepareBridgeForNext();
          if (beginBridgeHandoff()) return;
        }
        if (maybeAdvanceQueue(livePlayer)) return;
        /* Timer woke early or playhead lagged — re-arm from live position. */
        scheduleEndWatch(livePlayer);
      }, delay);
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
            /* Locked: prefer bridge so next/prev keep working without a seek UI
               that would hide these controls on iOS. */
            if (typeof document !== 'undefined' && document.hidden && beginBridgeHandoff()) {
              return;
            }
            stopEndWatch();
            handoffStartedAt = Date.now();
            queueAdvanceLock = true;
            lastKnownDuration = 0;
            playQueuedTrack(activeQueueIdx + 1, {
              immediatePlay: true,
              queueHandoff: true
            });
            const livePlayer = getPlayer();
            startQueueMonitorPoll(livePlayer);
            if (typeof document !== 'undefined' && document.hidden) {
              startHiddenAdvancePoll(livePlayer);
            }
          }
        }
        /* Intentionally omit seekbackward/seekforward/seekto:
           iOS hides next/previous lock-screen controls when seek handlers are set. */
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
      if (hiddenAdvanceTimer === null) return;
      window.clearInterval(hiddenAdvanceTimer);
      hiddenAdvanceTimer = null;
    }

    function markPlaybackProgress(player) {
      if (!player) return;
      const snap = playbackSnapshot(player);
      const current = snap.current;
      if (!Number.isFinite(current) || current < 0) return;
      if (Math.abs(current - lastProgressTime) >= 0.05) {
        lastProgressTime = current;
        lastProgressAt = Date.now();
      }
      if (typeof document !== 'undefined' && document.hidden) {
        if (Number.isFinite(snap.remaining) && snap.remaining <= 8) {
          prepareBridgeForNext();
        }
        /* Locked: start bridge handoff while still playing, before iOS pauses us. */
        if (
          !queueAdvanceLock &&
          !snap.paused &&
          Number.isFinite(snap.remaining) &&
          snap.remaining <= 1.35 &&
          activeQueueIdx + 1 < activeQueue.length
        ) {
          beginBridgeHandoff();
          return;
        }
        scheduleEndWatch(player);
      }
    }

    /**
     * Detect end-of-track for queue advance.
     *
     * Visible tabs wait for the native `ended` event only. Near-end duration
     * checks chop outros on album queues — the main site always queues the next
     * track after PHOTO NEGATIVE, so an early handoff is audible there.
     *
     * Hidden/lock-screen: iOS often skips `ended` and throttles timers. Advance when:
     *  - native ended fires
     *  - playhead is in a tiny pre-end window WHILE still playing (keep session)
     *  - media paused / froze at the true end (locked-phone stall)
     * Reads native media — mux-player host currentTime/paused often go stale locked.
     */
    function trackFinished(player) {
      if (!player) return false;
      const snap = playbackSnapshot(player);
      if (snap.ended) return true;
      if (
        !Number.isFinite(snap.duration) ||
        snap.duration <= 0 ||
        !Number.isFinite(snap.current)
      ) {
        return false;
      }
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (!hidden) return false;

      const remaining = snap.remaining;
      if (!Number.isFinite(remaining)) return false;

      /* Still playing: enter finished window early enough for bridge handoff. */
      if (!snap.paused && remaining <= 1.35) return true;

      /* Locked phone: track ended as pause without `ended` (common on iOS). */
      if (snap.paused && remaining <= 1.25) return true;

      /* Locked phone: playhead froze at the end while still reporting playing. */
      if (
        !snap.paused &&
        remaining <= 1.25 &&
        lastProgressAt > 0 &&
        Date.now() - lastProgressAt >= 1200
      ) {
        return true;
      }

      return false;
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
      if (immediatePlay && playbackSnapshot(player).paused) {
        retryPlay(player, normalized, false);
      }
      notify();
    }

    function ensureQueueHandoffComplete(player) {
      if (!queueAdvanceLock || !player || !activeSong) return;
      const elapsed = handoffStartedAt ? Date.now() - handoffStartedAt : 0;
      const liveId = player.getAttribute('playback-id') || '';
      const matches = liveId === activeSong.playbackId;
      const snap = playbackSnapshot(player);
      if (matches && !snap.paused) {
        queueAdvanceLock = false;
        handoffStartedAt = 0;
        scheduleEndWatch(player);
        return;
      }
      if (elapsed < 400) return;
      if (matches && snap.paused) {
        retryPlay(player, activeSong, false);
      }
      if (elapsed >= 12000) {
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
        markPlaybackProgress(livePlayer);
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

    /**
     * Extra lock-screen poll. iOS throttles timeupdate while hidden; this keeps
     * album advance alive without depending on the foreground monitor alone.
     */
    function startHiddenAdvancePoll(player) {
      if (hiddenAdvanceTimer !== null || !player) return;
      hiddenAdvanceTimer = window.setInterval(function () {
        if (typeof document !== 'undefined' && !document.hidden) {
          stopHiddenAdvancePoll();
          return;
        }
        const livePlayer = getPlayer() || player;
        if (!activeSong || !livePlayer) return;
        markPlaybackProgress(livePlayer);
        if (queueAdvanceLock) {
          ensureQueueHandoffComplete(livePlayer);
          return;
        }
        if (livePlayer.ended) {
          advanceQueueAfterEnd(livePlayer);
          return;
        }
        maybeAdvanceQueue(livePlayer);
      }, 400);
      startQueueMonitorPoll(player);
    }

    function resumeIfBackgroundPaused(player) {
      if (!player || !activeSong || !playbackSnapshot(player).paused) return;
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
      /* If we stalled at the end while locked, advance instead of replaying the tail. */
      if (trackFinished(player) && activeQueueIdx + 1 < activeQueue.length) {
        advanceQueueAfterEnd(player);
        return;
      }
      retryPlay(player, activeSong, false);
    }

    function maybeAdvanceQueue(player) {
      if (queueAdvanceLock || !player || !activeSong) return false;
      const snap = playbackSnapshot(player);
      if (
        typeof document !== 'undefined' &&
        document.hidden &&
        !snap.paused &&
        Number.isFinite(snap.remaining) &&
        snap.remaining <= 1.35 &&
        activeQueueIdx + 1 < activeQueue.length
      ) {
        prepareBridgeForNext();
        if (beginBridgeHandoff()) return true;
      }
      if (trackFinished(player)) {
        advanceQueueAfterEnd(player);
        return true;
      }
      if (typeof document !== 'undefined' && document.hidden) {
        markPlaybackProgress(player);
      }
      return false;
    }

    function advanceQueueAfterEnd(player) {
      if (queueAdvanceLock) return;
      const nextIdx = activeQueueIdx + 1;
      if (nextIdx < activeQueue.length) {
        window.clearTimeout(recallTimer);
        recallTimer = null;
        stopEndWatch();
        lastProgressAt = 0;
        lastProgressTime = -1;
        lastKnownDuration = 0;
        /* Locked: bridge handoff keeps the audio session across track changes. */
        if (shouldUseBridgeHandoff()) {
          prepareBridgeForNext();
          if (beginBridgeHandoff()) return;
        }
        queueAdvanceLock = true;
        handoffStartedAt = Date.now();
        playQueuedTrack(nextIdx, { immediatePlay: true, queueHandoff: true });
        startQueueMonitorPoll(player || getPlayer());
        if (typeof document !== 'undefined' && document.hidden) {
          startHiddenAdvancePoll(player || getPlayer());
        }
      } else {
        stopQueueMonitorPoll();
        stopHiddenAdvancePoll();
        stopEndWatch();
        notify({ playing: false });
      }
    }

    function bindNativeEnded(player) {
      if (!player || nativeEndedBound) return;
      const nativeMedia = nativeMediaEl(player);
      if (!nativeMedia || nativeMedia === player) return;
      if (typeof nativeMedia.addEventListener !== 'function') return;
      const onEnded = player._bfOnEnded;
      const onLockPause = player._bfOnLockPause;
      if (!onEnded || !onLockPause) return;
      nativeMedia.addEventListener('ended', onEnded);
      nativeMedia.addEventListener('pause', onLockPause);
      nativeMedia.addEventListener('timeupdate', function () {
        markPlaybackProgress(player);
        maybeAdvanceQueue(player);
      });
      nativeEndedBound = true;
    }

    function bindEnded(player) {
      if (opts.bindEnded === false || !player) return;
      if (endedPlayer === player && endedBound) {
        bindNativeEnded(player);
        return;
      }
      endedPlayer = player;
      endedBound = true;
      positionBound = false;
      nativeEndedBound = false;
      function onEnded() {
        /* Ignore ended on a demoted bridge/outgoing element after id swap. */
        if (getPlayer() !== player) return;
        advanceQueueAfterEnd(player);
      }
      function onLockPause() {
        if (getPlayer() !== player) {
          notify();
          return;
        }
        /* Lock-screen end often arrives as pause without ended — try advance. */
        if (typeof document !== 'undefined' && document.hidden) {
          maybeAdvanceQueue(player);
        }
        notify();
      }
      player._bfOnEnded = onEnded;
      player._bfOnLockPause = onLockPause;
      player.addEventListener('ended', onEnded);
      player.addEventListener('pause', onLockPause);
      bindNativeEnded(player);
      player.addEventListener('timeupdate', function () {
        bindNativeEnded(player);
        markPlaybackProgress(player);
        maybeAdvanceQueue(player);
      });
      player.addEventListener('play', function () {
        queueAdvanceLock = false;
        handoffStartedAt = 0;
        bindNativeEnded(player);
        markPlaybackProgress(player);
        startQueueMonitorPoll(getPlayer());
        if (typeof document !== 'undefined' && document.hidden) {
          startHiddenAdvancePoll(getPlayer());
          scheduleEndWatch(getPlayer());
        }
        notify();
      });
      bindPositionUpdates(player);

      if (typeof document !== 'undefined' && !lifecycleBound) {
        lifecycleBound = true;
        document.addEventListener('visibilitychange', function () {
          const livePlayer = getPlayer();
          if (!livePlayer) return;
          if (document.hidden) {
            persistRecall();
            prepareBridgeForNext();
            startHiddenAdvancePoll(livePlayer);
            scheduleEndWatch(livePlayer);
            maybeAdvanceQueue(livePlayer);
            return;
          }
          stopHiddenAdvancePoll();
          stopEndWatch();
          /* Keep the monitor alive when returning from lock screen / Control Center.
             Stopping it here used to stall the rest of the album until the PWA was opened. */
          startQueueMonitorPoll(livePlayer);
          const snap = playbackSnapshot(livePlayer);
          /* Cancel in-flight bridge retries; finish in foreground if we stalled on a handoff. */
          if (queueAdvanceLock) {
            bridgeHandoffGeneration += 1;
            const liveId = livePlayer.getAttribute('playback-id') || '';
            const onActive =
              activeSong && liveId === activeSong.playbackId && !snap.paused;
            queueAdvanceLock = false;
            handoffStartedAt = 0;
            if (!onActive && activeQueueIdx + 1 < activeQueue.length) {
              playQueuedTrack(activeQueueIdx + 1, {
                immediatePlay: true,
                queueHandoff: true
              });
              return;
            }
          }
          const nearEndPaused =
            snap.paused &&
            Number.isFinite(snap.remaining) &&
            snap.remaining <= 1.25 &&
            activeQueueIdx + 1 < activeQueue.length;
          if (snap.ended || nearEndPaused) {
            advanceQueueAfterEnd(livePlayer);
            return;
          }
          maybeAdvanceQueue(livePlayer);
          resumeIfBackgroundPaused(livePlayer);
        });
        if (typeof document.addEventListener === 'function') {
          document.addEventListener('freeze', function () {
            const livePlayer = getPlayer();
            if (!livePlayer) return;
            persistRecall();
            scheduleEndWatch(livePlayer);
            maybeAdvanceQueue(livePlayer);
          });
        }
        window.addEventListener('pagehide', persistRecall);
        window.addEventListener('pageshow', function (event) {
          if (!event.persisted) return;
          const livePlayer = getPlayer();
          if (!livePlayer) return;
          startQueueMonitorPoll(livePlayer);
          if (typeof document !== 'undefined' && document.hidden) {
            startHiddenAdvancePoll(livePlayer);
          }
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
      stopEndWatch();
      lastKnownDuration = 0;

      const wasPlayingBeforeSwap = !playbackSnapshot(player).paused;
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
      applyPlaybackRate(player);

      if (root.BurnfolderPlaybackPrefetch) {
        root.BurnfolderPlaybackPrefetch.setActivePlayer(player);
      }

      notify();

      lastProgressAt = Date.now();
      lastProgressTime = Number(playbackSnapshot(player).current) || 0;

      if (activeQueueIdx + 1 < activeQueue.length || isQueueHandoff) {
        startQueueMonitorPoll(player);
        if (typeof document !== 'undefined' && document.hidden) {
          startHiddenAdvancePoll(player);
          scheduleEndWatch(player);
        }
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
          /* Locked phones need longer retries — metadata often won't arrive until unlock. */
          const handoffRetries =
            typeof document !== 'undefined' && document.hidden
              ? [80, 250, 700, 1500, 3000, 6000, 12000]
              : [120, 500, 1200, 2500];
          handoffRetries.forEach(function (delayMs) {
            window.setTimeout(function () {
              if (generation !== startGeneration) return;
              const snap = playbackSnapshot(player);
              if (
                activeSong &&
                activeSong.playbackId === normalized.playbackId &&
                !snap.paused
              ) {
                queueAdvanceLock = false;
                handoffStartedAt = 0;
                scheduleEndWatch(player);
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
        applyPlaybackRate(player);
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
      /* Keep standby mux-player loaded with the next album track for lock-screen handoff. */
      if (activeQueueIdx + 1 < activeQueue.length) {
        prepareBridgeForNext();
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
      // Browsers reject 0; treat 0% as paused. Floor tiny rates at the common min.
      if (rate === 0) {
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
