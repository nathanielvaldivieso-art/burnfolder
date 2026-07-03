(function () {
  'use strict';

  if (!document.body.classList.contains('studio-page')) return;
  if (!window.BurnfolderStudioPlaybackShell) return;

  const shell = window.BurnfolderStudioPlaybackShell;

  function engine() {
    return shell.getEngine();
  }

  function syncEditorPlaybackUi() {
    if (typeof window.updateUI === 'function') window.updateUI();
    if (typeof window.syncPlaybackChromeState === 'function') window.syncPlaybackChromeState();
    if (typeof window.syncTracklistPlayback === 'function') window.syncTracklistPlayback();
  }

  window.startPlayback = function (song, queueSongs, queueIdx) {
    const playback = engine();
    if (!playback || !song) return;
    shell.mountBar();
    playback.playTrackQueue(
      Array.isArray(queueSongs) && queueSongs.length ? queueSongs : [song],
      typeof queueIdx === 'number' ? queueIdx : 0,
      {
        immediatePlay: true,
        queueScope: Array.isArray(queueSongs) && queueSongs.length > 1 ? 'explicit' : 'single',
        allowQueueAdvance: Array.isArray(queueSongs) && queueSongs.length > 1,
        source: 'editor'
      }
    );
    syncEditorPlaybackUi();
  };

  window.playTrackQueue = function (queueSongs, queueStartIdx) {
    const playback = engine();
    if (!playback) return;
    shell.mountBar();
    playback.playTrackQueue(queueSongs, queueStartIdx || 0, {
      immediatePlay: true,
      queueScope: queueSongs.length > 1 ? 'explicit' : 'single',
      allowQueueAdvance: queueSongs.length > 1,
      source: 'editor-queue'
    });
    syncEditorPlaybackUi();
  };

  window.togglePlayPause = function () {
    const playback = engine();
    if (!playback) return;
    playback.togglePlayPause();
    syncEditorPlaybackUi();
  };

  window.getActiveSong = function () {
    const playback = engine();
    return playback ? playback.getActiveSong() : null;
  };
})();
