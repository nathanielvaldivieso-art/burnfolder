(function () {
  'use strict';

  const listRoot = document.getElementById('streamList');
  const videoStage = document.getElementById('streamVideoStage');
  const filterRoot = document.getElementById('streamFilters');
  const statusEl = document.getElementById('streamStatus');
  const uploadRoot = document.getElementById('streamUpload');
  const countEl = document.getElementById('streamCount');

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
  const MUX_MIME = shared.MUX_MIME;

  let libraryCache = [];
  let streamVersionCycle = null;
  let activeFilter = 'all';
  let stackDock = null;
  let dragMuxId = null;
  let expandedVideoId = null;
  let albumExpanded = true;
  let albumDragId = null;
  const ALBUM_TRACK_MIME = 'application/x-burnfolder-album-track';

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || '';
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
    const log = loadPlayLog();
    let best = 0;
    [item && item.playbackId, selectedPlayableItem(item).playbackId].forEach(function (id) {
      if (id && log[id] && log[id] > best) best = log[id];
    });
    return best;
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

  function stackGroupKeys() {
    const keys = new Set();
    shared.loadStack().forEach(function (t) {
      if (versionsApi) keys.add(versionsApi.getTrackGroupKey(t.title || ''));
      else keys.add(t.playbackId);
    });
    return keys;
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
      const kind = shared.resolveMediaKind(item);
      if (activeFilter === 'all') return true;
      return kind === activeFilter;
    });
  }

  function listCounts() {
    const items = filteredAssets();
    const audio = dedupeAudioItems(
      items.filter(function (item) {
        return !shared.isVideoItem(item);
      })
    );
    const video = items.filter(shared.isVideoItem);
    if (activeFilter === 'audio') return audio.length;
    if (activeFilter === 'video') return video.length;
    return audio.length + video.length;
  }

  function toggleAudioItem(item) {
    if (!player || !item) return;
    if (expandedVideoId) {
      closeExpandedVideo();
    }
    const playable = selectedPlayableItem(item);
    const id = playable.playbackId;
    if (player.isActivePlaybackId(id)) {
      player.togglePause();
      return;
    }
    recordPlay(id);
    player.playItem(playable);
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
        if (stackDock) stackDock.refresh();
        return refreshLibrary({ silent: true });
      })
      .then(function () {
        setStatus('');
      })
      .catch(function (err) {
        setStatus(err.message || 'delete failed');
      });
  }

  function clearRowDropMarkers() {
    if (!listRoot) return;
    listRoot.querySelectorAll('.studio-stream-row, .studio-stream-track-item').forEach(function (el) {
      el.classList.remove('is-stack-drop-target');
    });
  }

  function attachSongDropTargets(row, item) {
    row.addEventListener('dragover', function (event) {
      if (Array.from(event.dataTransfer.types).indexOf(MUX_MIME) < 0) return;
      const draggedId = event.dataTransfer.getData(MUX_MIME) || dragMuxId;
      if (!draggedId || draggedId === item.playbackId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      clearRowDropMarkers();
      row.classList.add('is-stack-drop-target');
    });

    row.addEventListener('dragleave', function (event) {
      if (row.contains(event.relatedTarget)) return;
      row.classList.remove('is-stack-drop-target');
    });

    row.addEventListener('drop', function (event) {
      if (Array.from(event.dataTransfer.types).indexOf(MUX_MIME) < 0) return;
      event.preventDefault();
      event.stopPropagation();
      clearRowDropMarkers();
      const draggedId = event.dataTransfer.getData(MUX_MIME) || dragMuxId;
      if (!draggedId || draggedId === item.playbackId) return;
      const dragged = shared.findInLibrary(libraryCache, draggedId);
      if (!dragged) return;
      shared.dropOntoSong(dragged, item);
      if (stackDock) stackDock.refresh();
      renderList();
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
    listRoot.querySelectorAll('.studio-stream-video-item').forEach(function (li) {
      const id = li.getAttribute('data-playback-id');
      const on = !!id && id === expandedVideoId;
      li.classList.toggle('is-expanded', on);
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

  function preloadTrackDuration(durEl, playbackId) {
    if (!durEl || !playbackId) return;
    const tmp = document.createElement('mux-player');
    tmp.setAttribute('playback-id', playbackId);
    tmp.style.display = 'none';
    tmp.muted = true;
    document.body.appendChild(tmp);
    tmp.addEventListener(
      'loadedmetadata',
      function () {
        const d = tmp.duration;
        if (d && !isNaN(d)) {
          const m = Math.floor(d / 60);
          const s = Math.floor(d % 60);
          durEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        }
        tmp.remove();
      },
      { once: true }
    );
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

  function buildAudioTrackItem(item, trackNum) {
    const seedSong = catalogSongFromItem(item);

    const li = document.createElement('li');
    li.className = 'music-tracklist-item studio-stream-track-item';

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
      const inStack = shared.loadStack().some(function (t) {
        return t.playbackId === playable.playbackId;
      });
      li.classList.toggle('is-in-stack', inStack);
      row.dataset.playbackId = playable.playbackId;
      row.setAttribute('aria-label', 'Play ' + label);
      name.textContent = label;
      dur.textContent = shared.formatDuration(playable.duration) || '--:--';
      row.classList.toggle('is-active', !!(player && player.isActivePlaybackId(playable.playbackId)));
      row.classList.toggle('is-playing', !!(player && player.isPlayingPlaybackId(playable.playbackId)));
      if (!shared.formatDuration(playable.duration) && !dur.dataset.loaded) {
        preloadTrackDuration(dur, playable.playbackId);
        dur.dataset.loaded = '1';
      }
    }

    syncRow();

    row.addEventListener('click', function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        window.location.href = shared.songPageUrl(selectedPlayableItem(item));
        return;
      }
      toggleAudioItem(item);
    });

    row.appendChild(name);
    row.appendChild(dur);

    let longPressTimer = null;
    row.addEventListener('touchstart', function () {
      longPressTimer = window.setTimeout(function () {
        shared.addToStack(selectedPlayableItem(item));
        renderList();
        if (stackDock) stackDock.refresh();
        const dock = document.getElementById('streamStackDock');
        if (dock) dock.classList.add('is-drop-target');
        window.setTimeout(function () {
          if (dock) dock.classList.remove('is-drop-target');
        }, 400);
      }, 480);
    }, { passive: true });
    row.addEventListener('touchend', function () {
      if (longPressTimer) window.clearTimeout(longPressTimer);
    });
    row.addEventListener('touchmove', function () {
      if (longPressTimer) window.clearTimeout(longPressTimer);
    });

    li.draggable = true;
    li.addEventListener('dragstart', function (event) {
      dragMuxId = selectedPlayableItem(item).playbackId;
      event.dataTransfer.setData(MUX_MIME, selectedPlayableItem(item).playbackId);
      event.dataTransfer.effectAllowed = 'copy';
      li.classList.add('is-dragging');
      const dock = document.getElementById('streamStackDock');
      if (dock) dock.classList.add('is-drag-active');
    });
    li.addEventListener('dragend', function () {
      dragMuxId = null;
      li.classList.remove('is-dragging');
      clearRowDropMarkers();
      const dock = document.getElementById('streamStackDock');
      if (dock) dock.classList.remove('is-drag-active', 'is-drop-target');
    });

    attachSongDropTargets(li, selectedPlayableItem(item));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'studio-stream-track-delete';
    deleteBtn.textContent = 'delete';
    deleteBtn.setAttribute('aria-label', 'Delete from Mux');
    deleteBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      deleteSongFromMux(item);
    });

    li.appendChild(num);
    li.appendChild(row);
    li.appendChild(deleteBtn);
    return li;
  }

  function buildVideoTrackItem(item, trackNum) {
    const isExpanded = expandedVideoId === item.playbackId;
    const fullTitle = shared.muxFileLabel(item);
    const label = versionsApi
      ? versionsApi.stripTrailingDate(fullTitle) || fullTitle
      : fullTitle;
    const duration = shared.formatDuration(item.duration);

    const li = document.createElement('li');
    li.className = 'music-tracklist-item studio-stream-track-item studio-stream-video-item';
    li.setAttribute('data-playback-id', item.playbackId || '');
    if (isExpanded) li.classList.add('is-expanded');

    const num = document.createElement('span');
    num.className = 'music-track-num';
    num.textContent = String(trackNum);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'music-track-row';
    row.dataset.playbackId = item.playbackId || '';
    row.setAttribute('aria-label', (isExpanded ? 'Close ' : 'Play ') + label);

    const name = document.createElement('span');
    name.className = 'music-track-title';
    name.textContent = label;

    const flag = document.createElement('span');
    flag.className = 'studio-stream-video-flag';
    flag.textContent = '▶';
    flag.setAttribute('aria-hidden', 'true');
    name.appendChild(flag);

    const dur = document.createElement('span');
    dur.className = 'music-track-duration';
    dur.textContent = duration || '--:--';

    row.appendChild(name);
    row.appendChild(dur);

    row.addEventListener('click', function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        window.location.href = shared.songPageUrl(item);
        return;
      }
      toggleVideoExpand(item);
    });

    li.appendChild(num);
    li.appendChild(row);
    return li;
  }

  function albumItems() {
    return shared.loadStack().map(function (t) {
      return shared.findInLibrary(libraryCache, t.playbackId) || t;
    });
  }

  function playAlbum(index) {
    if (!player) return;
    const items = albumItems();
    if (!items.length) return;
    if (expandedVideoId) closeExpandedVideo();
    const started = items[index || 0];
    if (started && started.playbackId) recordPlay(started.playbackId);
    player.playQueue(items, index || 0);
  }

  function clearAlbumDropMarkers() {
    if (!listRoot) return;
    listRoot.querySelectorAll('.studio-stream-album-track').forEach(function (el) {
      el.classList.remove('is-drop-before', 'is-drop-after');
    });
  }

  function buildAlbumTrackItem(track, index) {
    const li = document.createElement('li');
    li.className = 'music-tracklist-item studio-stream-track-item studio-stream-album-track';
    li.draggable = true;

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
    row.dataset.playbackId = track.playbackId || '';
    const label = track.title || 'untitled';
    row.setAttribute('aria-label', 'Play ' + label);

    const name = document.createElement('span');
    name.className = 'music-track-title';
    name.textContent = label;

    const dur = document.createElement('span');
    dur.className = 'music-track-duration';
    const libItem = shared.findInLibrary(libraryCache, track.playbackId);
    dur.textContent = (libItem && shared.formatDuration(libItem.duration)) || '--:--';

    row.appendChild(name);
    row.appendChild(dur);
    row.classList.toggle('is-active', !!(player && player.isActivePlaybackId(track.playbackId)));
    row.classList.toggle('is-playing', !!(player && player.isPlayingPlaybackId(track.playbackId)));
    row.addEventListener('click', function () {
      playAlbum(index);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'studio-stream-album-track-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', 'Remove from project');
    removeBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      shared.removeFromStack(track.playbackId);
      if (stackDock) stackDock.refresh();
      renderList();
    });

    li.addEventListener('dragstart', function (event) {
      albumDragId = track.playbackId;
      event.dataTransfer.setData(ALBUM_TRACK_MIME, track.playbackId);
      event.dataTransfer.effectAllowed = 'move';
      li.classList.add('is-dragging');
    });
    li.addEventListener('dragend', function () {
      albumDragId = null;
      li.classList.remove('is-dragging');
      clearAlbumDropMarkers();
    });
    li.addEventListener('dragover', function (event) {
      if (Array.from(event.dataTransfer.types).indexOf(ALBUM_TRACK_MIME) < 0) return;
      if (albumDragId === track.playbackId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      clearAlbumDropMarkers();
      const rect = li.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      li.classList.add(before ? 'is-drop-before' : 'is-drop-after');
    });
    li.addEventListener('drop', function (event) {
      if (Array.from(event.dataTransfer.types).indexOf(ALBUM_TRACK_MIME) < 0) return;
      event.preventDefault();
      event.stopPropagation();
      const draggedId = event.dataTransfer.getData(ALBUM_TRACK_MIME) || albumDragId;
      clearAlbumDropMarkers();
      if (!draggedId || draggedId === track.playbackId) return;
      const rect = li.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      let targetIndex = index;
      if (!before) targetIndex += 1;
      shared.reorderStack(draggedId, targetIndex);
      if (stackDock) stackDock.refresh();
      renderList();
    });

    li.appendChild(handle);
    li.appendChild(num);
    li.appendChild(row);
    li.appendChild(removeBtn);
    return li;
  }

  function applyCoverPreview(coverBtn, meta) {
    if (!coverBtn) return;
    coverBtn.innerHTML = '';
    if (meta.coverArt) {
      coverBtn.classList.remove('is-empty');
      const img = document.createElement('img');
      img.src = meta.coverArt;
      img.alt = meta.coverAlt || meta.title || 'cover art';
      coverBtn.appendChild(img);
    } else {
      coverBtn.classList.add('is-empty');
    }
    coverBtn.setAttribute('aria-label', meta.coverArt ? 'Change cover art' : 'Add cover art');
  }

  function buildAlbumGroup() {
    const tracks = shared.loadStack();
    if (!tracks.length) return null;
    const meta = shared.loadStackMeta();

    const wrap = document.createElement('section');
    wrap.className = 'studio-stream-album-group';
    if (albumExpanded) wrap.classList.add('is-expanded');

    const head = document.createElement('div');
    head.className = 'studio-stream-album-head';

    const coverBtn = document.createElement('button');
    coverBtn.type = 'button';
    coverBtn.className = 'studio-stream-album-cover';
    applyCoverPreview(coverBtn, meta);

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
      const reader = new FileReader();
      reader.onload = function () {
        const m = shared.loadStackMeta();
        m.coverArt = String(reader.result || '');
        m.coverAlt = m.title || file.name || 'cover art';
        shared.saveStackMeta(m);
      };
      reader.readAsDataURL(file);
    });

    const info = document.createElement('span');
    info.className = 'studio-stream-album-info';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'studio-stream-album-name-input';
    nameInput.placeholder = 'name this project';
    nameInput.value = meta.title || '';
    nameInput.spellcheck = false;
    nameInput.autocomplete = 'off';
    nameInput.setAttribute('aria-label', 'Project name');
    nameInput.addEventListener('input', function () {
      const m = shared.loadStackMeta();
      m.title = nameInput.value;
      if (m.coverArt) m.coverAlt = m.title || m.coverAlt || 'cover art';
      shared.saveStackMeta(m);
    });
    const metaEl = document.createElement('span');
    metaEl.className = 'studio-stream-album-meta';
    metaEl.textContent = 'project · ' + tracks.length + ' track' + (tracks.length === 1 ? '' : 's');
    info.appendChild(nameInput);
    info.appendChild(metaEl);

    const actions = document.createElement('span');
    actions.className = 'studio-stream-album-actions';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'studio-stream-album-play';
    playBtn.setAttribute('aria-label', 'Play project');
    playBtn.textContent = '▶';
    playBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      playAlbum(0);
    });

    const entryBtn = document.createElement('button');
    entryBtn.type = 'button';
    entryBtn.className = 'studio-stream-album-action';
    entryBtn.textContent = 'entry';
    entryBtn.setAttribute('aria-label', 'Send project to a new entry');
    entryBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      shared.pushStackToEntry(shared.loadStack(), shared.loadStackMeta());
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'studio-stream-album-action';
    clearBtn.textContent = 'clear';
    clearBtn.setAttribute('aria-label', 'Clear project');
    clearBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      if (!window.confirm('Clear this project? The songs stay in your library.')) return;
      shared.clearStack();
      renderList();
    });

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'studio-stream-album-toggle';
    toggle.setAttribute('aria-label', 'Toggle track list');
    toggle.textContent = '▾';
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      albumExpanded = !albumExpanded;
      wrap.classList.toggle('is-expanded', albumExpanded);
    });

    actions.appendChild(playBtn);
    actions.appendChild(entryBtn);
    actions.appendChild(clearBtn);
    actions.appendChild(toggle);

    head.appendChild(coverBtn);
    head.appendChild(coverInput);
    head.appendChild(info);
    head.appendChild(actions);

    const ol = document.createElement('ol');
    ol.className = 'music-tracklist entry-audio-list studio-stream-album-tracks';
    tracks.forEach(function (track, index) {
      ol.appendChild(buildAlbumTrackItem(track, index));
    });

    wrap.addEventListener('dragover', function (event) {
      if (Array.from(event.dataTransfer.types).indexOf(MUX_MIME) < 0) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      wrap.classList.add('is-drop-target');
    });
    wrap.addEventListener('dragleave', function (event) {
      if (wrap.contains(event.relatedTarget)) return;
      wrap.classList.remove('is-drop-target');
    });
    wrap.addEventListener('drop', function (event) {
      if (Array.from(event.dataTransfer.types).indexOf(MUX_MIME) < 0) return;
      event.preventDefault();
      wrap.classList.remove('is-drop-target');
      const id = event.dataTransfer.getData(MUX_MIME) || dragMuxId;
      const item = shared.findInLibrary(libraryCache, id);
      if (!item) return;
      shared.addToStack(item);
      renderList();
    });

    wrap.appendChild(head);
    wrap.appendChild(ol);
    return wrap;
  }

  function updateAlbumMeta() {
    if (!listRoot) return;
    const group = listRoot.querySelector('.studio-stream-album-group');
    if (!group) {
      renderList();
      return;
    }
    const meta = shared.loadStackMeta();
    const nameInput = group.querySelector('.studio-stream-album-name-input');
    const typingName = nameInput && document.activeElement === nameInput;
    if (nameInput && !typingName) nameInput.value = meta.title || '';
    if (typingName) return;
    applyCoverPreview(group.querySelector('.studio-stream-album-cover'), meta);
  }

  function renderList() {
    if (!listRoot) return;
    const items = filteredAssets();
    listRoot.innerHTML = '';
    let audioItems = dedupeAudioItems(
      items.filter(function (item) {
        return !shared.isVideoItem(item);
      })
    );

    // Songs that are now in the project live in the album group — hide them
    // from the flat list so each track shows in exactly one place.
    const groupedKeys = stackGroupKeys();
    if (groupedKeys.size) {
      audioItems = audioItems.filter(function (item) {
        return !groupedKeys.has(groupKeyForItem(item));
      });
    }

    // Most recently played first; never-played keep their existing order.
    audioItems.sort(function (a, b) {
      return playRecency(b) - playRecency(a);
    });

    const videoItems = items.filter(shared.isVideoItem);
    listRoot.classList.toggle('has-video', videoItems.length > 0);

    if (!libraryCache.length) {
      listRoot.innerHTML = '<p class="studio-empty">+</p>';
      return;
    }
    if (!items.length) {
      listRoot.innerHTML = '<p class="studio-empty">—</p>';
      return;
    }

    if (activeFilter !== 'video') {
      const albumGroup = buildAlbumGroup();
      if (albumGroup) listRoot.appendChild(albumGroup);
    }

    if (audioItems.length || videoItems.length) {
      const tracklist = document.createElement('ol');
      tracklist.className = 'music-tracklist entry-audio-list studio-stream-tracklist';
      let n = 0;
      audioItems.forEach(function (item) {
        tracklist.appendChild(buildAudioTrackItem(item, (n += 1)));
      });
      videoItems.forEach(function (item) {
        tracklist.appendChild(buildVideoTrackItem(item, (n += 1)));
      });
      listRoot.appendChild(tracklist);
    }

    syncStreamTracklistPlayback();
    syncVideoStage();
  }

  function mountFilters() {
    if (!filterRoot) return;
    filterRoot.innerHTML = '';
    [
      { id: 'all', label: 'all' },
      { id: 'audio', label: '♫' },
      { id: 'video', label: '▶' }
    ].forEach(function (filter) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'studio-stream-filter page-nav';
      btn.textContent = filter.label;
      btn.setAttribute('aria-label', filter.id);
      if (activeFilter === filter.id) btn.classList.add('is-active');
      btn.addEventListener('click', function () {
        activeFilter = filter.id;
        closeExpandedVideo();
        mountFilters();
        renderList();
      });
      filterRoot.appendChild(btn);
    });
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
    syncNowPlayingCatalog();
    const n = listCounts();
    if (countEl) countEl.textContent = n ? n + (n === 1 ? ' song' : ' songs') : '';
    if (statusMsg !== undefined) setStatus(statusMsg);
    mountFilters();
    renderList();
    if (stackDock) stackDock.refresh();
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
    if (countEl) {
      const n = listCounts();
      countEl.textContent = n ? n + (n === 1 ? ' song' : ' songs') : '';
    }
    setStatus('');
    mountFilters();
    renderList();
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

  if (uploadRoot && window.BurnfolderCloudUI) {
    window.BurnfolderCloudUI.mountUploadZone(uploadRoot, {
      onStatus: setStatus,
      onFileSuccess: prependUploadedAsset,
      onUploaded: function () {
        refreshLibrary({ silent: true });
      }
    });
  }

  if (window.BurnfolderStreamStackDock) {
    stackDock = window.BurnfolderStreamStackDock.mount({
      player: player,
      getLibrary: function () {
        return libraryCache;
      }
    });
  }

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

  document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
    link.classList.toggle('is-active', link.getAttribute('data-nav') === 'stream');
  });

  refreshLibrary();
})();
