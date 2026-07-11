(function () {
  'use strict';

  if (!document.body || !document.body.classList.contains('studio-page')) return;

  const stack = window.BurnfolderStudioPlaybackStack;
  const SHELL_ID = (stack && stack.SHELL_ID) || 'studioGlobalPlayback';
  const PLAYER_ID = (stack && stack.PLAYER_ID) || 'activeMuxPlayer';
  const MUX_PLAYER_SRC = 'https://cdn.jsdelivr.net/npm/@mux/mux-player';
  let barApi = null;
  let engine = null;
  let muxReadyPromise = null;
  let muxScriptPromise = null;
  let mountBarRetryQueued = false;

  function isPreviewNode(node) {
    if (stack && stack.isPreviewPlaybackNode) return stack.isPreviewPlaybackNode(node);
    return !!(node && node.closest && node.closest('.studio-preview-player'));
  }

  function injectShellMarkup() {
    if (stack && stack.ensureShellMarkup) return stack.ensureShellMarkup();
    if (document.getElementById(SHELL_ID)) return document.getElementById(SHELL_ID);
    return null;
  }

  if (stack && stack.ensureShellMarkup) {
    injectShellMarkup();
  }

  function loadMuxPlayerScript() {
    if (muxScriptPromise) return muxScriptPromise;
    if (typeof customElements !== 'undefined' && customElements.get('mux-player')) {
      muxScriptPromise = Promise.resolve();
      return muxScriptPromise;
    }
    muxScriptPromise = new Promise(function (resolve, reject) {
      const existing = document.querySelector(
        'script[data-bf-mux-player="1"], script[src*="@mux/mux-player"]'
      );
      if (existing) {
        if (
          typeof customElements !== 'undefined' &&
          customElements.get('mux-player')
        ) {
          resolve();
          return;
        }
        existing.addEventListener(
          'load',
          function () {
            resolve();
          },
          { once: true }
        );
        existing.addEventListener(
          'error',
          function () {
            reject(new Error('mux player script failed to load'));
          },
          { once: true }
        );
        return;
      }
      const script = document.createElement('script');
      script.src = MUX_PLAYER_SRC;
      script.dataset.bfMuxPlayer = '1';
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error('mux player script failed to load'));
      };
      document.head.appendChild(script);
    });
    return muxScriptPromise;
  }

  function waitForMuxPlayer() {
    if (muxReadyPromise) return muxReadyPromise;
    muxReadyPromise = loadMuxPlayerScript()
      .then(function () {
        if (typeof customElements === 'undefined') return;
        if (customElements.get('mux-player')) return;
        return customElements.whenDefined('mux-player');
      })
      .catch(function () {});
    return muxReadyPromise;
  }

  function isMuxPlayerReady() {
    const player = getShellPlayer();
    return !!(player && typeof player.play === 'function');
  }

  function upgradeMuxPlayer(player) {
    if (!player || typeof player.play === 'function') return player;
    if (typeof customElements === 'undefined') return player;
    if (customElements.get('mux-player')) {
      try {
        customElements.upgrade(player);
      } catch (e) {
        /* noop */
      }
    }
    return player;
  }

  function findGlobalPlayer() {
    let keeper = document.querySelector('#' + SHELL_ID + ' #' + PLAYER_ID);
    if (keeper) return keeper;
    const nodes = document.querySelectorAll('mux-player#' + PLAYER_ID + ', #' + PLAYER_ID);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (isPreviewNode(node)) continue;
      return node;
    }
    return null;
  }

  function dedupeGlobalPlayer() {
    let keeper = findGlobalPlayer();
    if (!keeper) {
      injectShellMarkup();
      keeper = findGlobalPlayer();
    }

    const players = Array.from(
      document.querySelectorAll('mux-player#' + PLAYER_ID + ', #' + PLAYER_ID)
    );
    players.forEach(function (node) {
      if (node === keeper) return;
      if (isPreviewNode(node)) return;
      if (node.closest('#' + SHELL_ID) && node !== keeper) {
        if (node.parentNode) node.parentNode.removeChild(node);
        return;
      }
      const bar = node.closest('#bottomBar');
      if (bar && !bar.closest('#' + SHELL_ID)) {
        if (!isPreviewNode(bar)) {
          bar.setAttribute('hidden', '');
          bar.setAttribute('aria-hidden', 'true');
        }
        return;
      }
      if (node.parentNode) node.parentNode.removeChild(node);
    });

    if (keeper && window.BurnfolderPlaybackPrefetch) {
      window.BurnfolderPlaybackPrefetch.setActivePlayer(keeper);
    }
    return upgradeMuxPlayer(keeper);
  }

  function getShellPlayer() {
    return upgradeMuxPlayer(dedupeGlobalPlayer());
  }

  function ensureShell() {
    injectShellMarkup();
    dedupeGlobalPlayer();
    const shell = document.getElementById(SHELL_ID);
    if (!shell) return null;

    Array.from(document.querySelectorAll('#bottomBar')).forEach(function (node) {
      if (node.closest('#' + SHELL_ID)) return;
      if (isPreviewNode(node)) return;
      node.setAttribute('hidden', '');
      node.setAttribute('aria-hidden', 'true');
    });

    return shell;
  }

  function getEngine() {
    if (engine) return engine;
    if (!window.BurnfolderMuxPlayback) return null;

    ensureShell();
    waitForMuxPlayer();

    engine = window.BurnfolderMuxPlayback.create({
      getPlayer: function () {
        return getShellPlayer();
      },
      recall: true,
      restoreRecall: true,
      artist: 'burnfolder',
      album: 'stream',
      onPlayBlocked: function (player) {
        if (player) player.play().catch(function () {});
      },
      onStateChange: function (detail) {
        window.dispatchEvent(new CustomEvent('burnfolder-stream-playback', { detail: detail }));
        if (barApi) barApi.update(detail);
      }
    });

    return engine;
  }

  function scheduleMountBarRetry() {
    if (mountBarRetryQueued || barApi) return;
    mountBarRetryQueued = true;
    const retry = function () {
      mountBarRetryQueued = false;
      if (!barApi) mountBar();
    };
    if (document.readyState === 'complete') {
      window.setTimeout(retry, 0);
    } else {
      window.addEventListener('load', retry, { once: true });
    }
  }

  function mountBar() {
    ensureShell();
    const shell = document.getElementById(SHELL_ID);
    const bar = shell ? shell.querySelector('#bottomBar') : null;
    if (!bar) return barApi;
    if (!window.BurnfolderNowPlayingBar) {
      scheduleMountBarRetry();
      return barApi;
    }

    if (barApi) {
      syncAfterNavigation();
      return barApi;
    }

    barApi = window.BurnfolderNowPlayingBar.mount({
      barEl: bar,
      titleEl: shell.querySelector('#streamNowPlayingTitle'),
      playBtnEl: shell.querySelector('#streamPlayPause'),
      closeBtnEl: shell.querySelector('#streamNowPlayingClose'),
      progressEl: bar.querySelector('#progressBarArea'),
      muxPlayerEl: getShellPlayer(),
      getMuxPlayer: function () {
        return getShellPlayer();
      },
      bodyActiveClass: 'stream-playback-active',
      playbackEventName: 'burnfolder-stream-playback',
      getActiveSong: function () {
        const e = getEngine();
        return e ? e.getActiveSong() : null;
      },
      onTogglePlay: function () {
        const e = getEngine();
        if (e) e.togglePlayPause();
      },
      onClose: function () {
        const e = getEngine();
        if (e) e.stop();
        if (barApi) barApi.update({ song: null, playing: false });
      },
      onPlayVersion: function (song) {
        const e = getEngine();
        if (e && song) e.playTrackQueue([song], 0, { immediatePlay: true });
      }
    });

    return barApi;
  }

  function syncAfterNavigation() {
    ensureShell();
    const eng = getEngine();
    if (!eng || !barApi) return;
    if (eng.reconcilePlayer) eng.reconcilePlayer();
    const song = eng.getActiveSong();
    const player = getShellPlayer();
    if (!song || !player) return;
    barApi.setBarVisible(true);
    barApi.update({
      song: song,
      playing: !player.paused,
      queue: eng.getActiveQueue ? eng.getActiveQueue() : undefined,
      queueIdx: eng.getActiveQueueIdx ? eng.getActiveQueueIdx() : undefined
    });
  }

  function boot() {
    ensureShell();
    waitForMuxPlayer()
      .then(function () {
        dedupeGlobalPlayer();
        getEngine();
        mountBar();
      })
      .catch(function () {
        getEngine();
        mountBar();
      });
    bindSpacePlayPause();
  }

  function isTypingTarget(target) {
    const el = target && target.nodeType === 1 ? target : null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(el.closest('[contenteditable="true"]'));
  }

  function bindSpacePlayPause() {
    if (window.__studioSpacePlayBound) return;
    window.__studioSpacePlayBound = true;
    document.addEventListener('keydown', function (event) {
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;
      ensureShell();
      mountBar();
      const eng = getEngine();
      const song = eng && eng.getActiveSong ? eng.getActiveSong() : null;
      if (!song || !song.playbackId) return;
      const shell = document.getElementById(SHELL_ID);
      const bar = shell ? shell.querySelector('#bottomBar') : null;
      const barOpen =
        (bar && bar.style.display === 'flex') ||
        document.body.classList.contains('stream-playback-active');
      if (!barOpen) return;
      event.preventDefault();
      event.stopPropagation();
      eng.togglePlayPause();
    });
  }

  window.BurnfolderStudioPlaybackShell = {
    ensureShell: ensureShell,
    getEngine: getEngine,
    mountBar: mountBar,
    syncAfterNavigation: syncAfterNavigation,
    waitForMuxPlayer: waitForMuxPlayer,
    isMuxPlayerReady: isMuxPlayerReady
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
