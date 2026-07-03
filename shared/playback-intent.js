/**
 * Playback intent — explicit queue scope so one song never advances into another.
 *
 * Rules:
 * - Default play is SINGLE (one track, no auto-advance).
 * - Multi-track advance requires an explicit scope: page, album, song-hub, or explicit queue.
 * - Recall stores scope; restore is rejected when the current route conflicts.
 * - Row playback ids are pinned; version swaps cannot cross song group keys.
 */
(function (root) {
  'use strict';

  const versionsApi = root.BurnfolderSongVersions;

  function getTrackGroupKey(title) {
    if (versionsApi && versionsApi.getTrackGroupKey) {
      return versionsApi.getTrackGroupKey(title);
    }
    return String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function normalizeSong(song) {
    if (!song || !song.playbackId) return null;
    const title = String(song.title || song.displayTitle || 'untitled').trim();
    return {
      title: title,
      playbackId: String(song.playbackId).trim(),
      groupKey: getTrackGroupKey(title),
      page: song.page ? String(song.page) : '',
      album: song.album ? String(song.album) : '',
      coverArt: song.coverArt || null
    };
  }

  function normalizeQueue(queue) {
    return (queue || []).map(normalizeSong).filter(Boolean);
  }

  function dedupeQueue(queue) {
    const seen = new Set();
    return queue.filter(function (song) {
      if (seen.has(song.playbackId)) return false;
      seen.add(song.playbackId);
      return true;
    });
  }

  function makeScope(type, meta) {
    return Object.assign({ type: type }, meta || {});
  }

  function scopeSingle(song) {
    const normalized = normalizeSong(song);
    if (!normalized) return makeScope('single', {});
    return makeScope('single', {
      playbackId: normalized.playbackId,
      groupKey: normalized.groupKey
    });
  }

  function scopePage(pageKey) {
    return makeScope('page', { pageKey: String(pageKey || '') });
  }

  function scopeAlbum(albumTitle, groupKey) {
    return makeScope('album', {
      albumTitle: String(albumTitle || ''),
      groupKey: groupKey || getTrackGroupKey(albumTitle)
    });
  }

  function scopeSongHub(groupKey) {
    return makeScope('song-hub', { groupKey: String(groupKey || '') });
  }

  function scopeExplicit(source) {
    return makeScope('explicit', { source: source || 'queue' });
  }

  function getPageKey() {
    const path = root.location && root.location.pathname ? root.location.pathname : '';
    const parts = path.split('/');
    return parts[parts.length - 1].replace('.html', '') || 'index';
  }

  function isBoundedPageScope(pageKey) {
    const key = pageKey || getPageKey();
    const unbounded = new Set([
      'index',
      'shop',
      'cart',
      'checkout',
      'cancel',
      'success',
      'music',
      'archive',
      'song',
      'content',
      'listen'
    ]);
    if (unbounded.has(key)) return false;
    const byPage = root.songsByPage || {};
    return Array.isArray(byPage[key]) && byPage[key].length > 0;
  }

  function songMatchesScope(song, scope) {
    if (!scope || !song) return true;
    const normalized = normalizeSong(song);
    if (!normalized) return false;

    switch (scope.type) {
      case 'single':
        return normalized.playbackId === scope.playbackId;
      case 'page':
        if (!scope.pageKey) return true;
        return normalized.page === scope.pageKey;
      case 'album':
        if (!scope.albumTitle) return true;
        return normalized.album === scope.albumTitle;
      case 'song-hub':
        if (!scope.groupKey) return true;
        return normalized.groupKey === scope.groupKey;
      case 'explicit':
        return true;
      default:
        return true;
    }
  }

  function filterQueueToScope(queue, scope) {
    if (!scope || scope.type === 'explicit') return queue;
    return queue.filter(function (song) {
      return songMatchesScope(song, scope);
    });
  }

  function buildPlaybackPlan(song, queueSongs, queueIdx, options) {
    const opts = options || {};
    const normalized = normalizeSong(song);
    if (!normalized) return null;

    let scope = opts.scope || null;
    let queue = normalizeQueue(queueSongs);
    let idx = typeof queueIdx === 'number' ? queueIdx : 0;

    if (!scope) {
      if (opts.queueScope === 'page' && isBoundedPageScope(opts.pageKey || getPageKey())) {
        scope = scopePage(opts.pageKey || getPageKey());
      } else if (opts.queueScope === 'album') {
        scope = scopeAlbum(opts.albumTitle || normalized.album, opts.groupKey);
      } else if (opts.queueScope === 'song-hub' && opts.groupKey) {
        scope = scopeSongHub(opts.groupKey);
      } else if (opts.queueScope === 'explicit' && queue.length > 1) {
        scope = scopeExplicit(opts.source || 'queue');
      } else if (opts.allowQueueAdvance && queue.length > 1) {
        scope = scopeExplicit(opts.source || 'queue');
      } else {
        scope = scopeSingle(normalized);
      }
    }

    if (scope.type === 'single') {
      queue = [normalized];
      idx = 0;
    } else {
      if (!queue.length) queue = [normalized];
      queue = dedupeQueue(queue);
      if (scope.type === 'page' && scope.pageKey) {
        queue = queue.map(function (row) {
          if (row.page) return row;
          return Object.assign({}, row, { page: scope.pageKey });
        });
        if (!normalized.page) {
          normalized = Object.assign({}, normalized, { page: scope.pageKey });
        }
      }
      queue = filterQueueToScope(queue, scope);
      if (!queue.some(function (row) {
        return row.playbackId === normalized.playbackId;
      })) {
        queue = [normalized].concat(queue);
      }
      if (scope.type === 'song-hub' && scope.groupKey) {
        queue = queue.filter(function (row) {
          return row.groupKey === scope.groupKey;
        });
        if (!queue.length) queue = [normalized];
      }
      if (idx < 0 || idx >= queue.length) {
        idx = queue.findIndex(function (row) {
          return row.playbackId === normalized.playbackId;
        });
        if (idx < 0) idx = 0;
      }
      if (!queue.length) {
        scope = scopeSingle(normalized);
        queue = [normalized];
        idx = 0;
      }
    }

    return {
      song: queue[idx] || normalized,
      queue: queue,
      queueIdx: idx,
      scope: scope,
      allowAdvance: scope.type !== 'single' && queue.length > 1
    };
  }

  function canAdvanceTo(scope, nextSong, queue) {
    if (!scope || scope.type === 'single') return false;
    if (!nextSong || !queue || !queue.length) return false;
    const normalized = normalizeSong(nextSong);
    if (!normalized) return false;
    if (!songMatchesScope(normalized, scope)) return false;
    return queue.some(function (row) {
      return row.playbackId === normalized.playbackId;
    });
  }

  function isRecallCompatible(recall, context) {
    if (!recall || !recall.scope) return true;
    const ctx = context || {};
    if (ctx.forceRecall === true) return true;

    const body = root.document && root.document.body;
    if (body && body.classList.contains('studio-page')) {
      if (recall.scope.type === 'album' || recall.scope.type === 'page') {
        return false;
      }
    }

    const pageKey = ctx.pageKey || getPageKey();
    if (recall.scope.type === 'page' && recall.scope.pageKey && recall.scope.pageKey !== pageKey) {
      return false;
    }
    if (recall.scope.type === 'album' && ctx.rejectAlbumRecall) {
      return false;
    }
    if (ctx.groupKey && recall.scope.type === 'song-hub' && recall.scope.groupKey !== ctx.groupKey) {
      return false;
    }
    if (recall.scope.type === 'single' && ctx.requestedPlaybackId) {
      return recall.scope.playbackId === ctx.requestedPlaybackId;
    }
    return true;
  }

  function pinRowPlayback(rowItem, resolvedItem, catalogSong) {
    if (!rowItem || !rowItem.playbackId) return resolvedItem || rowItem;
    const resolved = resolvedItem || rowItem;
    if (resolved.playbackId === rowItem.playbackId) return resolved;

    const rowTitle =
      (catalogSong && catalogSong.title) ||
      rowItem.displayTitle ||
      rowItem.passthrough ||
      rowItem.muxCanonicalTitle ||
      '';
    const resolvedTitle = resolved.title || resolved.displayTitle || '';
    const rowKey = getTrackGroupKey(rowTitle);
    const resolvedKey = getTrackGroupKey(resolvedTitle);

    if (rowKey && resolvedKey && rowKey !== resolvedKey) {
      if (root.console && typeof root.console.warn === 'function') {
        root.console.warn(
          '[playback-intent] blocked cross-song version swap:',
          rowKey,
          '→',
          resolvedKey,
          '(' + rowItem.playbackId + ' vs ' + resolved.playbackId + ')'
        );
      }
      return rowItem;
    }
    return resolved;
  }

  function reconcileNavigation(pageKey, activeSong, activeQueue, activeScope) {
    if (!activeSong || !activeScope) {
      return { queue: activeQueue, scope: activeScope, changed: false };
    }
    const key = pageKey || getPageKey();
    if (activeScope.type === 'page' && activeScope.pageKey && activeScope.pageKey !== key) {
      return {
        queue: [normalizeSong(activeSong)],
        scope: scopeSingle(activeSong),
        changed: true
      };
    }
    if (activeScope.type === 'album') {
      return {
        queue: [normalizeSong(activeSong)],
        scope: scopeSingle(activeSong),
        changed: true
      };
    }
    return { queue: activeQueue, scope: activeScope, changed: false };
  }

  root.BurnfolderPlaybackIntent = {
    normalizeSong: normalizeSong,
    normalizeQueue: normalizeQueue,
    getTrackGroupKey: getTrackGroupKey,
    getPageKey: getPageKey,
    isBoundedPageScope: isBoundedPageScope,
    scopeSingle: scopeSingle,
    scopePage: scopePage,
    scopeAlbum: scopeAlbum,
    scopeSongHub: scopeSongHub,
    scopeExplicit: scopeExplicit,
    buildPlaybackPlan: buildPlaybackPlan,
    songMatchesScope: songMatchesScope,
    canAdvanceTo: canAdvanceTo,
    isRecallCompatible: isRecallCompatible,
    pinRowPlayback: pinRowPlayback,
    reconcileNavigation: reconcileNavigation
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
