(function () {
  'use strict';

  const shared = window.BurnfolderStreamShared;
  const muxLib = window.BurnfolderStudioMux;
  const player = window.BurnfolderStreamPlayer;
  const versionsApi = window.BurnfolderSongVersions;

  const params = new URLSearchParams(window.location.search);
  const paramSong = (params.get('song') || '').toLowerCase().trim();
  const paramPlayback = params.get('p') || '';

  const main = document.getElementById('songMain');
  const videoHero = document.getElementById('songVideoHero');
  const titleEl = document.getElementById('songHubTitle');
  const subtitleEl = document.getElementById('songHubSubtitle');
  const versionsEl = document.getElementById('songHubVersions');
  const sortEl = document.getElementById('songHubSort');
  const statusEl = document.getElementById('songStatus');
  const stackBtn = document.getElementById('songStackBtn');
  const entryBtn = document.getElementById('songEntryBtn');
  const siteBtn = document.getElementById('songSiteBtn');
  const copyBtn = document.getElementById('songCopyBtn');
  const deleteBtn = document.getElementById('songDeleteBtn');

  let libraryCache = [];
  let songCatalog = [];
  let item = null;

  function setStatus(msg) {
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

  function catalogSongFromItem(row) {
    const title = versionsApi
      ? versionsApi.titleFromCatalog(songCatalog, row.playbackId, itemLabel(row))
      : itemLabel(row);
    return versionsApi ? versionsApi.libraryItemToSong(row, title) : { title: title, playbackId: row.playbackId };
  }

  function libraryItemForSong(song) {
    if (!song) return null;
    const fromLib = shared.findInLibrary(libraryCache, song.playbackId);
    if (fromLib) {
      return Object.assign({}, fromLib, {
        passthrough: song.title,
        displayTitle: versionsApi ? versionsApi.displayTitleForSong(song) : song.title
      });
    }
    return {
      playbackId: song.playbackId,
      passthrough: song.title,
      displayTitle: versionsApi ? versionsApi.displayTitleForSong(song) : song.title,
      kind: song.kind || 'audio',
      hasVideoTrack: song.hasVideoTrack,
      muxAssetId: song.muxAssetId || null,
      createdAt: song.createdAt || null
    };
  }

  function resolveTargetItem() {
    if (!versionsApi) {
      item = shared.findInLibrary(libraryCache, paramPlayback || paramSong);
      return item;
    }

    let ref = paramPlayback || paramSong;
    if (!ref) return null;

    const newest = versionsApi.resolveNewestSongInCatalog(songCatalog, ref, itemLabel);
    if (!newest) {
      item = shared.findInLibrary(libraryCache, ref);
      return item;
    }

    item = libraryItemForSong(newest);
    if (item && paramPlayback && item.playbackId !== paramPlayback) {
      const url = new URL(window.location.href);
      url.searchParams.delete('song');
      url.searchParams.set('p', item.playbackId);
      window.history.replaceState({}, '', url.pathname + url.search);
    }
    return item;
  }

  function syncVersionsPlayback() {
    if (!versionsEl || !player) return;
    versionsEl.querySelectorAll('.music-track-row').forEach(function (row) {
      const id = row.dataset.playbackId;
      row.classList.toggle('is-active', !!player.isActivePlaybackId(id));
      row.classList.toggle('is-playing', !!player.isPlayingPlaybackId(id));
    });
  }

  function renderVersionsPanel(catalogSong) {
    if (!versionsEl || !versionsApi) return;

    const groupKey = versionsApi.getTrackGroupKey(catalogSong.title);
    const matching = versionsApi.collectVersionsByGroupKey(songCatalog, groupKey);
    if (!matching.length) {
      versionsEl.innerHTML =
        '<p class="song-hub-empty">Versions will appear here as they are added.</p>';
      return;
    }

    const baseTitle = versionsApi.getBaseTitle(matching);
    if (titleEl) titleEl.textContent = baseTitle;
    if (subtitleEl) {
      subtitleEl.textContent =
        matching.length + ' version' + (matching.length === 1 ? '' : 's');
    }

    function paint() {
      const sortMode = sortEl ? sortEl.value || 'newest' : 'newest';
      const sorted = versionsApi.sortVersions(matching, sortMode);
      const active = player ? player.getActiveSong() : null;
      versionsApi.fillVersionTracklist(versionsEl, sorted, {
        activePlaybackId: active && active.playbackId,
        onSelect: function (song) {
          const row = libraryItemForSong(song);
          if (!row || !player) return;
          if (shared.canPlayAsVideo(row)) {
            if (videoHero) shared.mountStreamVideo(row, videoHero, { autoplay: true });
            player.stop();
          } else {
            if (videoHero) shared.clearStreamVideo(videoHero);
            player.playItem(row);
          }
          syncVersionsPlayback();
        }
      });
      syncVersionsPlayback();
    }

    if (sortEl && !sortEl.dataset.bound) {
      sortEl.dataset.bound = '1';
      sortEl.addEventListener('change', paint);
    }
    paint();
  }

  function render(item) {
    const catalogSong = catalogSongFromItem(item);
    const label = versionsApi
      ? versionsApi.displayTitleForSongInCatalog(songCatalog, catalogSong)
      : itemLabel(item);
    const isVideo = shared.canPlayAsVideo(item);

    document.title = label + ' — stream';
    document.body.classList.toggle('studio-song-page--video', isVideo);
    document.body.classList.toggle('studio-song-page--audio', !isVideo);

    renderVersionsPanel(catalogSong);
    if (entryBtn) entryBtn.href = shared.editorHrefSingle(item);

    if (siteBtn && versionsApi) {
      const siteSong = versionsApi.resolvePlaybackInCatalog(songCatalog, item.playbackId);
      if (siteSong && siteSong.title) {
        siteBtn.href = versionsApi.getSongHubHref(siteSong, '../');
        siteBtn.hidden = false;
      } else {
        siteBtn.hidden = true;
      }
    }

    if (stackBtn) {
      stackBtn.disabled = isVideo;
      stackBtn.hidden = isVideo;
      const inStack = shared.loadStack().some(function (t) {
        return t.playbackId === item.playbackId;
      });
      stackBtn.classList.toggle('is-on', inStack);
    }

    if (videoHero) {
      if (isVideo && item.playbackId) {
        shared.mountStreamVideo(item, videoHero, { autoplay: true });
      } else {
        shared.clearStreamVideo(videoHero);
      }
    }

    if (deleteBtn) {
      deleteBtn.hidden = !item.muxAssetId;
    }

    if (main) main.hidden = false;
  }

  function deleteItem() {
    const label = itemLabel(item);
    if (!window.confirm('delete "' + label + '" from mux? this cannot be undone.')) return;
    if (!item.muxAssetId) {
      setStatus('only mux uploads can be deleted here');
      return;
    }
    setStatus('deleting…');
    window.BurnfolderMux.deleteMuxAsset(item.muxAssetId)
      .then(function () {
        if (window.BurnfolderAssetCloud && window.BurnfolderAssetCloud.deleteByMuxAssetId) {
          return window.BurnfolderAssetCloud.deleteByMuxAssetId(item.muxAssetId);
        }
        return 0;
      })
      .then(function () {
        shared.removeFromStack(item.playbackId);
        if (player) player.stop();
        window.location.href = shared.isVideoItem(item) ? 'video.html' : 'stream.html';
      })
      .catch(function (err) {
        setStatus(err.message || 'delete failed');
      });
  }

  if (stackBtn) {
    stackBtn.addEventListener('click', function () {
      shared.addToStack(item);
      stackBtn.classList.add('is-on');
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      const id = item.playbackId || '';
      if (!id) return;
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(id).then(function () {
          setStatus('copied');
        });
      }
    });
  }

  if (deleteBtn) deleteBtn.addEventListener('click', deleteItem);

  window.addEventListener('burnfolder-stream-playback', function () {
    syncVersionsPlayback();
  });

  document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
    link.classList.toggle('is-active', link.getAttribute('data-nav') === 'stream');
  });

  muxLib
    .listMuxLibrary()
    .then(function (assets) {
      songCatalog = buildCatalog(assets);
      item = resolveTargetItem();
      if (!item) {
        setStatus('not found');
        return;
      }
      render(item);
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
