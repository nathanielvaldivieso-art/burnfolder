(function () {
  'use strict';

  const shared = window.BurnfolderStreamShared;
  const muxLib = window.BurnfolderStudioMux;
  const player = window.BurnfolderStreamPlayer;
  const versionsApi = window.BurnfolderSongVersions;
  const albumStore = window.BurnfolderAlbumPageStore;
  const songStore = window.BurnfolderSongPageStore;
  const albumRender = window.BurnfolderAlbumPageRender;

  const params = new URLSearchParams(window.location.search);
  const albumId = (params.get('album') || '').trim();

  const main = document.getElementById('albumMain');
  const statusEl = document.getElementById('albumStatus');
  const designBtn = document.getElementById('albumDesignBtn');
  const siteBtn = document.getElementById('albumSiteBtn');
  const copyBtn = document.getElementById('albumCopyBtn');
  const hubPlayBtn = document.getElementById('albumHubPlay');

  let libraryCache = [];
  let songCatalog = [];
  let group = null;
  let currentAlbumPage = null;
  let shareHubApi = null;
  let compiledRows = [];

  function setStatus(msg, kind) {
    if (window.BurnfolderStudioStatus) {
      window.BurnfolderStudioStatus.set(statusEl, msg, kind);
      return;
    }
    if (statusEl) statusEl.textContent = msg || '';
  }

  function itemLabel(row) {
    return shared.muxFileLabel(row);
  }

  function buildCatalog(assets) {
    libraryCache = shared.normalizeLibrary(assets);
    if (!versionsApi) return libraryCache.slice();
    return versionsApi.mergeSongCatalog(versionsApi.getSiteCatalog(window), libraryCache, itemLabel);
  }

  function resolveStackTrackItem(track) {
    if (!track || !track.playbackId) return track;
    const libItem = shared.findInLibrary(libraryCache, track.playbackId) || track;
    if (!versionsApi) return libItem;
    const newest = versionsApi.resolveNewestSongInCatalog(
      songCatalog,
      { title: track.title || itemLabel(libItem), playbackId: libItem.playbackId },
      itemLabel
    );
    if (!newest || !newest.playbackId) return libItem;
    return shared.findInLibrary(libraryCache, newest.playbackId) || libItem;
  }

  function albumTracks() {
    if (!group) return [];
    return (group.tracks || [])
      .map(resolveStackTrackItem)
      .filter(function (item) {
        return item && item.playbackId && !shared.canPlayAsVideo(item);
      });
  }

  function albumShareTracks() {
    return albumTracks().map(function (item) {
      return { title: itemLabel(item), playbackId: item.playbackId };
    });
  }

  function loadSongPagesForTracks(tracks) {
    const pages = {};
    if (!songStore || !versionsApi) return Promise.resolve(pages);
    const keys = {};
    tracks.forEach(function (item) {
      const key = versionsApi.getTrackGroupKey(itemLabel(item));
      if (key) keys[key] = true;
    });
    const list = Object.keys(keys);
    if (!list.length) return Promise.resolve(pages);
    return Promise.all(
      list.map(function (key) {
        return songStore.resolvePage(key, true).then(function (page) {
          pages[key] = page;
        });
      })
    ).then(function () {
      return pages;
    });
  }

  function syncTracklistPlayback() {
    if (!main || !player) return;
    main.querySelectorAll('.album-hub-track-item .music-track-row').forEach(function (row) {
      const id = row.dataset.playbackId;
      row.classList.toggle('is-active', !!player.isActivePlaybackId(id));
      row.classList.toggle('is-playing', !!player.isPlayingPlaybackId(id));
    });
  }

  function syncAlbumPlayButton() {
    if (!hubPlayBtn || !player) return;
    const tracks = albumTracks();
    if (!tracks.length) {
      hubPlayBtn.hidden = true;
      return;
    }
    hubPlayBtn.hidden = false;
    const active = player.getActiveSong();
    const onAlbum =
      active &&
      tracks.some(function (item) {
        return item.playbackId === active.playbackId;
      });
    const playing = !!(onAlbum && player.isPlayingPlaybackId(active.playbackId));
    hubPlayBtn.classList.toggle('is-playing', playing);
    hubPlayBtn.setAttribute('aria-label', playing ? 'Pause album' : 'Play album');
  }

  function playAlbumFrom(index, startPlaybackId) {
    const tracks = albumTracks();
    if (!tracks.length || !player) return;
    const wantId = startPlaybackId || '';
    let idx = typeof index === 'number' ? index : 0;
    if (wantId) {
      const byId = tracks.findIndex(function (item) {
        return item && item.playbackId === wantId;
      });
      if (byId >= 0) idx = byId;
    }
    const meta = shared.loadStackMeta(group.id);
    const target = tracks[idx] || tracks[0];
    player.playQueue(tracks, idx, {
      coverArt: meta.coverArt || '',
      startPlaybackId: (target && target.playbackId) || wantId || ''
    });
    syncTracklistPlayback();
    syncAlbumPlayButton();
  }

  function mountShareHub() {
    const mount = document.getElementById('albumShareMount');
    const ui = window.BurnfolderShareHubUI;
    if (!mount || !ui || !group) return;
    if (shareHubApi && shareHubApi.destroy) shareHubApi.destroy();
    const groupId = group.id;
    shareHubApi = ui.mount(mount, {
      context: 'album',
      albumId: groupId,
      embedded: true,
      getTitle: function () {
        const meta = shared.loadStackMeta(groupId);
        return meta.title || 'album';
      },
      getAlbumTracks: albumShareTracks,
      getCoverArt: function () {
        const meta = shared.loadStackMeta(groupId);
        return meta.coverArt || '';
      }
    });
  }

  function renderAlbum() {
    if (!group || !albumRender || !main) return Promise.resolve();
    const meta = shared.loadStackMeta(group.id);
    const tracks = albumTracks();

    document.title = (meta.title || 'Album') + ' — stream';

    return loadSongPagesForTracks(tracks).then(function (songPages) {
      compiledRows = albumRender.apply(main, {
        albumPage: currentAlbumPage,
        meta: meta,
        tracks: tracks,
        songPages: songPages,
        songCatalog: songCatalog,
        versionsApi: versionsApi,
        library: libraryCache,
        shared: shared,
        itemLabel: itemLabel,
        songPageUrl: function (item) {
          return shared.songPageUrl(item);
        },
        onTrackSelect: function (row) {
          const idx = tracks.findIndex(function (item) {
            return item.playbackId === row.playbackId;
          });
          playAlbumFrom(idx >= 0 ? idx : 0, row.playbackId || '');
        }
      });

      if (designBtn) {
        designBtn.href = 'album-designer.html?album=' + encodeURIComponent(group.id);
      }
      if (siteBtn) {
        siteBtn.href = '../album.html?album=' + encodeURIComponent(group.id);
        siteBtn.hidden = !(currentAlbumPage && currentAlbumPage.published);
      }

      mountShareHub();
      syncTracklistPlayback();
      syncAlbumPlayButton();
      if (main) main.hidden = false;
    });
  }

  if (hubPlayBtn) {
    hubPlayBtn.addEventListener('click', function () {
      playAlbumFrom(0);
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      if (!group || !group.id) return;
      const api = window.BurnfolderShareLinks;
      const text = group.id;
      const copy = api && api.copyText ? api.copyText(text) : null;
      if (copy && copy.then) {
        copy.then(function () {
          setStatus('copied album id');
        });
      }
    });
  }

  window.addEventListener('burnfolder-stream-playback', function () {
    syncTracklistPlayback();
    syncAlbumPlayButton();
  });

  window.addEventListener('burnfolder-stack-meta-changed', function () {
    if (group) renderAlbum();
  });

  window.addEventListener('burnfolder-song-pages-synced', function () {
    if (group) renderAlbum();
  });

  window.addEventListener('burnfolder-album-pages-synced', function () {
    if (group) renderAlbum();
  });

  document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
    const active = link.getAttribute('data-nav') === 'stream';
    link.classList.toggle('is-active', active);
    link.classList.toggle('page-nav', active);
  });

  if (window.BurnfolderStudioPlaybackShell) {
    window.BurnfolderStudioPlaybackShell.ensureShell();
    window.BurnfolderStudioPlaybackShell.mountBar();
  }

  if (!albumId) {
    setStatus('missing album id');
    return;
  }

  group = shared.findGroupById(albumId);
  if (!group) {
    setStatus('album not found');
    return;
  }

  const loadPage =
    albumStore && albumStore.resolvePage
      ? albumStore.resolvePage(albumId, true)
      : Promise.resolve(null);

  muxLib
    .listMuxLibrary()
    .then(function (assets) {
      songCatalog = buildCatalog(assets);
      return loadPage;
    })
    .then(function (page) {
      currentAlbumPage = page;
      return renderAlbum();
    })
    .then(function () {
      const provider = {
        getCatalog: function () {
          return songCatalog;
        },
        getLibrary: function () {
          return libraryCache;
        },
        labelForItem: itemLabel
      };
      window.BurnfolderPlaybackCatalogProvider = provider;
      if (window.BurnfolderPlaybackContext && window.BurnfolderPlaybackContext.setCatalogProvider) {
        window.BurnfolderPlaybackContext.setCatalogProvider(provider);
      }
      if (window.BurnfolderStreamNowPlaying && window.BurnfolderStreamNowPlaying.setCatalogProvider) {
        window.BurnfolderStreamNowPlaying.setCatalogProvider(provider);
      }
    })
    .catch(function (err) {
      setStatus(err.message || 'could not load');
    });
})();
