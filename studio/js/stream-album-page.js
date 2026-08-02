/**
 * Album detail — collection interior (OS-style folder for audio).
 * Opened from Clips album blocks via ?album=<groupId> (also accepts ?id=).
 *
 * Sort rules: duplicate titles collapse to one version-stacked row (catalog
 * newest plays); unique songs keep curated stack order and drag-reorder as
 * units. Continuous play via playQueue.
 */
(function () {
  'use strict';

  const shared = window.BurnfolderStreamShared;
  const muxLib = window.BurnfolderStudioMux;
  const player = window.BurnfolderStreamPlayer;
  const versionsApi = window.BurnfolderSongVersions;

  let albumId = '';
  let main = null;
  let mount = null;
  let statusEl = null;
  let designBtn = null;
  let libraryCache = [];
  let songCatalog = [];
  let group = null;
  let listenersBound = false;
  let dndBound = false;

  function readParams() {
    const params = new URLSearchParams(window.location.search);
    albumId = (params.get('album') || params.get('id') || '').trim();
    if (!albumId) {
      try {
        albumId = String(sessionStorage.getItem('burnfolderOpenAlbumId') || '').trim();
        if (albumId) sessionStorage.removeItem('burnfolderOpenAlbumId');
      } catch (e) {
        /* noop */
      }
    }
    if (!albumId && window.history && history.state && history.state.albumId) {
      albumId = String(history.state.albumId || '').trim();
    }
  }

  function bindDomRefs() {
    main = document.getElementById('albumMain');
    mount = document.getElementById('albumPlayerMount');
    statusEl = document.getElementById('albumStatus');
    designBtn = document.getElementById('albumDesignBtn');
  }

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

  function resolveStackTrackItem(track) {
    if (!track || !track.playbackId) return track;
    const libItem = shared.findInLibrary(libraryCache, track.playbackId) || track;
    if (!versionsApi) return libItem;
    const newest = versionsApi.resolveNewestSongInCatalog(
      songCatalog,
      { title: track.title || itemLabel(libItem), playbackId: libItem.playbackId },
      itemLabel
    );
    if (!newest || !newest.playbackId) return libItem;
    return shared.findInLibrary(libraryCache, newest.playbackId) || libItem;
  }

  function groupKeyForTrack(track) {
    const resolved = resolveStackTrackItem(track);
    const title = itemLabel(resolved) || (track && track.title) || '';
    if (versionsApi && versionsApi.getTrackGroupKey) {
      return versionsApi.getTrackGroupKey(title) || (resolved && resolved.playbackId) || '';
    }
    return (resolved && resolved.playbackId) || (track && track.playbackId) || '';
  }

  function versionCountForKey(key) {
    if (!versionsApi || !key) return 1;
    const versions = versionsApi.collectVersionsByGroupKey(songCatalog, key);
    return versions.length || 1;
  }

  function displayTitleForRow(row) {
    const full = itemLabel(row.resolved) || (row.track && row.track.title) || 'untitled';
    if (versionsApi && versionsApi.stripTrailingDate) {
      return versionsApi.stripTrailingDate(full) || full;
    }
    return full;
  }

  /**
   * Unique songs in collection order. Duplicate titles collapse (newest wins);
   * version count comes from the catalog like the music page.
   */
  function albumSongRowsForGroup(targetGroup) {
    if (!targetGroup) return [];
    const rows = [];
    const byKey = new Map();

    (targetGroup.tracks || []).forEach(function (track) {
      if (!track || !track.playbackId) return;
      const resolved = resolveStackTrackItem(track);
      if (!resolved || !resolved.playbackId || shared.canPlayAsVideo(resolved)) return;
      const key = groupKeyForTrack(track) || resolved.playbackId;

      if (!byKey.has(key)) {
        const row = {
          key: key,
          track: track,
          resolved: resolved,
          versionCount: 1,
          members: [track]
        };
        byKey.set(key, row);
        rows.push(row);
        return;
      }

      const existing = byKey.get(key);
      existing.members.push(track);
      if (!versionsApi || !versionsApi.parseTrackDateValue) {
        existing.track = track;
        existing.resolved = resolved;
        return;
      }
      const aSong = versionsApi.libraryItemToSong
        ? versionsApi.libraryItemToSong(existing.resolved, itemLabel(existing.resolved))
        : { title: itemLabel(existing.resolved) };
      const bSong = versionsApi.libraryItemToSong
        ? versionsApi.libraryItemToSong(resolved, itemLabel(resolved))
        : { title: itemLabel(resolved) };
      if (versionsApi.parseTrackDateValue(bSong) > versionsApi.parseTrackDateValue(aSong)) {
        existing.track = track;
        existing.resolved = resolved;
      }
    });

    rows.forEach(function (row) {
      const catalogCount = versionCountForKey(row.key);
      row.versionCount = Math.max(row.members.length, catalogCount, 1);
      if (versionsApi && versionsApi.pickNewestSong) {
        const versions = versionsApi.collectVersionsByGroupKey(songCatalog, row.key);
        const newest = versionsApi.pickNewestSong(versions);
        if (newest && newest.playbackId) {
          const lib = shared.findInLibrary(libraryCache, newest.playbackId);
          if (lib) row.resolved = lib;
        }
      }
    });

    return rows;
  }

  function albumSongRows() {
    return albumSongRowsForGroup(group);
  }

  /** Playable queue = one entry per unique song (continuous playback). */
  function albumTracks() {
    return albumSongRows().map(function (row) {
      return row.resolved;
    });
  }

  /**
   * Current album + every group after it so lock-screen advance can cross collections.
   */
  function albumQueueFromCurrent() {
    if (!shared || !group) return albumTracks();
    const groups = shared.loadGroups() || [];
    const startIdx = groups.findIndex(function (g) {
      return g && g.id === group.id;
    });
    if (startIdx < 0) return albumTracks();
    const items = [];
    for (let i = startIdx; i < groups.length; i++) {
      const rows = albumSongRowsForGroup(groups[i]);
      for (let j = 0; j < rows.length; j++) {
        if (rows[j] && rows[j].resolved) items.push(rows[j].resolved);
      }
    }
    return items.length ? items : albumTracks();
  }

  function albumMetaText(rows) {
    const n = (rows || []).length;
    if (!n) return 'empty collection';
    return n === 1 ? '1 song' : n + ' songs';
  }

  function firstTrackTitle(rows) {
    const first = (rows || [])[0];
    if (!first) return '';
    return displayTitleForRow(first);
  }

  function reloadGroup() {
    if (!shared || !albumId) return null;
    group = shared.findGroupById(albumId);
    return group;
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

  function syncTracklistPlayback() {
    if (!mount || !player) return;
    mount.querySelectorAll('.music-track-row').forEach(function (row) {
      const id = row.dataset.playbackId;
      row.classList.toggle('is-active', !!player.isActivePlaybackId(id));
      row.classList.toggle('is-playing', !!player.isPlayingPlaybackId(id));
    });
    const playBtn = mount.querySelector('.studio-stream-album-play');
    if (!playBtn) return;
    const tracks = albumTracks();
    const active = player.getActiveSong && player.getActiveSong();
    const onAlbum =
      active &&
      tracks.some(function (item) {
        return item.playbackId === active.playbackId;
      });
    const playing = !!(onAlbum && player.isPlayingPlaybackId(active.playbackId));
    playBtn.classList.toggle('is-playing', playing);
    playBtn.textContent = playing ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  function playAlbumFrom(index, startPlaybackId) {
    const groupTracks = albumTracks();
    if (!groupTracks.length || !player) return;
    let startIndexInGroup = typeof index === 'number' ? index : 0;
    if (startPlaybackId) {
      const byId = groupTracks.findIndex(function (item) {
        return item && item.playbackId === startPlaybackId;
      });
      if (byId >= 0) startIndexInGroup = byId;
    }
    const started = groupTracks[startIndexInGroup] || groupTracks[0];
    const queueTracks = albumQueueFromCurrent();
    let idx = 0;
    if (started && started.playbackId) {
      const inQueue = queueTracks.findIndex(function (item) {
        return item && item.playbackId === started.playbackId;
      });
      idx = inQueue >= 0 ? inQueue : 0;
    } else {
      idx = Math.min(startIndexInGroup, Math.max(0, queueTracks.length - 1));
    }
    const meta = shared.loadStackMeta(group.id);
    player.playQueue(queueTracks, idx, {
      coverArt: (meta && meta.coverArt) || '',
      startPlaybackId: (started && started.playbackId) || startPlaybackId || ''
    });
    syncTracklistPlayback();
  }

  function wireTrackRowPlay(row, index) {
    function activate(event) {
      if (event) event.preventDefault();
      const id = row.dataset.playbackId;
      playAlbumFrom(index, id);
    }
    const tap = window.BurnfolderTouchTap || window.BurnfolderStudioTap;
    if (tap && tap.isCoarsePointer && tap.isCoarsePointer() && tap.bind) {
      tap.bind(row, activate);
    } else {
      row.addEventListener('click', activate);
    }
  }

  function stackIndexForId(playbackId) {
    if (!group || !playbackId) return -1;
    return (group.tracks || []).findIndex(function (t) {
      return t.playbackId === playbackId;
    });
  }

  /**
   * Reorder unique songs while keeping every version member in stack order.
   * Never flattens to A–Z — curated collection order (e.g. photonegative) stays.
   */
  function reorderUniqueRows(fromPlaybackId, targetPlaybackId, before) {
    if (!group || !shared || !shared.reorderUniqueSongs) return false;
    const result = shared.reorderUniqueSongs(
      fromPlaybackId,
      targetPlaybackId,
      group.id,
      before !== false
    );
    if (!result || !result.ok) return false;
    reloadGroup();
    return true;
  }

  function unfileTrack(playbackId) {
    if (!playbackId || !shared) return;
    if (shared.removeUniqueSong) {
      shared.removeUniqueSong(playbackId, group && group.id);
    } else {
      shared.removeFromStack(playbackId);
    }
    reloadGroup();
    setStatus('moved to clips');
  }

  function handleAlbumDnD(payload, result) {
    if (!payload || !result) return;
    if (result.type === 'cancel') {
      renderPlayer();
      return;
    }
    if (payload.kind !== 'album') return;

    if (result.type === 'reorder' && result.targetId) {
      reorderUniqueRows(payload.id, result.targetId, !!result.before);
      renderPlayer();
      return;
    }

    if (result.type === 'eject') {
      unfileTrack(payload.id);
      renderPlayer();
    }
  }

  function bindAlbumDnD() {
    const api = window.BurnfolderStudioDnD;
    if (!api || !mount) return;

    if (!dndBound) {
      api.registerDropHandler('album-page', handleAlbumDnD);
      dndBound = true;
    }

    mount.querySelectorAll('.studio-stream-album-track').forEach(function (li) {
      api.attach(li, {
        kind: 'album',
        zone: 'album-page',
        handle: '.studio-stream-album-track-handle',
        getId: function () {
          return li.dataset.songKey || li.dataset.playbackId || '';
        },
        getLabel: function () {
          const titleEl = li.querySelector('.music-track-title');
          return titleEl ? titleEl.textContent.trim() : '';
        },
        getIndex: function () {
          return stackIndexForId(li.dataset.playbackId);
        },
        getGroupId: function () {
          return albumId;
        }
      });
    });
  }

  function buildTrackItem(row, index) {
    const resolved = row.resolved;
    const storedId = (row.track && row.track.playbackId) || resolved.playbackId || '';
    const li = document.createElement('li');
    li.className = 'music-tracklist-item studio-stream-track-item studio-stream-album-track';
    li.dataset.playbackId = storedId;
    if (row.key) li.dataset.songKey = row.key;
    if (row.versionCount > 1) li.classList.add('has-versions');

    const handle = document.createElement('span');
    handle.className = 'studio-stream-album-track-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.textContent = '⠿';

    const num = document.createElement('span');
    num.className = 'music-track-num';
    num.textContent = String(index + 1);

    const rowBtn = document.createElement('button');
    rowBtn.type = 'button';
    rowBtn.className = 'music-track-row';
    rowBtn.dataset.playbackId = resolved.playbackId || '';
    const label = displayTitleForRow(row);
    rowBtn.setAttribute('aria-label', 'Play ' + label);

    const name = document.createElement('span');
    name.className = 'music-track-title';
    name.textContent =
      row.versionCount > 1 ? label + ' · ' + row.versionCount : label;

    const dur = document.createElement('span');
    dur.className = 'music-track-duration';
    dur.textContent = shared.formatDuration(resolved.duration) || '--:--';

    rowBtn.appendChild(name);
    rowBtn.appendChild(dur);
    li.appendChild(handle);
    li.appendChild(num);
    li.appendChild(rowBtn);
    wireTrackRowPlay(rowBtn, index);
    return li;
  }

  function songPageUrl(track) {
    var href = shared.songPageUrl ? shared.songPageUrl(track) : '';
    if (!href) {
      var id = track && track.playbackId;
      href = id ? 'stream-song.html?p=' + encodeURIComponent(id) : '#';
    }
    if (href.indexOf('/') !== 0 && href.indexOf('http') !== 0) {
      href = '/studio/' + href.replace(/^\.\//, '');
    }
    return href;
  }

  function renderPlayer() {
    if (!mount || !group) return;
    reloadGroup();
    if (!group) return;

    const meta = shared.loadStackMeta(group.id) || group.meta || {};
    const rows = albumSongRows();
    const playable = albumTracks();

    document.title = (meta.title || 'Album') + ' — burnfolder studio';

    const wrap = document.createElement('section');
    wrap.className = 'studio-stream-album-group is-expanded';
    wrap.dataset.groupId = group.id;

    const head = document.createElement('div');
    head.className = 'studio-stream-album-head';

    const coverWrap = document.createElement('div');
    coverWrap.className = 'studio-stream-album-cover-wrap';
    const coverBtn = document.createElement('div');
    coverBtn.className = 'studio-stream-album-cover';
    coverBtn.setAttribute('aria-hidden', 'true');
    applyCoverPreview(coverBtn, meta);
    coverWrap.appendChild(coverBtn);

    const info = document.createElement('span');
    info.className = 'studio-stream-album-info';
    const title = document.createElement('h2');
    title.className = 'studio-stream-album-name-input studio-album-player-title';
    title.textContent = meta.title || firstTrackTitle(rows) || 'collection';
    const metaEl = document.createElement('span');
    metaEl.className = 'studio-stream-album-meta';
    metaEl.textContent = albumMetaText(rows);
    info.appendChild(title);
    info.appendChild(metaEl);

    const actions = document.createElement('span');
    actions.className = 'studio-stream-album-actions';
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'studio-stream-album-play';
    playBtn.setAttribute('aria-label', 'Play');
    playBtn.textContent = '▶';
    function activateAlbumPlay(event) {
      if (event) event.stopPropagation();
      if (!playable.length) return;
      const active = player && player.getActiveSong && player.getActiveSong();
      const onAlbum =
        active &&
        playable.some(function (item) {
          return item.playbackId === active.playbackId;
        });
      if (onAlbum && player.isPlayingPlaybackId(active.playbackId) && player.togglePause) {
        player.togglePause();
        syncTracklistPlayback();
        return;
      }
      playAlbumFrom(0);
      if (playBtn.blur) playBtn.blur();
    }
    const tap = window.BurnfolderTouchTap || window.BurnfolderStudioTap;
    if (tap && tap.isCoarsePointer && tap.isCoarsePointer() && tap.bind) {
      tap.bind(playBtn, activateAlbumPlay);
    } else {
      playBtn.addEventListener('click', activateAlbumPlay);
    }
    actions.appendChild(playBtn);

    head.appendChild(coverWrap);
    head.appendChild(info);
    head.appendChild(actions);

    const ol = document.createElement('ol');
    ol.className =
      'music-tracklist entry-audio-list studio-stream-album-tracks studio-stream-library-drop';
    rows.forEach(function (row, index) {
      const li = buildTrackItem(row, index);
      const songLink = document.createElement('a');
      songLink.className = 'studio-album-player-song-link';
      songLink.href = songPageUrl(row.resolved);
      songLink.textContent = 'song';
      songLink.addEventListener('click', function (event) {
        event.stopPropagation();
      });
      li.appendChild(songLink);
      ol.appendChild(li);
    });

    const ejectShelf = document.createElement('div');
    ejectShelf.className = 'studio-stream-library-shelf studio-dnd-eject-zone';
    ejectShelf.setAttribute('aria-label', 'Drop here to move back to clips');

    wrap.appendChild(head);
    wrap.appendChild(ol);
    wrap.appendChild(ejectShelf);
    mount.innerHTML = '';
    mount.appendChild(wrap);
    syncTracklistPlayback();
    bindAlbumDnD();
  }

  function bindAlbumPageListeners() {
    if (listenersBound) return;
    listenersBound = true;
    window.addEventListener('burnfolder-stream-playback', syncTracklistPlayback);
    window.addEventListener('burnfolder-stack-changed', function () {
      if (!albumId) return;
      reloadGroup();
      if (group) renderPlayer();
    });
    if (designBtn && designBtn.dataset.bfBound !== '1') {
      designBtn.dataset.bfBound = '1';
    }
  }

  function bootStreamAlbumPage() {
    readParams();
    bindDomRefs();
    bindAlbumPageListeners();

    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      const active = link.getAttribute('data-nav') === 'clips';
      link.classList.toggle('is-active', active);
      link.classList.toggle('page-nav', active);
    });

    if (window.BurnfolderStudioPlaybackShell) {
      window.BurnfolderStudioPlaybackShell.ensureShell();
      window.BurnfolderStudioPlaybackShell.mountBar();
      if (window.BurnfolderStudioPlaybackShell.syncAfterNavigation) {
        window.BurnfolderStudioPlaybackShell.syncAfterNavigation();
      }
    }

    if (!albumId) {
      setStatus('missing album id');
      if (main) main.hidden = false;
      return;
    }

    if (!shared || !shared.findGroupById) {
      setStatus('album tools unavailable');
      return;
    }

    group = shared.findGroupById(albumId);
    if (!group) {
      setStatus('album not found');
      if (main) main.hidden = false;
      return;
    }

    if (designBtn) {
      var designHref = shared.albumDesignerUrl
        ? shared.albumDesignerUrl(albumId)
        : 'album-designer.html?album=' + encodeURIComponent(albumId);
      if (designHref.indexOf('/') !== 0 && designHref.indexOf('http') !== 0) {
        designHref = '/studio/' + designHref.replace(/^\.\//, '');
      }
      designBtn.href = designHref;
    }

    if (!muxLib || !muxLib.listMuxLibrary) {
      setStatus('playback unavailable');
      if (main) {
        main.hidden = false;
        renderPlayer();
      }
      return;
    }

    setStatus('loading…');
    muxLib
      .listMuxLibrary()
      .then(function (assets) {
        songCatalog = buildCatalog(assets);
        if (main) main.hidden = false;
        renderPlayer();
        setStatus('');
      })
      .catch(function (err) {
        if (main) main.hidden = false;
        renderPlayer();
        setStatus((err && err.message) || 'could not load library');
      });
  }

  window.studioInitStreamAlbumPage = bootStreamAlbumPage;
  bindDomRefs();
  if (main) bootStreamAlbumPage();
})();
