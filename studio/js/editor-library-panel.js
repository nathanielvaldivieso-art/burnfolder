/**
 * Stream-style project/album UI for the entry editor library sidebar.
 */
(function (root) {
  'use strict';

  const STACK_ALBUM_MIME = 'application/x-burnfolder-album-stack';
  const ALBUM_TRACK_MIME = 'application/x-burnfolder-album-track';

  root.STUDIO_ALBUM_STACK_MIME = STACK_ALBUM_MIME;
  root.STUDIO_ALBUM_TRACK_MIME = ALBUM_TRACK_MIME;

  function mount(opts) {
    const options = opts || {};
    const gridEl = options.gridEl;
    const getLibrary = options.getLibrary || function () {
      return [];
    };
    const labelForItem = options.labelForItem || function (item) {
      return item.displayTitle || item.passthrough || item.name || 'untitled';
    };
    const onInsertStack = options.onInsertStack;
    const onInsertTrack = options.onInsertTrack;
    const onDropToEntry = options.onDropToEntry;
    const onStatus = options.onStatus || function () {};

    const shared = root.BurnfolderStreamShared;
    if (!shared || !gridEl) {
      return { render: function () {} };
    }

    const versionsApi = root.BurnfolderSongVersions;

    let albumExpanded = {};

    function isAlbumExpanded(groupId) {
      return albumExpanded[groupId] !== false;
    }

    function setAlbumExpanded(groupId, expanded) {
      albumExpanded[groupId] = expanded;
    }

    function setStatus(msg) {
      onStatus(msg || '');
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
      return findItem(playbackId) || resolveStackTrack({ playbackId: playbackId });
    }

    function handleEditorDnDDrop(payload, result) {
      if (!payload || !result) return;

      if (result.type === 'cancel') {
        render();
        return;
      }

      if (result.type === 'entryInsert') {
        const dragged = resolveDraggedItem(payload.id);
        if (!dragged) return;
        if (typeof onDropToEntry === 'function') {
          onDropToEntry(dragged, result);
        } else if (typeof onInsertTrack === 'function') {
          onInsertTrack(dragged);
        }
        return;
      }

      if (payload.kind === 'library' || payload.kind === 'album') {
        const dragged = resolveDraggedItem(payload.id);
        if (!dragged) return;

        if (result.type === 'merge' && result.targetId) {
          const target =
            findItem(result.targetId) || resolveStackTrack({ playbackId: result.targetId });
          if (target) shared.dropOntoSong(dragged, target);
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
        render();
      }
    }

    function bindEditorDnD() {
      const api = root.BurnfolderStudioDnD;
      if (!api || !gridEl) return;

      if (!gridEl.__studioEditorDnDRegistered) {
        api.registerDropHandler('editor', handleEditorDnDDrop);
        gridEl.__studioEditorDnDRegistered = true;
      }

      const libraryTracklist = gridEl.querySelector(
        '.studio-editor-mux-tracklist.studio-stream-library-drop'
      );

      gridEl.querySelectorAll('.studio-editor-mux-item').forEach(function (li) {
        const row = li.querySelector('.music-track-row');
        const id = row && row.dataset.playbackId;
        const titleEl = li.querySelector('.music-track-title');
        api.attach(li, {
          kind: 'library',
          zone: 'editor',
          handle: '.studio-track-grip',
          getId: function () {
            return id || '';
          },
          getLabel: function () {
            return titleEl ? titleEl.textContent : '';
          },
          showLanding: !!libraryTracklist,
          landingHost: gridEl
        });
      });

      gridEl.querySelectorAll('.studio-stream-album-track').forEach(function (li) {
        const groupEl = li.closest('.studio-stream-album-group');
        const groupId = groupEl ? groupEl.dataset.groupId || '' : '';
        const id = li.dataset.playbackId;
        const titleEl = li.querySelector('.music-track-title');
        api.attach(li, {
          kind: 'album',
          zone: 'editor',
          handle: '.studio-stream-album-track-handle',
          getId: function () {
            return id || '';
          },
          getLabel: function () {
            return titleEl ? titleEl.textContent : '';
          },
          getIndex: function () {
            return stackIndexForId(id, groupId);
          },
          getGroupId: function () {
            return groupId;
          }
        });
      });
    }

    function libraryCache() {
      return getLibrary() || [];
    }

    function findItem(id) {
      return shared.findInLibrary(libraryCache(), id);
    }

    function resolveStackTrack(track) {
      if (!track || !track.playbackId) return track;
      return findItem(track.playbackId) || track;
    }

    function groupKeyForItem(item) {
      if (!item) return '';
      if (!versionsApi) return item.playbackId || '';
      return versionsApi.getTrackGroupKey(labelForItem(item));
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

    function setAlbumCoverFromFile(groupId, file, coverBtn, coverWrap, onChanged) {
      const coverApi = window.BurnfolderCoverArt;
      if (!file || !coverApi || !coverApi.registerCoverFromFile) return;
      const m = shared.loadStackMeta(groupId);
      const label = m.title || file.name || 'album';
      coverApi
        .registerCoverFromFile(file, label)
        .then(function (result) {
          coverApi.patchFromCoverResult(m, result);
          shared.saveStackMeta(m, groupId);
          applyCoverPreview(coverBtn, m);
          syncAlbumCoverClearBtn(coverWrap, m);
          if (typeof onChanged === 'function') onChanged();
        })
        .catch(function () {});
    }

    function playAlbum(group, start) {
      const tracks = group.tracks || [];
      if (!tracks.length) return;
      const meta = group.meta || {};
      const opts = typeof start === 'object' && start ? start : { startIndex: start || 0 };
      const startPlaybackId = opts.startPlaybackId || '';
      let startIndex = typeof opts.startIndex === 'number' ? opts.startIndex : 0;

      const songs = tracks.map(function (track) {
        const resolved = resolveStackTrack(track);
        return {
          title: labelForItem(resolved) || track.title || 'untitled',
          playbackId: resolved.playbackId || track.playbackId,
          coverArt: meta.coverArt || ''
        };
      });

      if (startPlaybackId) {
        const byId = songs.findIndex(function (song) {
          return song.playbackId === startPlaybackId;
        });
        if (byId >= 0) startIndex = byId;
      }

      const player = window.BurnfolderStreamPlayer;
      if (player && player.playQueue) {
        player.playQueue(songs, startIndex, {
          coverArt: meta.coverArt || '',
          startPlaybackId: startPlaybackId || (songs[startIndex] && songs[startIndex].playbackId) || ''
        });
        return;
      }
      if (typeof root.playTrackQueue === 'function') {
        root.playTrackQueue(songs, startIndex || 0);
      }
    }

    function buildAlbumTrackItem(track, index, group) {
      const resolved = resolveStackTrack(track);
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
      const label = labelForItem(resolved) || track.title || 'untitled';
      row.setAttribute('aria-label', 'Play ' + label);

      const name = document.createElement('span');
      name.className = 'music-track-title';
      name.textContent = label;

      const dur = document.createElement('span');
      dur.className = 'music-track-duration';
      dur.textContent = shared.formatDuration(resolved.duration) || '--:--';

      row.appendChild(name);
      row.appendChild(dur);

      function activate(event) {
        if (event && event.target && event.target.closest('.studio-stream-album-track-handle')) {
          return;
        }
        playAlbum(group, {
          startPlaybackId: row.dataset.playbackId || '',
          fallbackId: track.playbackId || '',
          startIndex: index
        });
      }

      const tap = window.BurnfolderTouchTap || window.BurnfolderStudioTap;
      if (tap && tap.isCoarsePointer && tap.isCoarsePointer() && tap.bind) {
        tap.bind(row, activate);
      } else {
        row.addEventListener('click', activate);
      }

      li.appendChild(handle);
      li.appendChild(num);
      li.appendChild(row);
      return li;
    }

    function syncAlbumCoverClearBtn(coverWrap, meta) {
      if (!coverWrap) return;
      const clearBtn = coverWrap.querySelector('.studio-stream-album-cover-clear');
      if (clearBtn) clearBtn.hidden = !(meta && meta.coverArt);
    }

    function buildAlbumCoverControls(groupId, meta, onChanged) {
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
        if (typeof onChanged === 'function') onChanged();
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
        setAlbumCoverFromFile(groupId, file, coverBtn, coverWrap, onChanged);
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

      const coverWrap = buildAlbumCoverControls(groupId, meta, render);

      const info = document.createElement('span');
      info.className = 'studio-stream-album-info';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'studio-stream-album-name-input';
      nameInput.placeholder = 'untitled';
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
      nameInput.addEventListener('mousedown', function (event) {
        event.stopPropagation();
      });
      nameInput.addEventListener('click', function (event) {
        event.stopPropagation();
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
      function activateAlbumPlay(event) {
        if (event) event.stopPropagation();
        playAlbum(group, 0);
        if (playBtn.blur) playBtn.blur();
      }
      const tap = root.BurnfolderTouchTap || root.BurnfolderStudioTap;
      if (tap && tap.isCoarsePointer && tap.isCoarsePointer() && tap.bind) {
        tap.bind(playBtn, activateAlbumPlay);
      } else {
        playBtn.addEventListener('click', activateAlbumPlay);
      }

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
      actions.appendChild(toggle);

      head.appendChild(coverWrap);
      head.appendChild(info);
      head.appendChild(actions);

      head.draggable = true;
      head.addEventListener('dragstart', function (event) {
        if (event.target.closest('button, input')) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData(STACK_ALBUM_MIME, '1');
        event.dataTransfer.setData('text/plain', meta.title || '');
        event.dataTransfer.effectAllowed = 'copy';
        head.classList.add('is-dragging');
      });
      head.addEventListener('dragend', function () {
        head.classList.remove('is-dragging');
      });

      const ol = document.createElement('ol');
      ol.className = 'music-tracklist entry-audio-list studio-stream-album-tracks';
      tracks.forEach(function (track, index) {
        ol.appendChild(buildAlbumTrackItem(track, index, group));
      });

      wrap.appendChild(head);
      wrap.appendChild(ol);
      return wrap;
    }

    function buildLibraryTrackItem(item, trackNum) {
      const label = labelForItem(item);
      const kind = item.kind === 'video' ? 'video' : 'audio';
      const duration = shared.formatDuration(item.duration);

      const li = document.createElement('li');
      li.className = 'music-tracklist-item studio-editor-mux-item studio-stream-track-item';
      li.dataset.muxAssetId = item.muxAssetId || '';

      const grip = document.createElement('span');
      grip.className = 'studio-track-grip';
      grip.setAttribute('aria-hidden', 'true');

      const num = document.createElement('span');
      num.className = 'music-track-num';
      num.textContent = String(trackNum);

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'music-track-row';
      row.dataset.playbackId = item.playbackId || '';
      row.setAttribute('aria-label', 'Add ' + label);

      const name = document.createElement('span');
      name.className = 'music-track-title';
      name.textContent = label;
      if (kind === 'video') {
        const flag = document.createElement('span');
        flag.className = 'studio-stream-video-flag';
        flag.textContent = '▶';
        flag.setAttribute('aria-hidden', 'true');
        name.appendChild(flag);
      }

      const dur = document.createElement('span');
      dur.className = 'music-track-duration';
      dur.textContent = duration || '--:--';

      row.appendChild(name);
      row.appendChild(dur);

      li.addEventListener('dblclick', function () {
        if (typeof onInsertTrack === 'function') onInsertTrack(item);
      });

      row.addEventListener('click', function (event) {
        event.preventDefault();
        if (
          li.dataset.studioJustDragged === '1' ||
          li.dataset.studioDragging === '1' ||
          li.dataset.studioDragHold === '1'
        ) {
          return;
        }
        const coarse =
          window.matchMedia &&
          window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        if (coarse && typeof onInsertTrack === 'function') {
          onInsertTrack(item);
          return;
        }
        if (options.onSelectItem) options.onSelectItem(item);
      });

      li.appendChild(grip);
      li.appendChild(num);
      li.appendChild(row);
      return li;
    }

    function buildSongVersionGroup(group, trackNumRef) {
      const section = document.createElement('section');
      section.className = 'studio-editor-song-group';

      const heading = document.createElement('h3');
      heading.className = 'studio-editor-song-group-title';
      heading.textContent = group.baseTitle;
      section.appendChild(heading);

      const tracklist = document.createElement('ol');
      tracklist.className =
        'music-tracklist entry-audio-list studio-editor-mux-tracklist studio-editor-song-group-tracks';

      group.items.forEach(function (item) {
        trackNumRef.n += 1;
        tracklist.appendChild(buildLibraryTrackItem(item, trackNumRef.n));
      });

      section.appendChild(tracklist);
      return section;
    }

    function organizeVisibleAudio(items) {
      if (!versionsApi || !items.length) return items.map(function (item) {
        return { type: 'single', items: [item] };
      });
      return versionsApi.organizeLibraryItemsBySong(items, {
        labelForItem: labelForItem,
        versionSort: 'newest'
      });
    }

    function render(assets) {
      const list = Array.isArray(assets) ? assets : libraryCache();
      gridEl.innerHTML = '';
      gridEl.classList.add('studio-editor-mux-list');

      if (!list.length && !shared.loadGroups().length) {
        gridEl.innerHTML = '<p class="studio-empty">upload above — files appear here.</p>';
        return;
      }

      let hasAlbumGroup = false;
      shared.loadGroups().forEach(function (group) {
        const albumGroup = buildAlbumGroup(group);
        if (albumGroup) {
          hasAlbumGroup = true;
          gridEl.appendChild(albumGroup);
        }
      });

      const groupedIds = groupedPlaybackIds();
      const audioItems = list.filter(function (item) {
        return !shared.isVideoItem(item);
      });
      const visibleAudio = groupedIds.size
        ? audioItems.filter(function (item) {
            return item.playbackId && !groupedIds.has(item.playbackId);
          })
        : audioItems;
      const videoItems = list.filter(shared.isVideoItem);
      const organizedAudio = organizeVisibleAudio(visibleAudio);

      if (organizedAudio.length || videoItems.length) {
        const trackNumRef = { n: 0 };
        let singlesTracklist = null;

        function ensureSinglesTracklist() {
          if (singlesTracklist) return singlesTracklist;
          singlesTracklist = document.createElement('ol');
          singlesTracklist.className =
            'music-tracklist entry-audio-list studio-editor-mux-tracklist studio-stream-library-drop';
          return singlesTracklist;
        }

        function flushSinglesTracklist() {
          if (!singlesTracklist || !singlesTracklist.children.length) return;
          gridEl.appendChild(singlesTracklist);
          singlesTracklist = null;
        }

        organizedAudio.forEach(function (row) {
          if (row.type === 'group') {
            flushSinglesTracklist();
            gridEl.appendChild(buildSongVersionGroup(row, trackNumRef));
            return;
          }
          row.items.forEach(function (item) {
            trackNumRef.n += 1;
            ensureSinglesTracklist().appendChild(buildLibraryTrackItem(item, trackNumRef.n));
          });
        });
        flushSinglesTracklist();

        if (videoItems.length) {
          const videoTracklist = document.createElement('ol');
          videoTracklist.className =
            'music-tracklist entry-audio-list studio-editor-mux-tracklist studio-stream-library-drop';
          videoItems.forEach(function (item) {
            trackNumRef.n += 1;
            videoTracklist.appendChild(buildLibraryTrackItem(item, trackNumRef.n));
          });
          gridEl.appendChild(videoTracklist);
        }
      } else if (hasAlbumGroup) {
        const shelf = document.createElement('div');
        shelf.className = 'studio-stream-library-shelf studio-stream-library-drop';
        shelf.setAttribute('aria-label', 'Drop here to remove from folder');
        gridEl.appendChild(shelf);
      } else if (!hasAlbumGroup) {
        gridEl.innerHTML = '<p class="studio-empty">upload above — files appear here.</p>';
      }

      bindEditorDnD();
    }

    root.addEventListener('burnfolder-stack-changed', function () {
      render();
    });
    root.addEventListener('burnfolder-stack-meta-changed', function () {
      render();
    });

    return { render: render };
  }

  root.BurnfolderEditorLibraryPanel = { mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : window);
