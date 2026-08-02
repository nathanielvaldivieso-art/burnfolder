/**
 * Canonical studio global playback stack — single source of truth.
 * Load order: mux CDN (defer, head) → these scripts → page script.
 */
(function (root) {
  'use strict';

  var SHELL_ID = 'studioGlobalPlayback';
  var PLAYER_ID = 'activeMuxPlayer';
  var PREVIEW_PLAYER_SELECTOR = '.studio-preview-player #activeMuxPlayer, .studio-preview-player mux-player';

  var PLAYER_PIN_STYLE =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  var STANDBY_ID = 'standbyMuxPlayer';

  var SHELL_MARKUP =
    '<div id="' +
    SHELL_ID +
    '" class="studio-global-playback">' +
    '<div class="bottom-progress-bar" id="bottomBar" style="display:none" role="region" aria-label="Now playing">' +
    '<button type="button" class="close-btn" id="streamNowPlayingClose" aria-label="Close Now Playing">✕</button>' +
    '<div class="bottom-bar-content">' +
    '<mux-player id="' +
    PLAYER_ID +
    '" audio playsinline stream-type="on-demand" preload="auto" style="' +
    PLAYER_PIN_STYLE +
    '"></mux-player>' +
    '<mux-player id="' +
    STANDBY_ID +
    '" audio playsinline stream-type="on-demand" preload="auto" style="' +
    PLAYER_PIN_STYLE +
    '"></mux-player>' +
    '<div class="song-title-wrap"><span class="song-title" id="streamNowPlayingTitle">—</span></div>' +
    '<div class="bottom-bar-controls">' +
    '<button type="button" class="bottom-play-pause-btn" id="streamPlayPause" aria-label="Play/Pause">▶</button>' +
    '<div class="bottom-playback-rate" id="streamPlaybackRate">' +
    '<input type="range" class="bottom-playback-rate-slider" min="0" max="200" step="1" value="100" aria-label="Playback speed">' +
    '<button type="button" class="bottom-playback-rate-value" aria-label="Reset speed to 100%">100%</button>' +
    '</div>' +
    '</div>' +
    '<div class="progress-bar-area" id="progressBarArea">' +
    '<div class="progress" id="progress"></div>' +
    '<div class="progress-playhead" id="progressPlayhead"></div>' +
    '</div>' +
    '<div class="loading-spinner" id="loadingSpinner"></div>' +
    '</div></div></div>';

  /** Core scripts every studio page with playback must load (sequential, not parallel). */
  var CORE_SCRIPTS = [
    '../shared/media-session.js',
    '../shared/playback-recall.js',
    '../shared/playback-prefetch.js',
    '../shared/ios-playback-keepalive.js',
    '../shared/mux-playback.js',
    '../shared/playback-context.js',
    '../shared/version-picker.js',
    '../shared/studio-tap.js',
    '../shared/now-playing-bar.js',
    'js/studio-playback-shell.js',
    'js/stream-player.js',
    'js/stream-now-playing.js'
  ];

  function isPreviewPlaybackNode(node) {
    return !!(node && node.closest && node.closest('.studio-preview-player'));
  }

  function ensureStandbyInShell(shell) {
    if (!shell) return null;
    var primary = shell.querySelector('#' + PLAYER_ID);
    var standby = shell.querySelector('#' + STANDBY_ID) || root.document.getElementById(STANDBY_ID);
    if (standby) return standby;
    if (!primary || !primary.parentNode) return null;
    standby = root.document.createElement('mux-player');
    standby.id = STANDBY_ID;
    standby.setAttribute('audio', '');
    standby.setAttribute('playsinline', '');
    standby.setAttribute('stream-type', 'on-demand');
    standby.setAttribute('preload', 'auto');
    standby.setAttribute('style', PLAYER_PIN_STYLE);
    primary.parentNode.insertBefore(standby, primary.nextSibling);
    return standby;
  }

  function ensureShellMarkup() {
    if (!root.document || !root.document.body) return null;
    var existing = root.document.getElementById(SHELL_ID);
    if (existing) {
      ensureStandbyInShell(existing);
      return existing;
    }
    root.document.body.insertAdjacentHTML('beforeend', SHELL_MARKUP);
    return root.document.getElementById(SHELL_ID);
  }

  root.BurnfolderStudioPlaybackStack = {
    SHELL_ID: SHELL_ID,
    PLAYER_ID: PLAYER_ID,
    STANDBY_ID: STANDBY_ID,
    SHELL_MARKUP: SHELL_MARKUP,
    CORE_SCRIPTS: CORE_SCRIPTS,
    isPreviewPlaybackNode: isPreviewPlaybackNode,
    ensureShellMarkup: ensureShellMarkup
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
