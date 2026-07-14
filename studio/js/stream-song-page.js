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
  const entryBtn = document.getElementById('songEntryBtn');
  const siteBtn = document.getElementById('songSiteBtn');
  const designBtn = document.getElementById('songDesignBtn');
  const copyBtn = document.getElementById('songCopyBtn');
  const deleteBtn = document.getElementById('songDeleteBtn');

  let libraryCache = [];
  let songCatalog = [];
  let item = null;
  let currentSongPage = null;
  let shareHubApi = null;

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

  function syncSongHubPlayButton(sorted) {
    const hubPlayBtn = document.getElementById('songHubPlay');
    if (!hubPlayBtn || !player) return;
    if (!sorted || !sorted.length) {
      hubPlayBtn.hidden = true;
      return;
    }
    hubPlayBtn.hidden = false;
    const active = player.getActiveSong();
    const onThisSong = active && sorted.some(function (song) {
      return song.playbackId === active.playbackId;
    });
    const playing = !!(onThisSong && player.isPlayingPlaybackId(active.playbackId));
    hubPlayBtn.classList.toggle('is-playing', playing);
    hubPlayBtn.setAttribute('aria-label', playing ? 'Pause song' : 'Play song');
  }

  function audioQueueItems(sorted) {
    return sorted
      .map(libraryItemForSong)
      .filter(function (row) {
        return row && !shared.canPlayAsVideo(row);
      });
  }

  function playSongHubQueue(sorted, song) {
    if (!sorted || !sorted.length || !song || !player) return;
    const audioItems = audioQueueItems(sorted);
    if (!audioItems.length) return;
    const idx = audioItems.findIndex(function (row) {
      return row.playbackId === song.playbackId;
    });
    if (videoHero) shared.clearStreamVideo(videoHero);
    player.playQueue(audioItems, idx >= 0 ? idx : 0);
    syncVersionsPlayback();
    syncSongHubPlayButton(sorted);
    const renderApi = window.BurnfolderSongPageRender;
    if (renderApi && currentSongPage && main && song.playbackId) {
      renderApi.selectVersion(main, currentSongPage, song.playbackId);
    }
  }

  function bindSongHubPlay(sorted) {
    const hubPlayBtn = document.getElementById('songHubPlay');
    if (!hubPlayBtn || hubPlayBtn.dataset.bound) return;
    hubPlayBtn.dataset.bound = '1';
    hubPlayBtn.addEventListener('click', function () {
      const startSong = sorted[0];
      if (!startSong) return;
      const active = player.getActiveSong();
      const onHub = active && sorted.some(function (item) {
        return item.playbackId === active.playbackId;
      });
      if (onHub) {
        player.togglePause();
        syncVersionsPlayback();
        syncSongHubPlayButton(sorted);
        return;
      }
      playSongHubQueue(sorted, startSong);
    });
  }

  function mountShareHub(catalogSong) {
    const mount = document.getElementById('songShareMount');
    const ui = window.BurnfolderShareHubUI;
    if (!mount || !ui || !versionsApi || !catalogSong) return;
    const groupKey = versionsApi.getTrackGroupKey(catalogSong.title);
    if (shareHubApi && shareHubApi.destroy) shareHubApi.destroy();
    shareHubApi = ui.mount(mount, {
      context: 'song',
      groupKey: groupKey,
      embedded: true,
      getTitle: function () {
        return versionsApi.getBaseTitle(
          versionsApi.collectVersionsByGroupKey(songCatalog, groupKey)
        );
      },
      getVersions: function () {
        return versionsApi.collectVersionsByGroupKey(songCatalog, groupKey);
      },
      getCoverArt: function () {
        return currentSongPage && currentSongPage.coverArt ? currentSongPage.coverArt : '';
      }
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
      const renderApi = window.BurnfolderSongPageRender;
      versionsApi.fillVersionTracklist(versionsEl, sorted, {
        activePlaybackId: active && active.playbackId,
        onSelect: function (song) {
          const row = libraryItemForSong(song);
          if (!row || !player) return;
          if (shared.canPlayAsVideo(row)) {
            if (videoHero) shared.mountStreamVideo(row, videoHero, { autoplay: true });
            player.stop();
            syncVersionsPlayback();
            const renderApi = window.BurnfolderSongPageRender;
            if (renderApi && currentSongPage && song.playbackId) {
              renderApi.selectVersion(main, currentSongPage, song.playbackId);
            }
          } else {
            playSongHubQueue(sorted, song);
            syncVersionsPlayback();
          }
        }
      });
      syncVersionsPlayback();
      syncSongHubPlayButton(sorted);
      bindSongHubPlay(sorted);

      if (renderApi && currentSongPage && main) {
        const active = player ? player.getActiveSong() : null;
        const activeOnHub =
          active && sorted.some(function (item) {
            return item.playbackId === active.playbackId;
          });
        renderApi.apply(main, {
          page: currentSongPage,
          baseTitle: baseTitle,
          library: libraryCache,
          shared: shared,
          catalogVersions: sorted,
          activePlaybackId: activeOnHub ? active.playbackId : '',
          onVersionSelect: function (playbackId) {
            const activeSong = player.getActiveSong();
            if (activeSong && activeSong.playbackId === playbackId) return;
            const target = sorted.find(function (item) {
              return item.playbackId === playbackId;
            });
            if (target) playSongHubQueue(sorted, target);
          }
        });
      }
    }

    if (sortEl && !sortEl.dataset.bound) {
      sortEl.dataset.bound = '1';
      sortEl.addEventListener('change', paint);
    }
    paint();
    mountShareHub(catalogSong);
  }

  function renderSongPageContent(catalogSong) {
    const store = window.BurnfolderSongPageStore;
    const renderApi = window.BurnfolderSongPageRender;
    const mainEl = document.getElementById('songMain');
    if (!store || !renderApi || !mainEl || !versionsApi) return Promise.resolve();

    const groupKey = versionsApi.getTrackGroupKey(catalogSong.title);
    return store.resolvePage(groupKey, true).then(function (page) {
      currentSongPage = page;
      const baseTitle = versionsApi.getBaseTitle(
        versionsApi.collectVersionsByGroupKey(songCatalog, groupKey)
      );
      const matching = versionsApi.collectVersionsByGroupKey(songCatalog, groupKey);
      const sortMode = sortEl ? sortEl.value || 'newest' : 'newest';
      const sorted = versionsApi.sortVersions(matching, sortMode);
      const active = player ? player.getActiveSong() : null;
      const activeOnHub =
        active && sorted.some(function (item) {
          return item.playbackId === active.playbackId;
        });
      renderApi.apply(mainEl, {
        page: page,
        baseTitle: baseTitle,
        library: libraryCache,
        shared: shared,
        catalogVersions: sorted,
        activePlaybackId: activeOnHub ? active.playbackId : ''
      });
      if (designBtn) {
        designBtn.href = 'song-designer.html?song=' + encodeURIComponent(groupKey);
      }
    });
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

    if (deleteBtn) {
      deleteBtn.hidden = !item.muxAssetId;
    }

    if (main) main.hidden = false;

    return renderSongPageContent(catalogSong).then(function () {
      if (!videoHero) return;
      const store = window.BurnfolderSongPageStore;
      const groupKey = versionsApi.getTrackGroupKey(catalogSong.title);
      const checkPage = store
        ? store.getPage(groupKey).then(function (page) {
            return !!(page && page.heroVideoPlaybackId);
          })
        : Promise.resolve(false);
      return checkPage.then(function (hasPageHero) {
        if (hasPageHero) return;
        if (isVideo && item.playbackId) {
          shared.mountStreamVideo(item, videoHero, { autoplay: false });
        } else {
          shared.clearStreamVideo(videoHero);
        }
      });
    });
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
    const sortMode = sortEl ? sortEl.value || 'newest' : 'newest';
    if (item && versionsApi) {
      const catalogSong = catalogSongFromItem(item);
      const groupKey = versionsApi.getTrackGroupKey(catalogSong.title);
      const matching = versionsApi.collectVersionsByGroupKey(songCatalog, groupKey);
      const sorted = versionsApi.sortVersions(matching, sortMode);
      syncSongHubPlayButton(sorted);
    }
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
