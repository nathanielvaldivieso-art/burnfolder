(function () {
  'use strict';

  const STACK_KEY = 'burnfolderStreamStack';
  const STACK_META_KEY = 'burnfolderStreamStackMeta';
  const GROUPS_KEY = 'burnfolderStreamGroups';
  const PENDING_STACK_KEY = 'burnfolderPendingStack';
  const CLOUD_PENDING_STACK_KEY = 'pendingStack';
  const LAST_DRAFT_KEY = 'burnfolderStudioLastDraftId';
  const MUX_MIME = 'application/x-burnfolder-mux-playback';
  const CLOUD_STACK_KEY = 'stack';
  const CLOUD_STACK_META_KEY = 'stackMeta';
  const CLOUD_GROUPS_KEY = 'groups';

  function muxLib() {
    return window.BurnfolderStudioMux;
  }

  function cloudPut(key, value) {
    const cs = window.BurnfolderCloudState;
    if (cs && cs.put) cs.put(key, value);
  }

  /**
   * Pull the project/album from the personal cloud and hydrate localStorage so
   * the same project shows up on every device. Cloud is the source of truth;
   * if the cloud is empty we seed it from whatever is local (first run).
   */
  function hydrateStackFromCloud() {
    const cs = window.BurnfolderCloudState;
    if (!cs || !cs.get) return Promise.resolve();
    return Promise.all([
      cs.get(CLOUD_GROUPS_KEY).catch(function () { return undefined; }),
      cs.get(CLOUD_STACK_KEY).catch(function () { return undefined; }),
      cs.get(CLOUD_STACK_META_KEY).catch(function () { return undefined; })
    ]).then(function (results) {
      const cloudGroups = results[0];
      const stack = results[1];
      const meta = results[2];
      let groupsChanged = false;

      if (Array.isArray(cloudGroups) && cloudGroups.length) {
        window.localStorage.setItem(GROUPS_KEY, JSON.stringify(cloudGroups));
        syncLegacyFromGroups(cloudGroups);
        groupsChanged = true;
      } else if (cloudGroups === null) {
        const localGroups = loadGroups();
        if (localGroups.length) cloudPut(CLOUD_GROUPS_KEY, localGroups);
      } else if (Array.isArray(stack) && stack.length) {
        const migrated = [{
          id: genGroupId(),
          tracks: stack,
          meta: meta && typeof meta === 'object' ? normalizeMeta(meta) : emptyMeta()
        }];
        window.localStorage.setItem(GROUPS_KEY, JSON.stringify(migrated));
        syncLegacyFromGroups(migrated);
        cloudPut(CLOUD_GROUPS_KEY, migrated);
        groupsChanged = true;
      } else if (stack === null) {
        const localGroups = loadGroups();
        if (localGroups.length) cloudPut(CLOUD_GROUPS_KEY, localGroups);
      }

      if (groupsChanged) {
        window.dispatchEvent(new CustomEvent('burnfolder-stack-changed'));
        window.dispatchEvent(new CustomEvent('burnfolder-stack-meta-changed'));
      }
    });
  }

  function emptyMeta() {
    return { title: '', coverArt: '', coverAlt: '', coverAssetId: '' };
  }

  function normalizeMeta(parsed) {
    return {
      title: parsed && typeof parsed.title === 'string' ? parsed.title : '',
      coverArt: parsed && typeof parsed.coverArt === 'string' ? parsed.coverArt : '',
      coverAlt: parsed && typeof parsed.coverAlt === 'string' ? parsed.coverAlt : '',
      coverAssetId: parsed && typeof parsed.coverAssetId === 'string' ? parsed.coverAssetId : ''
    };
  }

  function genGroupId() {
    return (
      'g_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function normalizeGroup(group) {
    if (!group || typeof group !== 'object') return null;
    const tracks = Array.isArray(group.tracks) ? group.tracks : [];
    return {
      id: typeof group.id === 'string' && group.id ? group.id : genGroupId(),
      tracks: tracks,
      meta: normalizeMeta(group.meta)
    };
  }

  function readLegacyStack() {
    try {
      const raw = window.localStorage.getItem(STACK_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function readLegacyStackMeta() {
    try {
      const raw = window.localStorage.getItem(STACK_META_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return normalizeMeta(parsed);
    } catch (e) {
      return emptyMeta();
    }
  }

  function syncLegacyFromGroups(groups) {
    const first = groups && groups[0];
    if (first) {
      window.localStorage.setItem(STACK_KEY, JSON.stringify(first.tracks || []));
      window.localStorage.setItem(STACK_META_KEY, JSON.stringify(first.meta || emptyMeta()));
      cloudPut(CLOUD_STACK_KEY, first.tracks || []);
      cloudPut(CLOUD_STACK_META_KEY, first.meta || emptyMeta());
    } else {
      window.localStorage.setItem(STACK_KEY, '[]');
      window.localStorage.setItem(STACK_META_KEY, JSON.stringify(emptyMeta()));
      cloudPut(CLOUD_STACK_KEY, []);
      cloudPut(CLOUD_STACK_META_KEY, emptyMeta());
    }
  }

  function loadGroups() {
    try {
      const raw = window.localStorage.getItem(GROUPS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          if (!parsed.length) return [];
          const groups = parsed.map(normalizeGroup).filter(Boolean);
          if (groups.length) return groups;
        }
      }
    } catch (e) {
      /* fall through */
    }
    const legacy = readLegacyStack();
    if (!legacy.length) return [];
    const migrated = [{ id: genGroupId(), tracks: legacy, meta: readLegacyStackMeta() }];
    saveGroups(migrated, { skipLegacy: true });
    return migrated;
  }

  function saveGroups(groups, opts) {
    const options = opts || {};
    const safe = (groups || []).map(normalizeGroup).filter(function (g) {
      return g && g.tracks && g.tracks.length;
    });
    window.localStorage.setItem(GROUPS_KEY, JSON.stringify(safe));
    cloudPut(CLOUD_GROUPS_KEY, safe);
    if (!options.skipLegacy) syncLegacyFromGroups(safe);
    // Meta-only saves use silent + burnfolder-stack-meta-changed so typing an
    // album title does not remount every album card after each keystroke.
    if (!options.silent) {
      window.dispatchEvent(new CustomEvent('burnfolder-stack-changed'));
    }
  }

  function findGroupById(groupId) {
    if (!groupId) return null;
    return loadGroups().find(function (g) {
      return g.id === groupId;
    }) || null;
  }

  function findGroupForTrack(playbackId) {
    if (!playbackId) return null;
    return loadGroups().find(function (g) {
      return g.tracks.some(function (t) {
        return t.playbackId === playbackId;
      });
    }) || null;
  }

  function removeTrackFromAllGroups(playbackId, groups) {
    return (groups || loadGroups())
      .map(function (g) {
        return {
          id: g.id,
          meta: g.meta,
          tracks: g.tracks.filter(function (t) {
            return t.playbackId !== playbackId;
          })
        };
      })
      .filter(function (g) {
        return g.tracks.length > 0;
      });
  }

  function isInAnyGroup(playbackId) {
    return !!findGroupForTrack(playbackId);
  }

  function allGroupedPlaybackIds() {
    const ids = new Set();
    loadGroups().forEach(function (g) {
      g.tracks.forEach(function (t) {
        if (t.playbackId) ids.add(t.playbackId);
      });
    });
    return ids;
  }

  function groupedPlaybackIds() {
    return allGroupedPlaybackIds();
  }

  const VIDEO_NAME_RE = /\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)(\?.*)?$/i;
  const AUDIO_NAME_RE = /\.(mp3|wav|flac|aiff|aif|m4a|ogg|aac)(\?.*)?$/i;

  function resolveMediaKind(item) {
    if (!item) return 'audio';
    if (item.hasVideoTrack === true) return 'video';
    if (item.hasVideoTrack === false) return 'audio';

    const declared = String(item.kind || '').toLowerCase();
    if (declared === 'audio') return 'audio';
    if (declared === 'video') return 'video';

    const name = String(item.passthrough || item.displayTitle || item.name || '');
    if (AUDIO_NAME_RE.test(name)) return 'audio';
    if (VIDEO_NAME_RE.test(name)) return 'video';

    return 'audio';
  }

  function isVideoItem(item) {
    return resolveMediaKind(item) === 'video';
  }

  function canPlayAsVideo(item) {
    if (!item || !item.playbackId) return false;
    if (item.hasVideoTrack === true) return true;
    if (item.hasVideoTrack === false) return false;
    return isVideoItem(item);
  }

  function normalizeStreamItem(item) {
    if (!item) return item;
    const kind = resolveMediaKind(item);
    return Object.assign({}, item, {
      kind: kind,
      isVideo: kind === 'video',
      isAudio: kind === 'audio'
    });
  }

  function normalizeLibrary(assets) {
    return (assets || []).map(normalizeStreamItem);
  }

  function formatDuration(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return '';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  let streamVideoEl = null;
  let streamVideoPlaybackId = null;

  const CANONICAL_AUDIO_PIN =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;clip:rect(0,0,0,0);';

  function getGlobalAudioPlayer() {
    const shell = window.BurnfolderStudioPlaybackShell;
    if (shell && typeof shell.ensureShell === 'function') {
      shell.ensureShell();
      if (typeof shell.getEngine === 'function') {
        shell.getEngine();
      }
    }
    const shellNode = document.getElementById('studioGlobalPlayback');
    if (shellNode) {
      const inShell = shellNode.querySelector('#activeMuxPlayer');
      if (inShell) return inShell;
    }
    return document.getElementById('activeMuxPlayer');
  }

  function setHiddenAudioPlayer(enabled) {
    const audio = getGlobalAudioPlayer();
    if (!audio) return;
    if (enabled) {
      audio.removeAttribute('hidden');
      audio.style.cssText = CANONICAL_AUDIO_PIN;
      if (!audio.getAttribute('audio')) audio.setAttribute('audio', '');
      if (!audio.getAttribute('playsinline')) audio.setAttribute('playsinline', '');
    } else {
      if (window.BurnfolderStreamPlayer && window.BurnfolderStreamPlayer.stop) {
        window.BurnfolderStreamPlayer.stop();
        return;
      }
      audio.pause();
      audio.removeAttribute('playback-id');
      audio.setAttribute('hidden', '');
      audio.style.cssText = CANONICAL_AUDIO_PIN;
    }
  }

  function stopStreamAudio() {
    if (window.BurnfolderStreamPlayer && window.BurnfolderStreamPlayer.stop) {
      window.BurnfolderStreamPlayer.stop();
    } else {
      const audio = getGlobalAudioPlayer();
      if (audio) {
        audio.pause();
        audio.removeAttribute('playback-id');
      }
    }
    if (window.BurnfolderStreamNowPlaying && window.BurnfolderStreamNowPlaying.update) {
      window.BurnfolderStreamNowPlaying.update({ song: null, playing: false });
    }
    setHiddenAudioPlayer(true);
  }

  function clearStreamVideo(mountEl) {
    if (streamVideoEl) {
      streamVideoEl.pause();
      if (streamVideoEl.parentNode) streamVideoEl.parentNode.removeChild(streamVideoEl);
    }
    streamVideoEl = null;
    streamVideoPlaybackId = null;
    if (mountEl) {
      mountEl.innerHTML = '';
      mountEl.hidden = true;
    }
    setHiddenAudioPlayer(true);
  }

  /** Same mux-player setup as content.html / spa-router (burnfolder.com). */
  function createMuxVideoPlayer(item) {
    const lib = muxLib();
    const label = lib && lib.muxFileLabel ? lib.muxFileLabel(item) : (item.displayTitle || item.passthrough || 'untitled');
    const player = document.createElement('mux-player');
    player.setAttribute('playback-id', item.playbackId);
    player.setAttribute('metadata-video-title', label);
    player.setAttribute('playbackrates', '1 1.5 2');
    player.setAttribute('noairplay', '');
    player.className = 'page-inline-video';
    const poster = thumbnailUrl(item.playbackId);
    if (poster) player.setAttribute('poster', poster);
    return player;
  }

  function playStreamVideo(player) {
    if (!player || typeof player.play !== 'function') return;
    const start = function () {
      const p = player.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    };
    if (player.readyState >= 2) {
      start();
      return;
    }
    player.addEventListener('canplay', start, { once: true });
    start();
  }

  function getStreamVideoElement() {
    return streamVideoEl;
  }

  function mountStreamVideo(item, mountEl, opts) {
    if (!item || !item.playbackId || !mountEl) return null;
    if (!canPlayAsVideo(item)) return null;

    const options = opts || {};
    if (options.autoplay) {
      stopStreamAudio();
      setHiddenAudioPlayer(false);
    } else {
      setHiddenAudioPlayer(true);
    }

    if (streamVideoEl && streamVideoPlaybackId === item.playbackId) {
      if (!streamVideoEl.parentNode) mountEl.appendChild(streamVideoEl);
      mountEl.hidden = false;
      if (options.autoplay) playStreamVideo(streamVideoEl);
      return streamVideoEl;
    }

    clearStreamVideo(mountEl);
    streamVideoEl = createMuxVideoPlayer(item);
    streamVideoPlaybackId = item.playbackId;
    mountEl.appendChild(streamVideoEl);
    mountEl.hidden = false;
    if (options.autoplay) playStreamVideo(streamVideoEl);
    return streamVideoEl;
  }

  function loadStack() {
    const first = loadGroups()[0];
    return first ? first.tracks.slice() : [];
  }

  function saveStack(tracks) {
    const groups = loadGroups();
    if (!groups.length) {
      if (!tracks || !tracks.length) {
        saveGroups([]);
        return;
      }
      saveGroups([{ id: genGroupId(), tracks: tracks, meta: emptyMeta() }]);
      return;
    }
    groups[0].tracks = Array.isArray(tracks) ? tracks : [];
    saveGroups(groups);
  }

  /** Album-style metadata for a group (defaults to first group). */
  function loadStackMeta(groupId) {
    const group = groupId ? findGroupById(groupId) : loadGroups()[0];
    return group ? normalizeMeta(group.meta) : emptyMeta();
  }

  function saveStackMeta(meta, groupId) {
    const groups = loadGroups();
    const group = groupId ? groups.find(function (g) { return g.id === groupId; }) : groups[0];
    if (!group) return emptyMeta();
    group.meta = normalizeMeta(meta);
    saveGroups(groups, { silent: true });
    window.dispatchEvent(new CustomEvent('burnfolder-stack-meta-changed'));
    return group.meta;
  }

  function muxFileLabel(item) {
    const lib = muxLib();
    if (lib && lib.muxFileLabel) return lib.muxFileLabel(item);
    return item.displayTitle || item.passthrough || item.name || 'untitled';
  }

  function stackItemFromLibrary(item) {
    return {
      playbackId: item.playbackId,
      muxAssetId: item.muxAssetId,
      title: muxFileLabel(item),
      kind: item.kind || 'audio'
    };
  }

  function addToGroup(item, groupId) {
    if (!item || !item.playbackId || isVideoItem(item)) {
      return { ok: false };
    }
    let groups = loadGroups();
    const track = stackItemFromLibrary(item);
    groups = removeTrackFromAllGroups(track.playbackId, groups);

    let group = groupId ? groups.find(function (g) { return g.id === groupId; }) : null;
    if (!group) {
      group = { id: genGroupId(), tracks: [], meta: emptyMeta() };
      groups.push(group);
    }
    if (group.tracks.some(function (t) { return t.playbackId === track.playbackId; })) {
      return { ok: false };
    }
    group.tracks.push(track);
    saveGroups(groups);
    return { ok: true, groupId: group.id };
  }

  function addToStack(item) {
    return addToGroup(item);
  }

  /** Drag a song onto another: create or extend a group. */
  function dropOntoSong(draggedItem, targetItem) {
    if (!draggedItem || !targetItem || !draggedItem.playbackId || !targetItem.playbackId) {
      return { ok: false };
    }
    if (draggedItem.playbackId === targetItem.playbackId) {
      return { ok: false };
    }
    if (isVideoItem(draggedItem) || isVideoItem(targetItem)) {
      return { ok: false };
    }

    const dragged = stackItemFromLibrary(draggedItem);
    const target = stackItemFromLibrary(targetItem);
    let groups = removeTrackFromAllGroups(dragged.playbackId, loadGroups());
    const targetGroup = groups.find(function (g) {
      return g.tracks.some(function (t) {
        return t.playbackId === target.playbackId;
      });
    });

    if (targetGroup) {
      const targetIdx = targetGroup.tracks.findIndex(function (t) {
        return t.playbackId === target.playbackId;
      });
      if (targetIdx >= 0) {
        targetGroup.tracks.splice(targetIdx + 1, 0, dragged);
      } else {
        targetGroup.tracks.push(dragged);
      }
    } else {
      groups = removeTrackFromAllGroups(target.playbackId, groups);
      groups.push({
        id: genGroupId(),
        tracks: [target, dragged],
        meta: emptyMeta()
      });
    }

    saveGroups(groups);
    return { ok: true, groups: groups };
  }

  function removeFromStack(playbackId) {
    const groups = removeTrackFromAllGroups(playbackId, loadGroups());
    saveGroups(groups);
    return groups;
  }

  /** Move a track within its group (for arranging order). */
  function reorderStack(fromPlaybackId, toIndex, groupId) {
    const groups = loadGroups();
    const group = groupId
      ? groups.find(function (g) { return g.id === groupId; })
      : findGroupForTrack(fromPlaybackId);
    if (!group) return groups;

    const list = group.tracks.slice();
    const fromIndex = list.findIndex(function (t) {
      return t.playbackId === fromPlaybackId;
    });
    if (fromIndex < 0) return groups;

    const moved = list.splice(fromIndex, 1)[0];
    let insertAt = toIndex;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > list.length) insertAt = list.length;
    if (fromIndex < insertAt) insertAt -= 1;
    list.splice(insertAt, 0, moved);
    group.tracks = list;
    saveGroups(groups);
    return groups;
  }

  function clearStack() {
    saveGroups([]);
    window.localStorage.removeItem(STACK_META_KEY);
    cloudPut(CLOUD_STACK_META_KEY, emptyMeta());
    return [];
  }

  function thumbnailUrl(playbackId) {
    if (!playbackId) return '';
    return 'https://image.mux.com/' + playbackId + '/thumbnail.webp?time=1';
  }

  function songPageUrl(item) {
    const sv = window.BurnfolderSongVersions;
    if (sv && item && item.playbackId) {
      const catalog = buildStreamSongCatalog([]);
      const song = sv.resolvePlaybackInCatalog(catalog, item.playbackId);
      if (song && song.title) {
        return sv.getStreamSongHref(song, item.playbackId);
      }
    }
    const id = item.playbackId || item.muxAssetId;
    if (!id) return 'stream-song.html';
    return 'stream-song.html?p=' + encodeURIComponent(id);
  }

  function albumPageUrl(albumId) {
    const id = String(albumId || '').trim();
    if (!id) return 'stream-album.html';
    return 'stream-album.html?album=' + encodeURIComponent(id);
  }

  function buildStreamSongCatalog(libraryCache) {
    const sv = window.BurnfolderSongVersions;
    if (!sv) return Array.isArray(window.allSongs) ? window.allSongs.slice() : [];
    return sv.mergeSongCatalog(sv.getSiteCatalog(window), libraryCache || [], muxFileLabel);
  }

  function entryPageHref(song) {
    if (!song) return '';
    let page = song.page != null ? String(song.page).trim() : '';
    if (!page || !/^\d+\.\d+\.\d+$/.test(page)) {
      const hit = (window.allSongs || []).find(function (row) {
        return row && row.playbackId === song.playbackId;
      });
      if (hit && hit.page) page = String(hit.page).trim();
    }
    if (!/^\d+\.\d+\.\d+$/.test(page)) return '';
    return '../' + page + '.html';
  }

  function stackPageUrl() {
    return 'stream-stack.html';
  }

  function editorHrefSingle(item) {
    const draftId = window.localStorage.getItem(LAST_DRAFT_KEY);
    const base = draftId ? 'index.html?id=' + encodeURIComponent(draftId) : 'index.html';
    const url = new URL(base, window.location.href);
    if (item.muxAssetId || item.playbackId) {
      url.searchParams.set('insertAsset', item.muxAssetId || item.playbackId);
    }
    return url.pathname + url.search;
  }

  function editorHrefForStack() {
    const draftId = window.localStorage.getItem(LAST_DRAFT_KEY);
    const base = draftId ? 'index.html?id=' + encodeURIComponent(draftId) : 'index.html';
    const url = new URL(base, window.location.href);
    url.searchParams.set('createStack', '1');
    return url.pathname + url.search;
  }

  function pushStackToEntry(tracks, meta) {
    const stack = tracks || loadStack();
    if (!stack.length) return false;
    const m = meta || loadStackMeta();
    const payload = {
      title: m.title || '',
      coverArt: m.coverArt || '',
      coverAlt: m.coverAlt || '',
      tracks: stack.map(function (t) {
        return { title: t.title, playbackId: t.playbackId };
      })
    };
    window.localStorage.setItem(PENDING_STACK_KEY, JSON.stringify(payload));
    cloudPut(CLOUD_PENDING_STACK_KEY, payload);
    window.location.href = editorHrefForStack();
    return true;
  }

  function readPendingStack() {
    const cs = window.BurnfolderCloudState;
    if (cs && cs.get) {
      return cs.get(CLOUD_PENDING_STACK_KEY).then(function (cloud) {
        if (cloud && Array.isArray(cloud.tracks) && cloud.tracks.length) return cloud;
        try {
          const raw = window.localStorage.getItem(PENDING_STACK_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch (e) {
          return null;
        }
      }).catch(function () {
        try {
          const raw = window.localStorage.getItem(PENDING_STACK_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch (e2) {
          return null;
        }
      });
    }
    try {
      const raw = window.localStorage.getItem(PENDING_STACK_KEY);
      return Promise.resolve(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function clearPendingStack() {
    window.localStorage.removeItem(PENDING_STACK_KEY);
    cloudPut(CLOUD_PENDING_STACK_KEY, null);
  }

  function findInLibrary(cache, id) {
    return (cache || []).find(function (item) {
      return item.playbackId === id || item.muxAssetId === id;
    });
  }

  window.BurnfolderStreamShared = {
    STACK_KEY: STACK_KEY,
    MUX_MIME: MUX_MIME,
    resolveMediaKind: resolveMediaKind,
    isVideoItem: isVideoItem,
    canPlayAsVideo: canPlayAsVideo,
    normalizeStreamItem: normalizeStreamItem,
    normalizeLibrary: normalizeLibrary,
    formatDuration: formatDuration,
    createMuxVideoPlayer: createMuxVideoPlayer,
    stopStreamAudio: stopStreamAudio,
    mountStreamVideo: mountStreamVideo,
    playStreamVideo: playStreamVideo,
    getStreamVideoElement: getStreamVideoElement,
    clearStreamVideo: clearStreamVideo,
    loadStack: loadStack,
    saveStack: saveStack,
    loadGroups: loadGroups,
    saveGroups: saveGroups,
    findGroupById: findGroupById,
    findGroupForTrack: findGroupForTrack,
    isInAnyGroup: isInAnyGroup,
    allGroupedPlaybackIds: allGroupedPlaybackIds,
    groupedPlaybackIds: groupedPlaybackIds,
    loadStackMeta: loadStackMeta,
    saveStackMeta: saveStackMeta,
    addToGroup: addToGroup,
    addToStack: addToStack,
    dropOntoSong: dropOntoSong,
    removeFromStack: removeFromStack,
    reorderStack: reorderStack,
    clearStack: clearStack,
    thumbnailUrl: thumbnailUrl,
    songPageUrl: songPageUrl,
    albumPageUrl: albumPageUrl,
    buildStreamSongCatalog: buildStreamSongCatalog,
    entryPageHref: entryPageHref,
    stackPageUrl: stackPageUrl,
    editorHrefSingle: editorHrefSingle,
    pushStackToEntry: pushStackToEntry,
    readPendingStack: readPendingStack,
    clearPendingStack: clearPendingStack,
    findInLibrary: findInLibrary,
    muxFileLabel: muxFileLabel,
    stackItemFromLibrary: stackItemFromLibrary,
    hydrateStackFromCloud: hydrateStackFromCloud
  };

  // Pull the latest project from the personal cloud on load (waits for studio
  // auth internally), so the album you built on another device shows up here.
  if (window.BurnfolderCloudState) {
    hydrateStackFromCloud();
  }
})();
