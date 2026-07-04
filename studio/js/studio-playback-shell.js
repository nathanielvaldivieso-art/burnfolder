(function () {
  'use strict';

  if (!document.body || !document.body.classList.contains('studio-page')) return;

  const SHELL_ID = 'studioGlobalPlayback';
  let barApi = null;
  let engine = null;
  let muxReadyPromise = null;

  function waitForMuxPlayer() {
    if (muxReadyPromise) return muxReadyPromise;
    if (typeof customElements === 'undefined') {
      muxReadyPromise = Promise.resolve();
      return muxReadyPromise;
    }
    if (customElements.get('mux-player')) {
      muxReadyPromise = Promise.resolve();
      return muxReadyPromise;
    }
    muxReadyPromise = customElements.whenDefined('mux-player').catch(function () {});
    return muxReadyPromise;
  }

  function isMuxPlayerReady() {
    const player = getShellPlayer();
    return !!(player && typeof player.play === 'function');
  }

  function getShellPlayer() {
    const shell = document.getElementById(SHELL_ID);
    if (shell) {
      const player = shell.querySelector('#activeMuxPlayer');
      if (player) return player;
    }
    return dedupeGlobalPlayer();
  }

  function dedupeGlobalPlayer() {
    const shellPlayer = document.getElementById(SHELL_ID);
    let keeper = shellPlayer ? shellPlayer.querySelector('#activeMuxPlayer') : null;
    if (!keeper) {
      keeper = document.querySelector('mux-player#activeMuxPlayer');
    }
    const players = Array.from(document.querySelectorAll('mux-player#activeMuxPlayer, #activeMuxPlayer'));
    players.forEach(function (node) {
      if (node === keeper) return;
      if (node.closest('#' + SHELL_ID)) return;
      const bar = node.closest('#bottomBar');
      if (bar && !bar.closest('#' + SHELL_ID)) {
        bar.setAttribute('hidden', '');
        bar.setAttribute('aria-hidden', 'true');
        return;
      }
      if (node.parentNode) node.parentNode.removeChild(node);
    });
    if (keeper) {
      if (window.BurnfolderPlaybackPrefetch) {
        window.BurnfolderPlaybackPrefetch.setActivePlayer(keeper);
      }
      return keeper;
    }
    const created = document.createElement('mux-player');
    created.id = 'activeMuxPlayer';
    created.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;clip:rect(0,0,0,0);';
    created.setAttribute('playsinline', '');
    created.setAttribute('audio', '');
    created.setAttribute('stream-type', 'on-demand');
    created.setAttribute('preload', 'metadata');
    if (window.BurnfolderPlaybackPrefetch) {
      window.BurnfolderPlaybackPrefetch.setActivePlayer(created);
    }
    return created;
  }

  function ensureShell() {
    let shell = document.getElementById(SHELL_ID);
    if (shell) return shell;

    const player = dedupeGlobalPlayer();

    shell = document.createElement('div');
    shell.id = SHELL_ID;
    shell.className = 'studio-global-playback';

    const bar = document.createElement('div');
    bar.className = 'bottom-progress-bar';
    bar.id = 'bottomBar';
    bar.style.display = 'none';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Now playing');

    bar.innerHTML =
      '<button type="button" class="close-btn" id="streamNowPlayingClose" aria-label="Close Now Playing">✕</button>' +
      '<div class="bottom-bar-content">' +
      '<div class="song-title-wrap"><span class="song-title" id="streamNowPlayingTitle">—</span></div>' +
      '<div class="bottom-bar-controls">' +
      '<button type="button" class="bottom-play-pause-btn" id="streamPlayPause" aria-label="Play/Pause">▶</button>' +
      '<div class="progress-bar-area" id="progressBarArea">' +
      '<div class="progress" id="progress"></div>' +
      '<div class="progress-playhead" id="progressPlayhead"></div>' +
      '</div></div>' +
      '<div class="loading-spinner" id="loadingSpinner"></div>' +
      '</div>';

    const content = bar.querySelector('.bottom-bar-content');
    content.insertBefore(player, content.firstChild);

    shell.appendChild(bar);
    document.body.appendChild(shell);

    Array.from(document.querySelectorAll('#bottomBar')).forEach(function (node) {
      if (node.closest('#' + SHELL_ID)) return;
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

  function mountBar() {
    ensureShell();
    dedupeGlobalPlayer();
    const shell = document.getElementById(SHELL_ID);
    const bar = shell ? shell.querySelector('#bottomBar') : null;
    if (!bar || !window.BurnfolderNowPlayingBar) return barApi;

    if (barApi) {
      syncAfterNavigation();
      return barApi;
    }

    barApi = window.BurnfolderNowPlayingBar.mount({
      barEl: bar,
      titleEl: shell.querySelector('#streamNowPlayingTitle'),
      playBtnEl: shell.querySelector('#streamPlayPause'),
      closeBtnEl: shell.querySelector('#streamNowPlayingClose'),
      muxPlayerEl: getShellPlayer(),
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
    dedupeGlobalPlayer();
    mountBar();
    const eng = getEngine();
    if (!eng || !barApi) return;
    const song = eng.getActiveSong();
    const player = getShellPlayer();
    if (!song || !player) return;
    barApi.setBarVisible(true);
    barApi.update({ song: song, playing: !player.paused });
  }

  function boot() {
    ensureShell();
    const whenMux =
      typeof customElements !== 'undefined'
        ? customElements.whenDefined('mux-player')
        : Promise.resolve();
    whenMux
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
      if (isTypingTarget(event.target)) return;
      ensureShell();
      mountBar();
      const shell = document.getElementById(SHELL_ID);
      const bar = shell ? shell.querySelector('#bottomBar') : null;
      const eng = getEngine();
      if (!eng || !eng.getActiveSong()) return;
      if (!bar || bar.style.display !== 'flex') return;
      event.preventDefault();
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
