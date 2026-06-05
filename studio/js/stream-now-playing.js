(function () {
  'use strict';

  const bar = document.getElementById('bottomBar');
  if (!bar) return;

  if (window.BurnfolderStudioPlaybackShell) {
    window.BurnfolderStudioPlaybackShell.mountBar();
    window.BurnfolderStreamNowPlaying = {
      update: function (detail) {
        const shellBar = window.BurnfolderStudioPlaybackShell.mountBar();
        if (shellBar) shellBar.update(detail);
      },
      setBarVisible: function (show) {
        const shellBar = window.BurnfolderStudioPlaybackShell.mountBar();
        if (shellBar) shellBar.setBarVisible(show);
      },
      setCatalogProvider: function (provider) {
        if (window.BurnfolderPlaybackContext) {
          window.BurnfolderPlaybackContext.setCatalogProvider(provider);
        }
        window.BurnfolderPlaybackCatalogProvider = provider || null;
        const shellBar = window.BurnfolderStudioPlaybackShell.mountBar();
        if (shellBar && shellBar.renderPicker) shellBar.renderPicker();
      }
    };
    return;
  }

  if (!window.BurnfolderNowPlayingBar) return;

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
