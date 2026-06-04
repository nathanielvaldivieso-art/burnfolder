(function () {
  'use strict';

  const STACK_KEY = 'burnfolderStreamStack';
  const STACK_META_KEY = 'burnfolderStreamStackMeta';
  const PENDING_STACK_KEY = 'burnfolderPendingStack';
  const LAST_DRAFT_KEY = 'burnfolderStudioLastDraftId';
  const MUX_MIME = 'application/x-burnfolder-mux-playback';
  const CLOUD_STACK_KEY = 'stack';
  const CLOUD_STACK_META_KEY = 'stackMeta';

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
      cs.get(CLOUD_STACK_KEY).catch(function () { return undefined; }),
      cs.get(CLOUD_STACK_META_KEY).catch(function () { return undefined; })
    ]).then(function (results) {
      const stack = results[0];
      const meta = results[1];
      let stackChanged = false;
      let metaChanged = false;

      if (Array.isArray(stack)) {
        window.localStorage.setItem(STACK_KEY, JSON.stringify(stack));
        stackChanged = true;
      } else if (stack === null) {
        const localStack = loadStack();
        if (localStack.length) cloudPut(CLOUD_STACK_KEY, localStack);
      }

      if (meta && typeof meta === 'object') {
        window.localStorage.setItem(STACK_META_KEY, JSON.stringify(meta));
        metaChanged = true;
      } else if (meta === null) {
        const localMeta = loadStackMeta();
        if (localMeta.title || localMeta.coverArt) cloudPut(CLOUD_STACK_META_KEY, localMeta);
      }

      if (stackChanged) window.dispatchEvent(new CustomEvent('burnfolder-stack-changed'));
      if (metaChanged) window.dispatchEvent(new CustomEvent('burnfolder-stack-meta-changed'));
    });
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

  function setHiddenAudioPlayer(enabled) {
    const audio = document.getElementById('activeMuxPlayer');
    if (!audio) return;
    if (enabled) {
      audio.removeAttribute('hidden');
      audio.style.cssText = 'width:0;height:0;position:absolute;left:-9999px;';
    } else {
      audio.pause();
      audio.removeAttribute('playback-id');
      audio.setAttribute('hidden', '');
      audio.style.cssText = '';
    }
  }

  function stopStreamAudio() {
    const audio = document.getElementById('activeMuxPlayer');
    if (audio) {
      audio.pause();
      audio.removeAttribute('playback-id');
    }
    if (window.BurnfolderStreamPlayer && window.BurnfolderStreamPlayer.stop) {
      window.BurnfolderStreamPlayer.stop();
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
    stopStreamAudio();
    setHiddenAudioPlayer(false);

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
    try {
      const raw = window.localStorage.getItem(STACK_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveStack(tracks) {
    window.localStorage.setItem(STACK_KEY, JSON.stringify(tracks));
    cloudPut(CLOUD_STACK_KEY, tracks);
    window.dispatchEvent(new CustomEvent('burnfolder-stack-changed'));
  }

  /** Album-style metadata for the current stack: project name + cover art. */
  function loadStackMeta() {
    try {
      const raw = window.localStorage.getItem(STACK_META_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object') {
        return {
          title: typeof parsed.title === 'string' ? parsed.title : '',
          coverArt: typeof parsed.coverArt === 'string' ? parsed.coverArt : '',
          coverAlt: typeof parsed.coverAlt === 'string' ? parsed.coverAlt : ''
        };
      }
    } catch (e) {
      /* fall through */
    }
    return { title: '', coverArt: '', coverAlt: '' };
  }

  function saveStackMeta(meta) {
    const safe = {
      title: meta && typeof meta.title === 'string' ? meta.title : '',
      coverArt: meta && typeof meta.coverArt === 'string' ? meta.coverArt : '',
      coverAlt: meta && typeof meta.coverAlt === 'string' ? meta.coverAlt : ''
    };
    window.localStorage.setItem(STACK_META_KEY, JSON.stringify(safe));
    cloudPut(CLOUD_STACK_META_KEY, safe);
    window.dispatchEvent(new CustomEvent('burnfolder-stack-meta-changed'));
    return safe;
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

  function addToStack(item, tracks) {
    const list = tracks || loadStack();
    if (!item || !item.playbackId) return { tracks: list, message: '' };
    if (isVideoItem(item)) {
      return { tracks: list, ok: false };
    }
    if (list.some(function (t) {
      return t.playbackId === item.playbackId;
    })) {
      return { tracks: list, ok: false };
    }
    const next = list.concat([stackItemFromLibrary(item)]);
    saveStack(next);
    return { tracks: next, ok: true };
  }

  /** Drag a song onto another: start or extend the stack playlist. */
  function dropOntoSong(draggedItem, targetItem, tracks) {
    const list = (tracks || loadStack()).slice();
    if (!draggedItem || !targetItem || !draggedItem.playbackId || !targetItem.playbackId) {
      return { tracks: list, ok: false };
    }
    if (draggedItem.playbackId === targetItem.playbackId) {
      return { tracks: list, ok: false };
    }
    if (isVideoItem(draggedItem) || isVideoItem(targetItem)) {
      return { tracks: list, ok: false };
    }

    const dragged = stackItemFromLibrary(draggedItem);
    const target = stackItemFromLibrary(targetItem);
    let next = list.filter(function (t) {
      return t.playbackId !== dragged.playbackId;
    });
    const targetIdx = next.findIndex(function (t) {
      return t.playbackId === target.playbackId;
    });

    if (!next.length) {
      next = [target, dragged];
    } else if (targetIdx >= 0) {
      next.splice(targetIdx + 1, 0, dragged);
    } else {
      next.push(target);
      next.push(dragged);
    }

    saveStack(next);
    return { tracks: next, ok: true };
  }

  function removeFromStack(playbackId, tracks) {
    const list = (tracks || loadStack()).filter(function (t) {
      return t.playbackId !== playbackId;
    });
    saveStack(list);
    return list;
  }

  /** Move a stack track to a new index (for arranging project order). */
  function reorderStack(fromPlaybackId, toIndex, tracks) {
    const list = (tracks || loadStack()).slice();
    const fromIndex = list.findIndex(function (t) {
      return t.playbackId === fromPlaybackId;
    });
    if (fromIndex < 0) return list;
    const moved = list.splice(fromIndex, 1)[0];
    let insertAt = toIndex;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > list.length) insertAt = list.length;
    if (fromIndex < insertAt) insertAt -= 1;
    list.splice(insertAt, 0, moved);
    saveStack(list);
    return list;
  }

  function clearStack() {
    saveStack([]);
    window.localStorage.removeItem(STACK_META_KEY);
    cloudPut(CLOUD_STACK_META_KEY, { title: '', coverArt: '', coverAlt: '' });
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
    window.localStorage.setItem(
      PENDING_STACK_KEY,
      JSON.stringify({
        title: m.title || '',
        coverArt: m.coverArt || '',
        coverAlt: m.coverAlt || '',
        tracks: stack.map(function (t) {
          return { title: t.title, playbackId: t.playbackId };
        })
      })
    );
    window.location.href = editorHrefForStack();
    return true;
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
    loadStackMeta: loadStackMeta,
    saveStackMeta: saveStackMeta,
    addToStack: addToStack,
    dropOntoSong: dropOntoSong,
    removeFromStack: removeFromStack,
    reorderStack: reorderStack,
    clearStack: clearStack,
    thumbnailUrl: thumbnailUrl,
    songPageUrl: songPageUrl,
    buildStreamSongCatalog: buildStreamSongCatalog,
    entryPageHref: entryPageHref,
    stackPageUrl: stackPageUrl,
    editorHrefSingle: editorHrefSingle,
    pushStackToEntry: pushStackToEntry,
    findInLibrary: findInLibrary,
    muxFileLabel: muxFileLabel,
    hydrateStackFromCloud: hydrateStackFromCloud
  };

  // Pull the latest project from the personal cloud on load (waits for studio
  // auth internally), so the album you built on another device shows up here.
  if (window.BurnfolderCloudState) {
    hydrateStackFromCloud();
  }
})();
