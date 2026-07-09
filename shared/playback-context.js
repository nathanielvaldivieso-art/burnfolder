/**
 * Shared playback catalog + navigation for burnfolder.com and studio.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BurnfolderPlaybackContext = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const globalRef =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
        ? window
        : this;

  function isStudio() {
    const path = String(globalRef.location && globalRef.location.pathname ? globalRef.location.pathname : '');
    if (/\/studio\//i.test(path)) return true;
    const body = globalRef.document && globalRef.document.body;
    if (!body) return false;
    return (
      body.classList.contains('studio-editor-page') ||
      body.classList.contains('studio-stream-page') ||
      body.classList.contains('studio-song-page')
    );
  }

  function catalogProvider() {
    return globalRef.BurnfolderPlaybackCatalogProvider || null;
  }

  function labelForLibraryItem(item) {
    const prov = catalogProvider();
    if (prov && typeof prov.labelForItem === 'function') return prov.labelForItem(item);
    const mux = globalRef.BurnfolderStudioMux;
    if (mux && mux.muxFileLabel) return mux.muxFileLabel(item);
    return (
      (item && (item.muxCanonicalTitle || item.passthrough || item.displayTitle || item.title)) ||
      'untitled'
    );
  }

  function getLibrary() {
    const prov = catalogProvider();
    if (prov && typeof prov.getLibrary === 'function') return prov.getLibrary() || [];
    return [];
  }

  function mergedCatalog(extraSongs) {
    const prov = catalogProvider();
    if (prov && typeof prov.getCatalog === 'function') {
      const base = prov.getCatalog() || [];
      return mergeExtraSongs(base, extraSongs);
    }

    const sv = globalRef.BurnfolderSongVersions;
    const shared = globalRef.BurnfolderStreamShared;
    if (sv) {
      const lib = getLibrary();
      const catalog =
        shared && shared.buildStreamSongCatalog
          ? shared.buildStreamSongCatalog(lib)
          : sv.mergeSongCatalog(sv.getSiteCatalog(globalRef), lib, labelForLibraryItem);
      return mergeExtraSongs(catalog, extraSongs);
    }

    const site = Array.isArray(globalRef.allSongs) ? globalRef.allSongs.slice() : [];
    return mergeExtraSongs(site, extraSongs);
  }

  function mergeExtraSongs(catalog, extraSongs) {
    const byId = new Map();
    (catalog || []).forEach(function (row) {
      if (row && row.playbackId) byId.set(row.playbackId, row);
    });
    (extraSongs || []).forEach(function (song) {
      if (!song || !song.playbackId) return;
      if (!byId.has(song.playbackId)) {
        byId.set(song.playbackId, Object.assign({}, song));
      }
    });
    return Array.from(byId.values());
  }

  function resolveSongPage(song) {
    if (!song) return '';
    let page = song.page != null ? String(song.page).trim() : '';
    if (!page || !/^\d+\.\d+\.\d+$/.test(page)) {
      const hit = (globalRef.allSongs || []).find(function (row) {
        return row && row.playbackId === song.playbackId;
      });
      if (hit && hit.page) page = String(hit.page).trim();
    }
    return /^\d+\.\d+\.\d+$/.test(page) ? page : '';
  }

  function songHubHref(song) {
    const sv = globalRef.BurnfolderSongVersions;
    if (!song) return isStudio() ? 'stream-song.html' : 'song.html';
    if (isStudio() && sv) return sv.getStreamSongHref(song, song.playbackId);
    if (sv) return sv.getSongHubHref(song, '');
    return 'song.html?song=' + encodeURIComponent(String(song.title || '').toLowerCase());
  }

  function entryHref(song) {
    if (!song) return '';
    const page = resolveSongPage(song);
    const shared = globalRef.BurnfolderStreamShared;

    if (isStudio()) {
      if (page) return '../' + page + '.html';
      if (shared && shared.editorHrefSingle) return shared.editorHrefSingle(song);
      return 'index.html';
    }

    if (!page) return '';
    return page + '.html';
  }

  function albumIdFromTitle(title) {
    return String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function resolveAlbumIdForSong(song) {
    if (!song) return '';

    const playbackId = String(song.playbackId || '').trim();
    const pages = globalRef.burnfolderAlbumPages || {};
    const pageIds = Object.keys(pages);

    if (playbackId) {
      for (let i = 0; i < pageIds.length; i += 1) {
        const id = pageIds[i];
        const page = pages[id];
        const tracks = Array.isArray(page && page.tracks) ? page.tracks : [];
        if (
          tracks.some(function (track) {
            return track && track.playbackId === playbackId;
          })
        ) {
          return id;
        }
      }
    }

    const albumTitle = song.album ? String(song.album).trim() : '';
    if (albumTitle) {
      for (let i = 0; i < pageIds.length; i += 1) {
        const id = pageIds[i];
        const page = pages[id];
        if (page && String(page.title || '').trim() === albumTitle) return id;
      }
      const slug = albumIdFromTitle(albumTitle);
      if (slug && pages[slug]) return slug;
    }

    const shared = globalRef.BurnfolderStreamShared;
    if (shared && shared.findGroupForTrack && playbackId) {
      const group = shared.findGroupForTrack(playbackId);
      if (group && group.id) return group.id;
    }

    const featured = globalRef.musicFeaturedRelease || {};
    const featuredTitle = featured.albumTitle ? String(featured.albumTitle).trim() : '';
    if (featuredTitle && (albumTitle === featuredTitle || playbackId)) {
      for (let i = 0; i < pageIds.length; i += 1) {
        const id = pageIds[i];
        const page = pages[id];
        if (page && String(page.title || '').trim() === featuredTitle) return id;
      }
      const featuredSlug = albumIdFromTitle(featuredTitle);
      if (featuredSlug && pages[featuredSlug]) return featuredSlug;
      if (albumTitle === featuredTitle && featuredSlug) return featuredSlug;
    }

    return '';
  }

  function albumHubHref(song) {
    const albumId = resolveAlbumIdForSong(song);
    if (!albumId) return '';

    if (isStudio()) {
      const shared = globalRef.BurnfolderStreamShared;
      if (shared && shared.albumDesignerUrl) return shared.albumDesignerUrl(albumId);
      return 'album-designer.html?album=' + encodeURIComponent(albumId);
    }

    return 'album.html?album=' + encodeURIComponent(albumId);
  }

  function versionsForActive(activeSong, extraSongs) {
    if (!activeSong || !activeSong.playbackId) return [];
    const sv = globalRef.BurnfolderSongVersions;
    const catalog = mergedCatalog(extraSongs);

    if (sv) {
      const versions = sv.getVersionsForReference(catalog, activeSong, 'newest');
      if (versions.length) return versions;
    }

    const keyFn = sv ? sv.getTrackGroupKey.bind(sv) : function (t) {
      return String(t || '').toLowerCase();
    };
    const groupKey = activeSong.title ? keyFn(activeSong.title) : '';
    return catalog.filter(function (row) {
      return row && row.title && keyFn(row.title) === groupKey;
    });
  }

  function displayTitleForPlayback(song, extraSongs) {
    const sv = globalRef.BurnfolderSongVersions;
    if (!sv || !song) return song && song.title ? song.title : '';
    return sv.displayTitleForSongInCatalog(mergedCatalog(extraSongs), song);
  }

  function setCatalogProvider(provider) {
    globalRef.BurnfolderPlaybackCatalogProvider = provider || null;
  }

  return {
    isStudio: isStudio,
    setCatalogProvider: setCatalogProvider,
    getLibrary: getLibrary,
    mergedCatalog: mergedCatalog,
    versionsForActive: versionsForActive,
    songHubHref: songHubHref,
    entryHref: entryHref,
    resolveAlbumIdForSong: resolveAlbumIdForSong,
    albumHubHref: albumHubHref,
    displayTitleForPlayback: displayTitleForPlayback,
    labelForLibraryItem: labelForLibraryItem
  };
});
