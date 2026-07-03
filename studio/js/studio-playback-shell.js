(function () {
  'use strict';

  if (!document.body || !document.body.classList.contains('studio-page')) return;

  const SHELL_ID = 'studioGlobalPlayback';
  let barApi = null;
  let engine = null;

  function dedupeGlobalPlayer() {
    const players = Array.from(document.querySelectorAll('mux-player#activeMuxPlayer, #activeMuxPlayer'));
    let keeper = document.getElementById('activeMuxPlayer');
    players.forEach(function (node) {
      if (node === keeper) return;
      const shell = node.closest('#' + SHELL_ID);
      if (shell) return;
      const bar = node.closest('#bottomBar');
      if (bar && bar.id !== 'bottomBar') bar.remove();
      else if (node.parentNode) node.parentNode.removeChild(node);
    });
    if (!keeper) {
      keeper = document.createElement('mux-player');
      keeper.id = 'activeMuxPlayer';
      keeper.style.cssText =
        'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;clip:rect(0,0,0,0);';
    }
    keeper.setAttribute('playsinline', '');
    keeper.setAttribute('audio', '');
    keeper.setAttribute('stream-type', 'on-demand');
    keeper.setAttribute('preload', 'metadata');
    if (window.BurnfolderPlaybackPrefetch) {
      window.BurnfolderPlaybackPrefetch.setActivePlayer(keeper);
    }
    return keeper;
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
    const player = document.getElementById('activeMuxPlayer');

    engine = window.BurnfolderMuxPlayback.create({
      getPlayer: function () {
        return player;
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
    if (barApi || !window.BurnfolderNowPlayingBar) return barApi;
    ensureShell();
    const bar = document.getElementById('bottomBar');
    if (!bar) return null;

    barApi = window.BurnfolderNowPlayingBar.mount({
      barEl: bar,
      titleEl: document.getElementById('streamNowPlayingTitle'),
      playBtnEl: document.getElementById('streamPlayPause'),
      closeBtnEl: document.getElementById('streamNowPlayingClose'),
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

  function boot() {
    ensureShell();
    getEngine();
    if (window.BurnfolderNowPlayingBar) mountBar();
    bindSpacebarToggle();
  }

  function isTypingTarget(target) {
    const el = target && target.nodeType === 1 ? target : null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(el.closest('[contenteditable="true"]'));
  }

  function playbackBarVisible() {
    const bar = document.querySelector('#studioGlobalPlayback #bottomBar');
    return !!(bar && bar.style.display === 'flex');
  }

  function bindSpacebarToggle() {
    if (window.__studioPlaybackSpaceBound) return;
    window.__studioPlaybackSpaceBound = true;
    document.addEventListener('keydown', function (e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const eng = getEngine();
      if (!eng || !eng.getActiveSong()) return;
      if (!playbackBarVisible()) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      eng.togglePlayPause();
    });
  }

  window.BurnfolderStudioPlaybackShell = {
    ensureShell: ensureShell,
    getEngine: getEngine,
    mountBar: mountBar
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
