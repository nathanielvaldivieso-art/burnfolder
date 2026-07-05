(function () {
  'use strict';

  function shellBridge() {
    if (!window.BurnfolderStudioPlaybackShell) return null;
    const shell = window.BurnfolderStudioPlaybackShell;
    shell.ensureShell();
    shell.mountBar();
    return {
      update: function (detail) {
        const bar = shell.mountBar();
        if (bar) bar.update(detail);
      },
      setBarVisible: function (show) {
        const bar = shell.mountBar();
        if (bar) bar.setBarVisible(show);
      },
      setCatalogProvider: function (provider) {
        if (window.BurnfolderPlaybackContext) {
          window.BurnfolderPlaybackContext.setCatalogProvider(provider);
        }
        window.BurnfolderPlaybackCatalogProvider = provider || null;
        const bar = shell.mountBar();
        if (bar && bar.renderPicker) bar.renderPicker();
      }
    };
  }

  const throughShell = shellBridge();
  if (throughShell) {
    window.BurnfolderStreamNowPlaying = throughShell;
    return;
  }

  const bar = document.getElementById('bottomBar');
  if (!bar || !window.BurnfolderNowPlayingBar) return;

  let barApi = null;

  function streamPlayer() {
    return window.BurnfolderStreamPlayer;
  }

  function syncCatalogProvider() {
    const prov = window.BurnfolderPlaybackCatalogProvider;
    if (window.BurnfolderPlaybackContext && window.BurnfolderPlaybackContext.setCatalogProvider) {
      window.BurnfolderPlaybackContext.setCatalogProvider(prov || null);
    }
  }

  barApi = window.BurnfolderNowPlayingBar.mount({
    barEl: bar,
    titleEl: document.getElementById('streamNowPlayingTitle'),
    playBtnEl: document.getElementById('streamPlayPause'),
    closeBtnEl: document.getElementById('streamNowPlayingClose'),
    bodyActiveClass: 'stream-playback-active',
    playbackEventName: 'burnfolder-stream-playback',
    getActiveSong: function () {
      const p = streamPlayer();
      return p ? p.getActiveSong() : null;
    },
    onTogglePlay: function () {
      const p = streamPlayer();
      if (p) p.togglePause();
    },
    onClose: function () {
      const p = streamPlayer();
      if (p) p.stop();
      barApi.update({ song: null, playing: false });
    },
    onPlayVersion: function (song) {
      const prov = window.BurnfolderPlaybackCatalogProvider;
      const lib = prov && prov.getLibrary ? prov.getLibrary() : [];
      const shared = window.BurnfolderStreamShared;
      const item = shared ? shared.findInLibrary(lib, song.playbackId) : null;
      const p = streamPlayer();
      if (p && item) p.playItem(item);
      else if (p) {
        p.playItem({
          playbackId: song.playbackId,
          passthrough: song.title,
          kind: song.kind || 'audio'
        });
      }
    }
  });

  syncCatalogProvider();

  window.BurnfolderStreamNowPlaying = {
    update: function (detail) {
      if (barApi) barApi.update(detail);
    },
    setBarVisible: function (show) {
      if (barApi) barApi.setBarVisible(show);
    },
    setCatalogProvider: function (provider) {
      if (window.BurnfolderPlaybackContext) {
        window.BurnfolderPlaybackContext.setCatalogProvider(provider);
      }
      window.BurnfolderPlaybackCatalogProvider = provider || null;
      if (barApi) barApi.renderPicker();
    }
  };
})();
