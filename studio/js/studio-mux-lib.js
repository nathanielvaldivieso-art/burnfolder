(function () {
  'use strict';

  const naming = window.BurnfolderMuxDisplayName;
  const legacyNaming = window.BurnfolderMuxNaming;

  function siteTitleMap() {
    return naming ? naming.buildSitePlaybackTitleMap(window) : new Map();
  }

  function formatSiteTitle(siteTitle) {
    if (!siteTitle) return '';
    return window.BurnfolderSongVersions && window.BurnfolderSongVersions.normalizeTrackTitle
      ? window.BurnfolderSongVersions.normalizeTrackTitle(siteTitle)
      : siteTitle;
  }

  /** Attach published site titles without overwriting mux passthrough / display names. */
  function enrichMuxLibraryFromSite(assets) {
    if (!naming) return assets || [];

    const site = siteTitleMap();

    return (assets || []).map(function (item) {
      const siteTitle = site.get(item.playbackId);
      if (!siteTitle) return naming.attachMuxCanonicalFields(item, { siteByPlaybackId: site });

      return naming.attachMuxCanonicalFields(
        Object.assign({}, item, {
          siteTitle: formatSiteTitle(siteTitle)
        }),
        { siteByPlaybackId: site }
      );
    });
  }

  function cloudAssetToLibraryItem(row) {
    if (!row || !row.muxPlaybackId) return null;
    const passthrough = row.muxPassthrough || row.name || 'untitled';
    const safeName = naming ? naming.sanitizeFileName(passthrough) : passthrough;
    const item = {
      muxAssetId: row.muxAssetId || null,
      playbackId: row.muxPlaybackId,
      passthrough: passthrough,
      displayTitle: naming
        ? naming.displayTitleFromFileName(safeName)
        : row.displayTitle || passthrough,
      muxFileName: safeName,
      kind: row.kind === 'video' ? 'video' : 'audio',
      hasVideoTrack: row.kind === 'video',
      songGroupKey: String(row.songGroupKey || '').trim(),
      songTitle: String(row.songTitle || '').trim(),
      duration: null,
      aspectRatio: null,
      createdAt: row.createdAt || new Date().toISOString(),
      nameSource: 'local-upload'
    };
    return naming ? naming.attachMuxCanonicalFields(item) : item;
  }

  function mergeServerAndLocalLibrary(serverAssets, localRows) {
    const byPlayback = new Map();
    (serverAssets || []).forEach(function (item) {
      if (item && item.playbackId) byPlayback.set(item.playbackId, item);
    });
    (localRows || []).forEach(function (row) {
      const item = cloudAssetToLibraryItem(row);
      if (item && !byPlayback.has(item.playbackId)) {
        byPlayback.set(item.playbackId, item);
      }
    });
    return Array.from(byPlayback.values()).sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  function enrichFromLocalCloud(assets) {
    if (!naming || !window.BurnfolderAssetCloud || !window.BurnfolderAssetCloud.listAssets) {
      return Promise.resolve(assets || []);
    }

    return window.BurnfolderAssetCloud.listAssets().then(function (localRows) {
      const merged = mergeServerAndLocalLibrary(assets, localRows);
      const localMaps = naming.buildLocalNameMaps(localRows);
      const siteMap = siteTitleMap();

      return naming.enrichLibraryItems(merged, {
        localByAssetId: localMaps.byAssetId,
        localByPlaybackId: localMaps.byPlaybackId,
        siteByPlaybackId: siteMap
      });
    });
  }

  function muxFileLabel(item) {
    if (!item) return 'untitled';
    const ctx = { siteByPlaybackId: siteTitleMap() };
    if (naming && naming.preferredDisplayTitle) {
      return naming.preferredDisplayTitle(item, ctx);
    }
    if (legacyNaming && legacyNaming.muxFileLabel) return legacyNaming.muxFileLabel(item);
    return item.muxCanonicalTitle || item.passthrough || item.displayTitle || 'untitled';
  }

  function findMuxItem(cache, id) {
    return (cache || []).find(function (item) {
      return item.muxAssetId === id || item.playbackId === id;
    });
  }

  function listMuxLibrary() {
    if (!window.BurnfolderMux || !window.BurnfolderMux.listMuxAssets) {
      return Promise.reject(new Error('mux unavailable — run netlify dev'));
    }
    return window.BurnfolderMux.listMuxAssets()
      .then(function (assets) {
        let list = enrichMuxLibraryFromSite(assets);
        return enrichFromLocalCloud(list);
      })
      .then(function (list) {
        if (window.BurnfolderStreamShared && window.BurnfolderStreamShared.normalizeLibrary) {
          return window.BurnfolderStreamShared.normalizeLibrary(list);
        }
        return list;
      })
      .then(function (list) {
        const clipNaming = window.BurnfolderSongClipNaming;
        const versionsApi = window.BurnfolderSongVersions;
        if (!clipNaming || !versionsApi) return list;
        return (list || []).map(function (item) {
          if (!item || item.kind !== 'video' || item.songGroupKey) return item;
          const key = clipNaming.inferSongGroupKey(
            item.passthrough || item.muxFileName || item.displayTitle,
            versionsApi
          );
          if (!key) return item;
          const songTitle = String(item.passthrough || '').split(clipNaming.CLIP_SEP)[0].trim();
          return Object.assign({}, item, {
            songGroupKey: key,
            songTitle: item.songTitle || songTitle
          });
        });
      });
  }

  function libraryItemFromCloudAsset(asset) {
    return cloudAssetToLibraryItem(asset);
  }

  function muxThumbnailUrl(playbackId) {
    if (!playbackId) return '';
    return 'https://image.mux.com/' + playbackId + '/thumbnail.webp?time=1';
  }

  window.BurnfolderStudioMux = {
    enrichMuxLibraryFromSite: enrichMuxLibraryFromSite,
    cloudAssetToLibraryItem: cloudAssetToLibraryItem,
    libraryItemFromCloudAsset: libraryItemFromCloudAsset,
    muxFileLabel: muxFileLabel,
    findMuxItem: findMuxItem,
    listMuxLibrary: listMuxLibrary,
    muxThumbnailUrl: muxThumbnailUrl
  };
})();
