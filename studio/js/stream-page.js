(function () {
  'use strict';

  let listRoot = document.getElementById('streamList');
  let videoStage = document.getElementById('streamVideoStage');
  let filterRoot = document.getElementById('streamFilters');
  let statusEl = document.getElementById('streamStatus');
  let uploadRoot = document.getElementById('streamUpload');
  let countEl = document.getElementById('streamCount');

  function showBlocker(message) {
    if (listRoot) {
      listRoot.innerHTML =
        '<p class="studio-stream-fatal">' +
        message +
        ' <a href="' +
        location.pathname +
        '">reload stream</a></p>';
    }
    if (statusEl) statusEl.textContent = message;
  }

  const shared = window.BurnfolderStreamShared;
  if (!shared) {
    showBlocker('stream is out of date — hard refresh (Cmd+Shift+R)');
    return;
  }

  const muxLib = window.BurnfolderStudioMux;
  const player = window.BurnfolderStreamPlayer;
  const versionsApi = window.BurnfolderSongVersions;

  let libraryCache = [];
  let streamVersionCycle = null;
  let expandedVideoId = null;
  let albumExpanded = {};

  function isAlbumExpanded(groupId) {
    return albumExpanded[groupId] !== false;
  }

  function setAlbumExpanded(groupId, expanded) {
    albumExpanded[groupId] = expanded;
  }

  function streamMode() {
    const mode = document.body && document.body.dataset.streamMode;
    return mode === 'video' ? 'video' : 'audio';
  }

  function isVideoPage() {
    return streamMode() === 'video';
  }

  function isAudioPage() {
    return !isVideoPage();
  }

  function syncActiveFilter() {
    return streamMode();
  }

  function countLabel(n) {
    const num = typeof n === 'number' ? n : 0;
    if (isVideoPage()) return num + (num === 1 ? ' video' : ' videos');
    return num + (num === 1 ? ' song' : ' songs');
  }

  function setStatus(msg, kind) {
    if (window.BurnfolderStudioStatus) {
      window.BurnfolderStudioStatus.set(statusEl, msg, kind);
      return;
    }
    if (statusEl) statusEl.textContent = msg || '';
  }

  function openUploadDetails() {
    const details =
      document.getElementById('streamUploadDetails') ||
      document.querySelector('.studio-stream-upload-details');
    if (details) details.open = true;
  }

  function syncUploadDetailsOpen() {
    const details = document.querySelector('.studio-stream-upload-details');
    if (details && !libraryCache.length) details.open = true;
  }

  function itemLabel(item) {
    return shared.muxFileLabel(item);
  }

  const PLAY_LOG_KEY = 'burnfolderStreamPlayLog';

  function loadPlayLog() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(PLAY_LOG_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function recordPlay(playbackId) {
    if (!playbackId) return;
    const log = loadPlayLog();
    log[playbackId] = Date.now();
    try {
      window.localStorage.setItem(PLAY_LOG_KEY, JSON.stringify(log));
    } catch (e) {
      /* ignore quota */
    }
  }

  function playRecency(item) {
    if (!item) return 0;
    const log = loadPlayLog();
    let best = 0;
    if (!versionsApi) {
      return log[item.playbackId] || 0;
    }
    const catalog = streamVersionCatalog();
    const versions = versionsApi.getVersionsForReference(catalog, catalogSongFromItem(item), 'newest');
    (versions.length ? versions : [catalogSongFromItem(item)]).forEach(function (song) {
      const id = song && song.playbackId;
      if (id && log[id] && log[id] > best) best = log[id];
    });
    return best;
  }

  function resolveStackTrackItem(track) {
    if (!track || !track.playbackId) return track;
    const libItem = shared.findInLibrary(libraryCache, track.playbackId) || track;
    if (!versionsApi) return libItem;
    const catalog = streamVersionCatalog();
    const newest = versionsApi.resolveNewestSongInCatalog(
      catalog,
      catalogSongFromItem(libItem),
      itemLabel
    );
    if (!newest || !newest.playbackId) return libItem;
    return shared.findInLibrary(libraryCache, newest.playbackId) || libraryItemFromSong(newest, libItem);
  }

  /** When a newer dated version lands in Mux, swap project slots to it in place. */
  function upgradeProjectTracksToNewest() {
    if (!versionsApi) return false;
    const groups = shared.loadGroups();
    if (!groups.length) return false;

    let changed = false;
    const nextGroups = groups.map(function (group) {
      const nextTracks = [];

      group.tracks.forEach(function (track) {
        const resolved = resolveStackTrackItem(track);
        if (!resolved || !resolved.playbackId) {
          nextTracks.push(track);
          return;
        }

        const upgraded = shared.stackItemFromLibrary(resolved);
        if (
          track.playbackId !== upgraded.playbackId ||
          track.title !== upgraded.title
        ) {
          changed = true;
        }
        nextTracks.push(upgraded);
      });

      return {
        id: group.id,
        meta: group.meta,
        tracks: nextTracks
      };
    }).filter(function (group) {
      return group.tracks.length > 0;
    });

    if (changed) {
      shared.saveGroups(nextGroups);
    }
    return changed;
  }

  function groupKeyForItem(item) {
    if (!item) return '';
    if (!versionsApi) return item.playbackId || '';
    const full = versionsApi.titleFromCatalog(
      streamVersionCatalog(),
      item.playbackId,
      itemLabel(item)
    );
    return versionsApi.getTrackGroupKey(full);
  }

  function groupedPlaybackIds() {
    return shared.allGroupedPlaybackIds ? shared.allGroupedPlaybackIds() : new Set();
  }

  function expandGroupForResult(result, targetId) {
    if (result && result.groupId) {
      setAlbumExpanded(result.groupId, true);
      return;
    }
    if (result && result.type === 'merge' && targetId) {
      const existing = shared.findGroupForTrack(targetId);
      if (existing) {
        setAlbumExpanded(existing.id, true);
        return;
      }
      const groups = shared.loadGroups();
      const newest = groups[groups.length - 1];
      if (newest) setAlbumExpanded(newest.id, true);
      return;
    }
    if (result && (result.type === 'landing' || result.type === 'addToGroup')) {
      const groups = shared.loadGroups();
      const newest = groups[groups.length - 1];
      if (newest) setAlbumExpanded(newest.id, true);
    }
  }

  /** Published entry pages (e.g. "4.30.26") that reference this exact mux id. */
  function publishedEntriesForPlaybackId(playbackId) {
    if (!playbackId) return [];
    const pages = new Set();
    const maps = [window.songsByPage, window.videosByPage];
    maps.forEach(function (map) {
      if (!map) return;
      Object.keys(map).forEach(function (page) {
        const tracks = map[page];
        if (!Array.isArray(tracks)) return;
        if (tracks.some(function (t) { return t && t.playbackId === playbackId; })) {
          pages.add(page);
        }
      });
    });
    return Array.from(pages);
  }

  function mergedSongCatalog() {
    if (!versionsApi) return [];
    return versionsApi.mergeSongCatalog(
      versionsApi.getSiteCatalog(window),
      libraryCache,
      itemLabel
    );
  }

  /**
   * Catalog scoped to playback ids that are actually in the MUX library.
   * Names still resolve MUX-first (merge sets title from mux passthrough),
   * but versions/counts never include site-only rows that can't play here.
   */
  function streamVersionCatalog() {
    const inLibrary = new Set(
      libraryCache
        .map(function (row) {
          return row && row.playbackId;
        })
        .filter(Boolean)
    );
    return mergedSongCatalog().filter(function (song) {
      return song && inLibrary.has(song.playbackId);
    });
  }

  function dedupeAudioItems(audioItems) {
    if (!versionsApi || !audioItems.length) return audioItems;
    const catalog = streamVersionCatalog();
    const rows = versionsApi.dedupeToOneRowPerSong(catalog, audioItems, {
      songFromItem: catalogSongFromItem,
      findItemByPlaybackId: function (playbackId) {
        return shared.findInLibrary(libraryCache, playbackId);
      },
      listSortMode: 'az'
    });

    // Hard guarantee: never show the same song name twice. If two groups still
    // resolve to the same visible base name, keep the newest — version
    // selection in the now-playing bar covers the rest.
    const byName = new Map();
    rows.forEach(function (row) {
      const full = versionsApi.titleFromCatalog(catalog, row.item.playbackId, itemLabel(row.item));
      const base = (versionsApi.stripTrailingDate(full) || full).trim().toLowerCase();
      const existing = byName.get(base);
      if (!existing) {
        byName.set(base, row);
        return;
      }
      const a = versionsApi.parseTrackDateValue(existing.song);
      const b = versionsApi.parseTrackDateValue(row.song);
      if (b > a) byName.set(base, row);
    });

    return Array.from(byName.values()).map(function (row) {
      return row.item;
    });
  }

  function getStreamVersionCycle() {
    if (!versionsApi) return null;
    if (!streamVersionCycle) {
      streamVersionCycle = versionsApi.createVersionCycle(streamVersionCatalog());
    }
    return streamVersionCycle;
  }

  function resetStreamVersionCycle() {
    streamVersionCycle = null;
  }

  function catalogSongFromItem(item) {
    const catalog = mergedSongCatalog();
    const title = versionsApi
      ? versionsApi.titleFromCatalog(catalog, item.playbackId, itemLabel(item))
      : itemLabel(item);
    if (versionsApi) return versionsApi.libraryItemToSong(item, title);
    return { title: title, playbackId: item.playbackId, kind: item.kind || 'audio' };
  }

  function libraryItemFromSong(song, fallbackItem) {
    if (!song || !song.playbackId) return fallbackItem || null;
    const fromLib = shared.findInLibrary(libraryCache, song.playbackId);
    if (fromLib) return fromLib;
    const base = fallbackItem || {};
    return {
      playbackId: song.playbackId,
      passthrough: song.title,
      displayTitle: versionsApi ? versionsApi.displayTitleForSong(song) : song.title,
      kind: base.kind || song.kind || 'audio',
      muxAssetId: song.muxAssetId || base.muxAssetId,
      createdAt: song.createdAt || base.createdAt
    };
  }

  function selectedPlayableItem(item) {
    if (!item || !item.playbackId || shared.isVideoItem(item)) return item;
    const cycle = getStreamVersionCycle();
    if (!cycle) return item;
    const selected = cycle.getSelected(catalogSongFromItem(item));
    return libraryItemFromSong(selected, item);
  }

  function filteredAssets() {
    return libraryCache.filter(function (item) {
      if (isVideoPage()) return shared.isVideoItem(item);
      return !shared.isVideoItem(item);
    });
  }

  function listCounts() {
    const items = filteredAssets();
    if (isVideoPage()) return items.length;
    return dedupeAudioItems(items).length;
  }

  function toggleAudioItem(item) {
    if (!player || !item) return;
    if (expandedVideoId) {
      closeExpandedVideo();
    }
    const playable = selectedPlayableItem(item);
    const id = playable.playbackId;
    if (player.isActivePlaybackId(id)) {
      if (player.isPlayingPlaybackId(id)) {
        player.togglePause();
      } else {
        player.playItem(playable);
      }
      return;
    }
    recordPlay(id);
    player.playItem(playable);
  }

  function shouldSkipTrackPlay(el, event) {
    const track = el.closest('.studio-stream-track-item, .studio-stream-album-track');
    if (!track) return false;
    if (
      track.dataset.studioJustDragged === '1' ||
      track.dataset.studioDragging === '1' ||
      track.dataset.studioDragHold === '1'
    ) {
      return true;
    }
    return false;
  }

  function bindTouchPlay(el, handler) {
    const tap = window.BurnfolderTouchTap || window.BurnfolderStudioTap;
    if (tap && tap.bind) {
      tap.bind(el, handler, {
        shouldSkip: function (event) {
          return shouldSkipTrackPlay(el, event);
        }
      });
      return;
    }
    el.addEventListener('click', handler);
  }

  function deleteSongFromMux(item) {
    const playable = selectedPlayableItem(item);
    const label = baseSongLabel(catalogSongFromItem(item)) || itemLabel(playable);
    if (!playable.muxAssetId) {
      setStatus('only mux uploads can be deleted');
      return;
    }
    if (!window.BurnfolderMux || !window.BurnfolderMux.deleteMuxAsset) {
      setStatus('mux unavailable — run: npx netlify dev');
      return;
    }

    const publishedOn = publishedEntriesForPlaybackId(playable.playbackId);
    let message;
    if (publishedOn.length) {
      message =
        '⚠️ "' + label + '" is published on burnfolder.com:\n\n' +
        publishedOn.map(function (p) { return '   • ' + p; }).join('\n') +
        '\n\nDeleting it from Mux will BREAK playback on ' +
        (publishedOn.length === 1 ? 'that entry' : 'those entries') +
        '. You should remove it from the entr' +
        (publishedOn.length === 1 ? 'y' : 'ies') +
        ' first.\n\nDelete from Mux anyway? This cannot be undone.';
    } else {
      message =
        'Delete "' + label + '" from Mux?\n\n' +
        'This permanently removes the file from your library and cannot be undone.';
    }
    if (!window.confirm(message)) {
      return;
    }
    setStatus('deleting…');
    window.BurnfolderMux.deleteMuxAsset(playable.muxAssetId)
      .then(function () {
        if (window.BurnfolderAssetCloud && window.BurnfolderAssetCloud.deleteByMuxAssetId) {
          return window.BurnfolderAssetCloud.deleteByMuxAssetId(playable.muxAssetId);
        }
        return 0;
      })
      .then(function () {
        shared.removeFromStack(playable.playbackId);
        if (player && player.isActivePlaybackId(playable.playbackId) && player.stop) {
          player.stop();
        }
        return refreshLibrary({ silent: true });
      })
      .then(function () {
        setStatus('');
      })
      .catch(function (err) {
        setStatus(err.message || 'delete failed');
      });
  }

  function dndApi() {
    return window.BurnfolderStudioDnD || null;
  }

  function stackIndexForId(playbackId, groupId) {
    const group = groupId
      ? shared.findGroupById(groupId)
      : shared.findGroupForTrack(playbackId);
    if (!group) return -1;
    return group.tracks.findIndex(function (t) {
      return t.playbackId === playbackId;
    });
  }

  function resolveDraggedItem(playbackId) {
    return (
      shared.findInLibrary(libraryCache, playbackId) ||
      resolveStackTrackItem({ playbackId: playbackId })
    );
  }

  function handleDnDDrop(payload, result) {
    if (!payload || !result) return;

    if (result.type === 'cancel') {
      renderList();
      return;
    }

    if (payload.kind === 'library' || payload.kind === 'album') {
      const dragged = resolveDraggedItem(payload.id);
      if (!dragged) return;

      if (result.type === 'merge' && result.targetId) {
        const target =
          shared.findInLibrary(libraryCache, result.targetId) ||
          resolveStackTrackItem({ playbackId: result.targetId });
        if (target) shared.dropOntoSong(dragged, target);
      } else if (result.type === 'delete') {
        deleteSongFromMux(dragged);
        return;
      } else if (result.type === 'addToGroup') {
        shared.addToGroup(dragged, result.groupId || '');
      } else if (result.type === 'landing') {
        shared.addToGroup(dragged);
      } else if (result.type === 'reorder' && result.targetId) {
        let targetIndex = stackIndexForId(result.targetId, payload.groupId);
        if (targetIndex < 0) return;
        if (!result.before) targetIndex += 1;
        shared.reorderStack(payload.id, targetIndex, payload.groupId);
      } else if (result.type === 'eject') {
        shared.removeFromStack(payload.id);
      }

      if (result.groupId) setAlbumExpanded(result.groupId, true);
      else expandGroupForResult(result, result.targetId);
      renderList();
      return;
    }
  }

  function bindAllDnD() {
    const api = dndApi();
    if (!api || !listRoot || isVideoPage()) return;

    if (!window.__studioDnDStreamRegistered) {
      api.registerDropHandler('stream', handleDnDDrop);
      window.__studioDnDStreamRegistered = true;
    }

    const libraryTracklist = listRoot.querySelector(
      '.studio-stream-tracklist.studio-stream-library-drop'
    );

    listRoot.querySelectorAll('.studio-stream-track-item:not(.studio-stream-album-track)').forEach(function (li) {
      api.attach(li, {
        kind: 'library',
        zone: 'stream',
        handle: '.studio-track-grip',
        getId: function () {
          const row = li.querySelector('.music-track-row');
          return (row && row.dataset.playbackId) || li.dataset.playbackId || '';
        },
        getLabel: function () {
          const titleEl = li.querySelector('.music-track-title');
          return titleEl ? titleEl.textContent.trim() : '';
        },
        showLanding: !!libraryTracklist,
        landingHost: listRoot
      });
    });

    listRoot.querySelectorAll('.studio-stream-album-track').forEach(function (li) {
      const groupEl = li.closest('.studio-stream-album-group');
      const groupId = groupEl ? groupEl.dataset.groupId || '' : '';
      api.attach(li, {
        kind: 'album',
        zone: 'stream',
        handle: '.studio-stream-album-track-handle',
        getId: function () {
          return li.dataset.playbackId || '';
        },
        getLabel: function () {
          const titleEl = li.querySelector('.music-track-title');
          return titleEl ? titleEl.textContent.trim() : '';
        },
        getIndex: function () {
          return stackIndexForId(li.dataset.playbackId, groupId);
        },
        getGroupId: function () {
          return groupId;
        }
      });
    });
  }

  function syncVideoStage(autoplay) {
    if (!videoStage) return;
    if (!expandedVideoId) {
      shared.clearStreamVideo(videoStage);
      return;
    }
    const videoItem = shared.findInLibrary(libraryCache, expandedVideoId);
    if (!videoItem || !shared.canPlayAsVideo(videoItem)) {
      expandedVideoId = null;
      shared.clearStreamVideo(videoStage);
      updateVideoRowExpandedState();
      return;
    }
    shared.mountStreamVideo(videoItem, videoStage, { autoplay: !!autoplay });
  }

  function updateVideoRowExpandedState() {
    if (!listRoot) return;
    listRoot.querySelectorAll('.studio-stream-video-item, .studio-video-card').forEach(function (el) {
      const id = el.getAttribute('data-playback-id');
      const on = !!id && id === expandedVideoId;
      el.classList.toggle('is-expanded', on);
    });
  }

  function closeExpandedVideo() {
    expandedVideoId = null;
    shared.clearStreamVideo(videoStage);
    updateVideoRowExpandedState();
  }

  function openStreamVideo(item) {
    if (!item || !item.playbackId) return;
    if (!shared.canPlayAsVideo(item)) {
      toggleAudioItem(item);
      return;
    }
    expandedVideoId = item.playbackId;
    updateVideoRowExpandedState();
    syncVideoStage(true);
    if (videoStage && typeof videoStage.scrollIntoView === 'function') {
      videoStage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function toggleVideoExpand(item) {
    if (!item || !item.playbackId) return;
    if (!shared.canPlayAsVideo(item)) {
      toggleAudioItem(item);
      return;
    }
    if (expandedVideoId === item.playbackId) {
      closeExpandedVideo();
      return;
    }
    openStreamVideo(item);
  }

  function preloadTrackDuration(durEl, playbackId, knownSeconds) {
    const pf = window.BurnfolderPlaybackPrefetch;
    if (pf) {
      pf.requestDuration(durEl, playbackId, knownSeconds);
      return;
    }
    if (!durEl || !playbackId) return;
    durEl.textContent = '--:--';
  }

  function syncStreamTracklistPlayback() {
    if (!listRoot) return;
    listRoot.querySelectorAll('.music-track-row').forEach(function (row) {
      const id = row.dataset.playbackId;
      const active = player && player.isActivePlaybackId(id);
      const playing = player && player.isPlayingPlaybackId(id);
      row.classList.toggle('is-active', !!active);
      row.classList.toggle('is-playing', !!playing);
    });
  }

  function baseSongLabel(seedSong) {
    const fullTitle = versionsApi
      ? versionsApi.displayTitleForSongInCatalog(streamVersionCatalog(), seedSong)
      : itemLabel(seedSong);
    if (!versionsApi) return fullTitle;
    return versionsApi.stripTrailingDate(fullTitle) || fullTitle;
  }

  function buildTrashIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const lid = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    lid.setAttribute('d', 'M2.5 4.5h11');
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    body.setAttribute('d', 'M5.5 4.5V3.75A1.25 1.25 0 016.75 2.5h2.5A1.25 1.25 0 0110.5 3.75V4.5M5 4.5h6l-.55 8.1A1 1 0 019.45 13.5H6.55a1 1 0 01-.99-1.1L5 4.5z');
    svg.appendChild(lid);
    svg.appendChild(body);
    return svg;
  }

  function buildAudioTrackItem(item, trackNum) {
    const seedSong = catalogSongFromItem(item);

    const li = document.createElement('li');
    li.className = 'music-tracklist-item studio-stream-track-item';

    const grip = document.createElement('span');
    grip.className = 'studio-track-grip';
    grip.setAttribute('aria-hidden', 'true');

    const num = document.createElement('span');
    num.className = 'music-track-num';
    num.textContent = String(trackNum);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'music-track-row';

    const name = document.createElement('span');
    name.className = 'music-track-title';

    const dur = document.createElement('span');
    dur.className = 'music-track-duration';
    dur.textContent = '--:--';

    function syncRow() {
      const playable = selectedPlayableItem(item);
      const label = baseSongLabel(seedSong);
      const inGroup = groupedPlaybackIds().has(playable.playbackId);
      li.classList.toggle('is-in-group', inGroup);
      li.dataset.playbackId = playable.playbackId;
      row.dataset.playbackId = playable.playbackId;
      row.setAttribute('aria-label', 'Play ' + label);
      name.textContent = label;
      dur.textContent = shared.formatDuration(playable.duration) || '--:--';
      row.classList.toggle('is-active', !!(player && player.isActivePlaybackId(playable.playbackId)));
      row.classList.toggle('is-playing', !!(player && player.isPlayingPlaybackId(playable.playbackId)));
      if (!shared.formatDuration(playable.duration) && !dur.dataset.loaded) {
        preloadTrackDuration(dur, playable.playbackId, playable.duration);
        dur.dataset.loaded = '1';
      }
    }

    syncRow();

    const pf = window.BurnfolderPlaybackPrefetch;
    if (pf) {
      pf.attachRow(row, function () {
        return selectedPlayableItem(item).playbackId;
      });
    }

    bindTouchPlay(row, function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        window.location.href = shared.songPageUrl(selectedPlayableItem(item));
        return;
      }
      toggleAudioItem(item);
    });

    row.appendChild(name);
    row.appendChild(dur);

    row.addEventListener('touchstart', function () {
      if (player && player.primeItem) {
        player.primeItem(selectedPlayableItem(item));
      }
    }, { passive: true });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'studio-stream-track-delete';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.appendChild(buildTrashIcon());

    li.appendChild(grip);
    li.appendChild(num);
    li.appendChild(row);
    li.appendChild(deleteBtn);
    return li;
  }

  function songGroupKeyForVideoItem(item) {
    if (!item) return '';
    if (item.songGroupKey) return item.songGroupKey;
    const clipNaming = window.BurnfolderSongClipNaming;
    if (!clipNaming || !versionsApi) return '';
    return clipNaming.inferSongGroupKey(
      item.passthrough || item.muxFileName || item.displayTitle || '',
      versionsApi
    );
  }

  function songTitleForGroupKey(groupKey, fallbackTitle) {
    if (fallbackTitle) return fallbackTitle;
    if (!groupKey || !versionsApi) return groupKey || 'clips';
    const match = libraryCache.find(function (item) {
      return item.kind === 'video' && item.songGroupKey === groupKey && item.songTitle;
    });
    if (match && match.songTitle) return match.songTitle;
    const song = (window.allSongs || []).find(function (row) {
      return versionsApi.getTrackGroupKey(row.title) === groupKey;
    });
    if (song) return versionsApi.stripTrailingDate(song.title) || song.title;
    return groupKey;
  }

  function videoCardLabel(item) {
    const fullTitle = shared.muxFileLabel(item);
    const clipNaming = window.BurnfolderSongClipNaming;
    const groupKey = songGroupKeyForVideoItem(item);
    if (clipNaming && groupKey) {
      const short = clipNaming.clipLabelFromPassthrough(fullTitle, item.songTitle);
      if (short && short !== fullTitle) return short;
    }
    return versionsApi ? versionsApi.stripTrailingDate(fullTitle) || fullTitle : fullTitle;
  }

  function buildVideoCardItem(item) {
    const isExpanded = expandedVideoId === item.playbackId;
    const label = videoCardLabel(item);
    const duration = shared.formatDuration(item.duration);
    const thumb = shared.thumbnailUrl(item.playbackId);

    const li = document.createElement('li');
    li.className = 'studio-video-card studio-stream-video-item';
    li.setAttribute('data-playback-id', item.playbackId || '');
    if (isExpanded) li.classList.add('is-expanded');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'studio-video-card-btn';
    btn.dataset.playbackId = item.playbackId || '';
    btn.setAttribute('aria-label', (isExpanded ? 'Close ' : 'Play ') + label);

    const thumbWrap = document.createElement('span');
    thumbWrap.className = 'studio-video-card-thumb';
    if (thumb) {
      const img = document.createElement('img');
      img.src = thumb;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      thumbWrap.appendChild(img);
    }
    if (duration) {
      const dur = document.createElement('span');
      dur.className = 'studio-video-card-duration';
      dur.textContent = duration;
      thumbWrap.appendChild(dur);
    }

    const title = document.createElement('span');
    title.className = 'studio-video-card-title';
    title.textContent = label;

    btn.appendChild(thumbWrap);
    btn.appendChild(title);

    btn.addEventListener('click', function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        window.location.href = shared.songPageUrl(item);
        return;
      }
      toggleVideoExpand(item);
    });

    li.appendChild(btn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'studio-stream-track-delete studio-video-card-delete';
    deleteBtn.setAttribute('aria-label', 'Delete video');
    deleteBtn.appendChild(buildTrashIcon());
    deleteBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      deleteSongFromMux(item);
    });
    li.appendChild(deleteBtn);
    return li;
  }

  function albumItemsForGroup(group) {
    return (group.tracks || []).map(resolveStackTrackItem);
  }

  function albumShareTracksForGroup(group) {
    return albumItemsForGroup(group)
      .filter(function (item) {
        return item && item.playbackId && !shared.canPlayAsVideo(item);
      })
      .map(function (item) {
        return { title: itemLabel(item), playbackId: item.playbackId };
      });
  }

  function playAlbum(group, index) {
    if (!player || !group) return;
    const items = albumItemsForGroup(group);
    if (!items.length) return;
    if (expandedVideoId) closeExpandedVideo();
    const started = items[index || 0];
    if (started && started.playbackId) recordPlay(started.playbackId);
    player.playQueue(items, index || 0, {
      coverArt: (group.meta && group.meta.coverArt) || ''
    });
  }

  function buildAlbumTrackItem(track, index, group) {
    const resolved = resolveStackTrackItem(track);
    const li = document.createElement('li');
    li.className = 'music-tracklist-item studio-stream-track-item studio-stream-album-track';
    li.dataset.playbackId = track.playbackId || '';

    const handle = document.createElement('span');
    handle.className = 'studio-stream-album-track-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.textContent = '⠿';

    const num = document.createElement('span');
    num.className = 'music-track-num';
    num.textContent = String(index + 1);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'music-track-row';
    row.dataset.playbackId = resolved.playbackId || '';
    const label = itemLabel(resolved) || track.title || 'untitled';
    row.setAttribute('aria-label', 'Play ' + label);

    const name = document.createElement('span');
    name.className = 'music-track-title';
    name.textContent = label;

    const dur = document.createElement('span');
    dur.className = 'music-track-duration';
    dur.textContent = shared.formatDuration(resolved.duration) || '--:--';

    row.appendChild(name);
    row.appendChild(dur);
    row.classList.toggle('is-active', !!(player && player.isActivePlaybackId(resolved.playbackId)));
    row.classList.toggle('is-playing', !!(player && player.isPlayingPlaybackId(resolved.playbackId)));
    bindTouchPlay(row, function () {
      playAlbum(group, index);
    });
    row.addEventListener('touchstart', function () {
      const items = albumItemsForGroup(group);
      const trackItem = items[index];
      if (player && player.primeItem && trackItem) player.primeItem(trackItem);
    }, { passive: true });

    li.appendChild(handle);
    li.appendChild(num);
    li.appendChild(row);
    return li;
  }

  function applyCoverPreview(coverBtn, meta) {
    const coverArt = window.BurnfolderCoverArt;
    if (coverArt && coverArt.applyCoverPreview) {
      coverArt.applyCoverPreview(coverBtn, meta);
      return;
    }
    if (!coverBtn) return;
    coverBtn.innerHTML = '';
    if (meta && meta.coverArt) {
      coverBtn.classList.remove('is-empty');
      const img = document.createElement('img');
      img.src = meta.coverArt;
      img.alt = meta.coverAlt || meta.title || 'cover art';
      coverBtn.appendChild(img);
    } else {
      coverBtn.classList.add('is-empty');
    }
  }

  function setAlbumCoverFromFile(groupId, file, coverBtn, coverWrap) {
    const coverApi = window.BurnfolderCoverArt;
    if (!file) return;
    const m = shared.loadStackMeta(groupId);
    const label = m.title || file.name || 'album';

    function afterSave(nextMeta) {
      applyCoverPreview(coverBtn, nextMeta);
      syncAlbumCoverClearBtn(coverWrap, nextMeta);
    }

    if (!coverApi || !coverApi.registerCoverFromFile) {
      setStatus('image storage unavailable');
      return;
    }

    coverApi
      .registerCoverFromFile(file, label)
      .then(function (result) {
        coverApi.patchFromCoverResult(m, result);
        shared.saveStackMeta(m, groupId);
        afterSave(m);
        setStatus('cover → ' + m.coverArt + ' (saved to downloads — move to site IMAGES/)');
      })
      .catch(function (err) {
        setStatus(err.message || 'could not add cover');
      });
  }

  function syncAlbumCoverClearBtn(coverWrap, meta) {
    if (!coverWrap) return;
    const clearBtn = coverWrap.querySelector('.studio-stream-album-cover-clear');
    if (clearBtn) clearBtn.hidden = !(meta && meta.coverArt);
  }

  function buildAlbumCoverControls(groupId, meta) {
    const coverWrap = document.createElement('div');
    coverWrap.className = 'studio-stream-album-cover-wrap';

    const coverBtn = document.createElement('button');
    coverBtn.type = 'button';
    coverBtn.className = 'studio-stream-album-cover';
    applyCoverPreview(coverBtn, meta);

    const coverClearBtn = document.createElement('button');
    coverClearBtn.type = 'button';
    coverClearBtn.className = 'studio-stream-album-cover-clear';
    coverClearBtn.setAttribute('aria-label', 'Remove cover art');
    coverClearBtn.textContent = '×';
    coverClearBtn.hidden = !meta.coverArt;
    coverClearBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      const m = shared.loadStackMeta(groupId);
      const coverApi = window.BurnfolderCoverArt;
      if (coverApi && coverApi.clearCoverMeta) coverApi.clearCoverMeta(m);
      else {
        m.coverArt = '';
        m.coverAssetId = '';
      }
      m.coverAlt = m.title || '';
      shared.saveStackMeta(m, groupId);
      applyCoverPreview(coverBtn, m);
      syncAlbumCoverClearBtn(coverWrap, m);
    });

    const coverInput = document.createElement('input');
    coverInput.type = 'file';
    coverInput.accept = 'image/*';
    coverInput.hidden = true;
    coverBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      coverInput.click();
    });
    coverInput.addEventListener('change', function () {
      const file = coverInput.files && coverInput.files[0];
      coverInput.value = '';
      if (!file) return;
      setAlbumCoverFromFile(groupId, file, coverBtn, coverWrap);
    });

    coverWrap.appendChild(coverBtn);
    coverWrap.appendChild(coverClearBtn);
    coverWrap.appendChild(coverInput);

    return coverWrap;
  }

  function buildAlbumGroup(group) {
    const tracks = group.tracks || [];
    if (!tracks.length) return null;
    const meta = group.meta || shared.loadStackMeta(group.id);
    const groupId = group.id;

    const wrap = document.createElement('section');
    wrap.className = 'studio-stream-album-group';
    wrap.dataset.groupId = groupId;
    if (isAlbumExpanded(groupId)) wrap.classList.add('is-expanded');

    const head = document.createElement('div');
    head.className = 'studio-stream-album-head';

    const coverWrap = buildAlbumCoverControls(groupId, meta);

    const info = document.createElement('span');
    info.className = 'studio-stream-album-info';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'studio-stream-album-name-input';
    nameInput.placeholder = '';
    nameInput.value = meta.title || '';
    nameInput.spellcheck = false;
    nameInput.autocomplete = 'off';
    nameInput.setAttribute('aria-label', 'Title');
    nameInput.addEventListener('input', function () {
      const m = shared.loadStackMeta(groupId);
      m.title = nameInput.value;
      if (m.coverArt) m.coverAlt = m.title || m.coverAlt || 'cover art';
      shared.saveStackMeta(m, groupId);
    });
    const metaEl = document.createElement('span');
    metaEl.className = 'studio-stream-album-meta';
    metaEl.textContent = String(tracks.length);
    info.appendChild(nameInput);
    info.appendChild(metaEl);

    const actions = document.createElement('span');
    actions.className = 'studio-stream-album-actions';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'studio-stream-album-play';
    playBtn.setAttribute('aria-label', 'Play');
    playBtn.textContent = '▶';
    playBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      playAlbum(group, 0);
    });

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'studio-stream-album-toggle';
    toggle.setAttribute('aria-label', 'Expand');
    toggle.textContent = '▾';
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      const expanded = !wrap.classList.contains('is-expanded');
      setAlbumExpanded(groupId, expanded);
      wrap.classList.toggle('is-expanded', expanded);
    });

    actions.appendChild(playBtn);

    const hubBtn = document.createElement('a');
    hubBtn.className = 'studio-stream-album-hub-btn';
    hubBtn.href = shared.albumPageUrl(groupId);
    hubBtn.textContent = 'hub';
    hubBtn.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    actions.appendChild(hubBtn);

    actions.appendChild(toggle);

    head.appendChild(coverWrap);
    head.appendChild(info);
    head.appendChild(actions);

    const ol = document.createElement('ol');
    ol.className = 'music-tracklist entry-audio-list studio-stream-album-tracks';
    tracks.forEach(function (track, index) {
      ol.appendChild(buildAlbumTrackItem(track, index, group));
    });

    wrap.appendChild(head);
    wrap.appendChild(ol);
    return wrap;
  }

  function updateAlbumMeta() {
    if (!listRoot) return;
    const groups = listRoot.querySelectorAll('.studio-stream-album-group');
    if (!groups.length) {
      renderList();
      return;
    }
    groups.forEach(function (groupEl) {
      const groupId = groupEl.dataset.groupId || '';
      const meta = shared.loadStackMeta(groupId);
      const nameInput = groupEl.querySelector('.studio-stream-album-name-input');
      const typingName = nameInput && document.activeElement === nameInput;
      if (nameInput && !typingName) nameInput.value = meta.title || '';
      if (!typingName) {
        applyCoverPreview(groupEl.querySelector('.studio-stream-album-cover'), meta);
        syncAlbumCoverClearBtn(groupEl.querySelector('.studio-stream-album-cover-wrap'), meta);
      }
      const metaEl = groupEl.querySelector('.studio-stream-album-meta');
      const trackCount = shared.findGroupById(groupId);
      if (metaEl && trackCount) metaEl.textContent = String(trackCount.tracks.length);
    });
  }

  function renderList() {
    if (!listRoot) return;
    const items = filteredAssets();
    listRoot.innerHTML = '';

    if (!libraryCache.length) {
      const kind = isVideoPage() ? 'videos' : 'songs';
      const action = isVideoPage() ? '+ add video' : '+ add music';
      listRoot.innerHTML =
        '<p class="studio-empty">no ' +
        kind +
        ' yet — <button type="button" class="studio-empty-action">' +
        action +
        '</button> to upload.</p>';
      const openBtn = listRoot.querySelector('.studio-empty-action');
      if (openBtn) openBtn.addEventListener('click', openUploadDetails);
      syncUploadDetailsOpen();
      if (countEl) countEl.textContent = countLabel(0);
      return;
    }
    if (!items.length) {
      listRoot.innerHTML =
        '<p class="studio-empty">nothing to show — upload or check your library.</p>';
      return;
    }

    if (isVideoPage()) {
      const videoItems = items.filter(shared.isVideoItem);
      listRoot.classList.remove('has-video');
      listRoot.classList.add('studio-video-grid-wrap');

      const groups = new Map();
      const other = [];

      videoItems.forEach(function (item) {
        const key = songGroupKeyForVideoItem(item);
        if (key) {
          if (!groups.has(key)) {
            groups.set(key, {
              key: key,
              title: item.songTitle || '',
              items: []
            });
          }
          const group = groups.get(key);
          if (!group.title && item.songTitle) group.title = item.songTitle;
          group.items.push(item);
          return;
        }
        other.push(item);
      });

      const sortedGroups = Array.from(groups.values()).sort(function (a, b) {
        const titleA = songTitleForGroupKey(a.key, a.title);
        const titleB = songTitleForGroupKey(b.key, b.title);
        return titleA.localeCompare(titleB, undefined, { sensitivity: 'base' });
      });

      sortedGroups.forEach(function (group) {
        const section = document.createElement('section');
        section.className = 'studio-video-group';

        const heading = document.createElement('h2');
        heading.className = 'studio-video-group-title';
        heading.textContent = songTitleForGroupKey(group.key, group.title);
        section.appendChild(heading);

        const grid = document.createElement('ul');
        grid.className = 'studio-video-grid';
        group.items.forEach(function (item) {
          grid.appendChild(buildVideoCardItem(item));
        });
        section.appendChild(grid);
        listRoot.appendChild(section);
      });

      if (other.length) {
        const section = document.createElement('section');
        section.className = 'studio-video-group';
        if (sortedGroups.length) {
          const heading = document.createElement('h2');
          heading.className = 'studio-video-group-title';
          heading.textContent = 'other videos';
          section.appendChild(heading);
        }
        const grid = document.createElement('ul');
        grid.className = 'studio-video-grid';
        other.forEach(function (item) {
          grid.appendChild(buildVideoCardItem(item));
        });
        section.appendChild(grid);
        listRoot.appendChild(section);
      }

      syncVideoStage();
      return;
    }

    listRoot.classList.remove('studio-video-grid-wrap');
    let audioItems = dedupeAudioItems(items.filter(function (item) {
      return !shared.isVideoItem(item);
    }));

    const groupedIds = groupedPlaybackIds();
    if (groupedIds.size) {
      audioItems = audioItems.filter(function (item) {
        return item.playbackId && !groupedIds.has(item.playbackId);
      });
    }

    audioItems.sort(function (a, b) {
      return playRecency(b) - playRecency(a);
    });

    listRoot.classList.remove('has-video');

    const albumGroups = shared.loadGroups();
    let hasAlbumGroup = false;
    albumGroups.forEach(function (group) {
      const albumGroup = buildAlbumGroup(group);
      if (albumGroup) {
        hasAlbumGroup = true;
        listRoot.appendChild(albumGroup);
      }
    });

    if (audioItems.length) {
      const tracklist = document.createElement('ol');
      tracklist.className =
        'music-tracklist entry-audio-list studio-stream-tracklist studio-stream-library-drop';
      let n = 0;
      audioItems.forEach(function (item) {
        tracklist.appendChild(buildAudioTrackItem(item, (n += 1)));
      });
      listRoot.appendChild(tracklist);
    } else if (hasAlbumGroup) {
      const shelf = document.createElement('div');
      shelf.className = 'studio-stream-library-shelf studio-stream-library-drop';
      shelf.setAttribute('aria-label', 'Drop here to remove from folder');
      listRoot.appendChild(shelf);
    }

    syncStreamTracklistPlayback();
    if (videoStage) shared.clearStreamVideo(videoStage);
    bindAllDnD();
  }

  function mountFilters() {
    if (!filterRoot) return;
    filterRoot.innerHTML = '';
    filterRoot.hidden = true;
  }

  function syncNowPlayingCatalog() {
    const provider = {
      getCatalog: streamVersionCatalog,
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
  }

  function applyLibrary(assets, statusMsg) {
    libraryCache = shared.normalizeLibrary(assets);
    resetStreamVersionCycle();
    upgradeProjectTracksToNewest();
    syncNowPlayingCatalog();
    const n = listCounts();
    if (countEl) countEl.textContent = countLabel(n);
    if (statusMsg !== undefined) setStatus(statusMsg);
    mountFilters();
    renderList();
    syncUploadDetailsOpen();
    const pf = window.BurnfolderPlaybackPrefetch;
    if (pf && isAudioPage()) {
      pf.warmLibraryItems(libraryCache, shared.isVideoItem, 6);
    }
    return libraryCache;
  }

  function prependUploadedAsset(asset) {
    if (!asset || !muxLib.libraryItemFromCloudAsset) return;
    const item = muxLib.libraryItemFromCloudAsset(asset);
    if (!item || !item.playbackId) return;
    if (libraryCache.some(function (row) {
      return row.playbackId === item.playbackId;
    })) {
      return;
    }
    libraryCache = shared.normalizeLibrary([item].concat(libraryCache));
    resetStreamVersionCycle();
    upgradeProjectTracksToNewest();
    if (countEl) {
      const n = listCounts();
      countEl.textContent = countLabel(n);
    }
    setStatus('');
    mountFilters();
    renderList();
    syncUploadDetailsOpen();
  }

  function refreshLibrary(opts) {
    const options = opts || {};
    if (!muxLib || !muxLib.listMuxLibrary) {
      setStatus('mux unavailable — run: npx netlify dev');
      return Promise.resolve([]);
    }
    if (!options.silent) setStatus('loading…');
    return muxLib
      .listMuxLibrary()
      .then(function (assets) {
        return applyLibrary(assets, assets.length ? '' : 'no mux files yet');
      })
      .catch(function (err) {
        if (!libraryCache.length) renderList();
        setStatus(err.message || 'could not load library');
        return libraryCache;
      });
  }

  function mountStreamUploadZone() {
    if (!uploadRoot || !window.BurnfolderCloudUI) return;
    window.BurnfolderCloudUI.mountUploadZone(uploadRoot, {
      onStatus: setStatus,
      onFileSuccess: prependUploadedAsset,
      onUploaded: function () {
        refreshLibrary({ silent: true });
      }
    });
  }

  if (!window.__studioStreamPageBound) {
    window.__studioStreamPageBound = true;

  window.addEventListener('burnfolder-stream-playback', function () {
    syncStreamTracklistPlayback();
    if (expandedVideoId) return;
    renderList();
  });

  window.addEventListener('burnfolder-stack-changed', function () {
    renderList();
  });

  window.addEventListener('burnfolder-stack-meta-changed', function () {
    updateAlbumMeta();
  });

  window.addEventListener('burnfolder-assets-changed', function (event) {
    const detail = event && event.detail;
    if (detail && detail.type === 'add' && detail.asset) {
      prependUploadedAsset(detail.asset);
    }
    refreshLibrary({ silent: true });
  });
  }

  function bindDomRefs() {
    listRoot = document.getElementById('streamList');
    videoStage = document.getElementById('streamVideoStage');
    filterRoot = document.getElementById('streamFilters');
    statusEl = document.getElementById('streamStatus');
    uploadRoot = document.getElementById('streamUpload');
    countEl = document.getElementById('streamCount');
  }

  window.studioInitStreamPage = function () {
    bindDomRefs();
    mountStreamUploadZone();
    if (!listRoot || !shared) return;
    syncActiveFilter();
    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      const nav = link.getAttribute('data-nav');
      if (isVideoPage()) {
        link.classList.toggle('is-active', nav === 'video');
        link.classList.toggle('page-nav', nav === 'video');
      } else {
        link.classList.toggle('is-active', nav === 'stream');
        link.classList.toggle('page-nav', nav === 'stream');
      }
    });
    if (isVideoPage()) {
      expandedVideoId = null;
    } else if (videoStage) {
      shared.clearStreamVideo(videoStage);
      expandedVideoId = null;
    }
    refreshLibrary();
  };

  bindDomRefs();
  if (listRoot) window.studioInitStreamPage();
})();
