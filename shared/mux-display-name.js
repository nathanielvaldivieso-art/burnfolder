/**
 * Burnfolder Mux display name resolution.
 * One priority chain for server (Netlify) and browser (studio).
 *
 * Mux upload name (passthrough / filename) is the canonical *display* spelling.
 * Site catalog titles are fallback only when mux names are generic or missing.
 *
 * Mux sources (first match wins for display):
 *  1. asset.passthrough on the Mux asset
 *  2. upload new_asset_settings.passthrough (by asset id)
 *  3. input_info original filename on the asset
 *  4. local studio registry (IndexedDB) by asset / playback id
 *  5. published site catalog (songs / entries) by playback id
 *  6. single-asset Mux API fetch (server only)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BurnfolderMuxDisplayName = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const globalRef =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
        ? window
        : this;

  const GENERIC_RE = /^(untitled|file|unknown|audio|video)([-_\s]|$)/i;
  const ASSET_ID_FALLBACK_RE = /^asset-[a-zA-Z0-9]{4,}$/;

  function sanitizeFileName(name) {
    return String(name || 'file')
      .trim()
      .replace(/[^\w.\-()+ ]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200) || 'file';
  }

  function isGenericMuxLabel(name) {
    const n = String(name || '').trim();
    if (!n) return true;
    if (ASSET_ID_FALLBACK_RE.test(n)) return true;
    if (GENERIC_RE.test(n)) return true;
    return false;
  }

  function displayTitleFromFileName(fileName) {
    const safe = sanitizeFileName(fileName);
    const dot = safe.lastIndexOf('.');
    return dot > 0 ? safe.slice(0, dot) : safe;
  }

  function filenameFromUrl(url) {
    try {
      const parts = String(url).split('/');
      const last = parts[parts.length - 1];
      if (!last) return '';
      return decodeURIComponent(last.split('?')[0]).trim();
    } catch (e) {
      return '';
    }
  }

  function filenameFromInputInfo(row) {
    const info = row && row.input_info;
    if (!Array.isArray(info)) return '';

    for (let i = 0; i < info.length; i += 1) {
      const item = info[i];
      if (!item) continue;

      const file = item.file || {};
      if (file.name) return String(file.name).trim();
      if (file.filename) return String(file.filename).trim();

      const settings = item.settings || {};
      if (settings.file_name) return String(settings.file_name).trim();
      if (settings.name) return String(settings.name).trim();
      if (settings.passthrough && !isGenericMuxLabel(settings.passthrough)) {
        return String(settings.passthrough).trim();
      }
      if (settings.url) {
        const fromUrl = filenameFromUrl(settings.url);
        if (fromUrl) return fromUrl;
      }
    }

    return '';
  }

  function passthroughFromUpload(upload) {
    if (!upload) return '';
    const settings = upload.new_asset_settings || {};
    return String(
      upload.passthrough || settings.passthrough || (settings.meta && settings.meta.title) || ''
    ).trim();
  }

  function pickCandidate(raw, source) {
    const value = String(raw || '').trim();
    if (!value || isGenericMuxLabel(value)) return null;
    return {
      muxFileName: sanitizeFileName(value),
      displayTitle: displayTitleFromFileName(value),
      passthrough: value,
      nameSource: source
    };
  }

  function buildUploadMaps(uploads) {
    const byAssetId = new Map();
    (uploads || []).forEach(function (upload) {
      const assetId = upload && upload.asset_id;
      const name = passthroughFromUpload(upload);
      if (assetId && name) byAssetId.set(assetId, name);
    });
    return { byAssetId: byAssetId };
  }

  /**
   * @param {object} row Mux asset row (list or detail)
   * @param {object} ctx optional maps: uploadByAssetId, localByAssetId, localByPlaybackId, siteByPlaybackId
   */
  function resolveMuxAssetName(row, ctx) {
    const context = ctx || {};
    const playbackId = row && row.playbackId ? String(row.playbackId) : '';
    const assetId = row && (row.muxAssetId || row.id) ? String(row.muxAssetId || row.id) : '';

    const uploadMap = context.uploadByAssetId || new Map();
    const localAsset = context.localByAssetId || new Map();
    const localPlayback = context.localByPlaybackId || new Map();
    const siteMap = context.siteByPlaybackId || new Map();

    const chain = [
      function () {
        return pickCandidate(row && row.passthrough, 'mux-asset');
      },
      function () {
        return pickCandidate(uploadMap.get(assetId), 'mux-upload');
      },
      function () {
        return pickCandidate(filenameFromInputInfo(row), 'mux-input');
      },
      function () {
        return pickCandidate(localAsset.get(assetId), 'local-asset');
      },
      function () {
        return pickCandidate(localPlayback.get(playbackId), 'local-playback');
      },
      function () {
        return pickCandidate(siteMap.get(playbackId), 'site');
      },
      function () {
        return pickCandidate(context.detailPassthrough, 'mux-detail');
      }
    ];

    for (let i = 0; i < chain.length; i += 1) {
      const hit = chain[i]();
      if (hit) return hit;
    }

    const inputName = filenameFromInputInfo(row);
    const fallbackTitle = inputName
      ? displayTitleFromFileName(inputName)
      : assetId
        ? 'untitled ' + assetId.slice(-6)
        : 'untitled';

    return {
      muxFileName: inputName ? sanitizeFileName(inputName) : fallbackTitle,
      displayTitle: fallbackTitle,
      passthrough: '',
      nameSource: 'fallback'
    };
  }

  /** Trim + date-year normalization only; preserve spaces and spelling from mux. */
  function formatMuxDisplayTitle(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    const sv = globalRef.BurnfolderSongVersions;
    if (sv && sv.normalizeTrackTitle) return sv.normalizeTrackTitle(trimmed);
    return trimmed;
  }

  /** Resolve name using mux sources only (no site catalog). */
  function resolveMuxOnlyAssetName(row, ctx) {
    const context = Object.assign({}, ctx || {}, { siteByPlaybackId: new Map() });
    return resolveMuxAssetName(row, context);
  }

  /**
   * Label shown in stream, player, and tracklists.
   * Mux passthrough wins; site catalog used only when mux is generic/missing.
   */
  function preferredDisplayTitle(item, ctx) {
    if (!item) return 'untitled';

    if (item.muxCanonicalTitle) return formatMuxDisplayTitle(item.muxCanonicalTitle);

    const context = ctx || {};
    const playbackId = item.playbackId ? String(item.playbackId) : '';
    const resolved = resolveMuxOnlyAssetName(
      {
        id: item.muxAssetId,
        muxAssetId: item.muxAssetId,
        playbackId: playbackId,
        passthrough: item.passthrough,
        input_info: item.input_info
      },
      context
    );

    const muxRaw = String(resolved.passthrough || item.passthrough || '').trim();
    if (muxRaw && !isGenericMuxLabel(muxRaw)) return formatMuxDisplayTitle(muxRaw);

    const siteMap = context.siteByPlaybackId || new Map();
    const siteTitle = item.siteTitle || siteMap.get(playbackId);
    if (siteTitle && !isGenericMuxLabel(siteTitle)) return formatMuxDisplayTitle(siteTitle);

    if (item.displayTitle && !isGenericMuxLabel(item.displayTitle)) {
      return formatMuxDisplayTitle(item.displayTitle);
    }

    return formatMuxDisplayTitle(resolved.displayTitle || muxRaw || 'untitled');
  }

  function attachMuxCanonicalFields(item, ctx) {
    if (!item) return item;
    const canonical = preferredDisplayTitle(item, ctx);
    return Object.assign({}, item, {
      muxCanonicalTitle: canonical,
      muxDisplayTitle: canonical,
      displayTitle: canonical
    });
  }

  function applyResolvedName(item, resolved) {
    if (!item || !resolved) return item;
    const passthrough = resolved.passthrough || resolved.muxFileName;
    const canonical = formatMuxDisplayTitle(passthrough || resolved.displayTitle);
    return Object.assign({}, item, {
      passthrough: passthrough,
      muxCanonicalTitle: canonical,
      muxDisplayTitle: canonical,
      displayTitle: resolved.displayTitle,
      muxFileName: resolved.muxFileName,
      nameSource: resolved.nameSource
    });
  }

  function buildSitePlaybackTitleMap(windowRef) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const map = new Map();
    if (!win) return map;

    function add(title, playbackId) {
      const t = String(title || '').trim();
      const id = String(playbackId || '').trim();
      if (!t || !id || map.has(id)) return;
      map.set(id, t);
    }

    if (win.entryDataByDate) {
      Object.values(win.entryDataByDate).forEach(function (entry) {
        (entry.blocks || []).forEach(function (block) {
          if ((block.type === 'audio' || block.type === 'video') && block.title && block.playbackId) {
            add(block.title, block.playbackId);
          }
          if (block.type === 'playlist' && Array.isArray(block.tracks)) {
            block.tracks.forEach(function (track) {
              if (track.title && track.playbackId) add(track.title, track.playbackId);
            });
          }
          if (block.type === 'album' && Array.isArray(block.tracks)) {
            block.tracks.forEach(function (track) {
              if (track.title && track.playbackId) add(track.title, track.playbackId);
            });
          }
        });
      });
    }

    if (win.songsByPage) {
      Object.values(win.songsByPage).forEach(function (tracks) {
        (tracks || []).forEach(function (track) {
          if (track.title && track.playbackId) add(track.title, track.playbackId);
        });
      });
    }

    if (Array.isArray(win.allSongs)) {
      win.allSongs.forEach(function (track) {
        if (track.title && track.playbackId) add(track.title, track.playbackId);
      });
    }

    return map;
  }

  function buildLocalNameMaps(localAssets) {
    const byAssetId = new Map();
    const byPlaybackId = new Map();

    (localAssets || []).forEach(function (row) {
      const playbackId = String(row.muxPlaybackId || '').trim();
      const assetId = String(row.muxAssetId || '').trim();
      const names = [row.muxPassthrough, row.name, row.displayTitle].filter(Boolean);

      names.forEach(function (raw) {
        if (isGenericMuxLabel(raw)) return;
        const safe = sanitizeFileName(raw);
        if (assetId && !byAssetId.has(assetId)) byAssetId.set(assetId, safe);
        if (playbackId && !byPlaybackId.has(playbackId)) byPlaybackId.set(playbackId, safe);
      });
    });

    return { byAssetId: byAssetId, byPlaybackId: byPlaybackId };
  }

  function enrichLibraryItems(items, ctx) {
    const context = ctx || {};
    return (items || []).map(function (item) {
      const resolved = resolveMuxAssetName(
        {
          id: item.muxAssetId,
          muxAssetId: item.muxAssetId,
          playbackId: item.playbackId,
          passthrough: item.passthrough,
          input_info: item.input_info
        },
        context
      );
      return attachMuxCanonicalFields(applyResolvedName(item, resolved), context);
    });
  }

  function formatMuxDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return {
    sanitizeFileName: sanitizeFileName,
    isGenericMuxLabel: isGenericMuxLabel,
    formatMuxDisplayTitle: formatMuxDisplayTitle,
    preferredDisplayTitle: preferredDisplayTitle,
    resolveMuxOnlyAssetName: resolveMuxOnlyAssetName,
    attachMuxCanonicalFields: attachMuxCanonicalFields,
    displayTitleFromFileName: displayTitleFromFileName,
    filenameFromInputInfo: filenameFromInputInfo,
    passthroughFromUpload: passthroughFromUpload,
    buildUploadMaps: buildUploadMaps,
    resolveMuxAssetName: resolveMuxAssetName,
    applyResolvedName: applyResolvedName,
    buildSitePlaybackTitleMap: buildSitePlaybackTitleMap,
    buildLocalNameMaps: buildLocalNameMaps,
    enrichLibraryItems: enrichLibraryItems,
    formatMuxDate: formatMuxDate
  };
});
