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
    const onStatus = options.onStatus || function () {};

    const shared = root.BurnfolderStreamShared;
    if (!shared || !gridEl) {
      return { render: function () {} };
    }

    const MUX_MIME = shared.MUX_MIME;
    const versionsApi = root.BurnfolderSongVersions;

    let albumExpanded = true;
    let albumDragId = null;
    let dragMuxId = null;

    function setStatus(msg) {
      onStatus(msg || '');
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

    function stackGroupKeys() {
      const keys = new Set();
      shared.loadStack().forEach(function (track) {
        if (versionsApi) keys.add(versionsApi.getTrackGroupKey(track.title || ''));
        else keys.add(track.playbackId);
      });
      return keys;
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

    function playAlbum(startIndex) {
      const tracks = shared.loadStack();
      if (!tracks.length) return;
      const songs = tracks.map(function (track) {
        const resolved = resolveStackTrack(track);
        return {
          title: labelForItem(resolved) || track.title || 'untitled',
          playbackId: track.playbackId
        };
      });
      if (typeof root.playTrackQueue === 'function') {
        root.playTrackQueue(songs, startIndex || 0);
      }
    }

    function clearAlbumDropMarkers(container) {
      (container || gridEl).querySelectorAll('.studio-stream-album-track').forEach(function (el) {
        el.classList.remove('is-drop-before', 'is-drop-after');
      });
    }

    function clearRowDropMarkers() {
      gridEl.querySelectorAll('.studio-editor-mux-item').forEach(function (el) {
        el.classList.remove('is-stack-drop-target');
      });
    }

    function buildAlbumTrackItem(track, index) {
      const resolved = resolveStackTrack(track);
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
        render();
      });

      li.addEventListener('dragstart', function (event) {
        albumDragId = track.playbackId;
        event.dataTransfer.setData(ALBUM_TRACK_MIME, track.playbackId);
        event.dataTransfer.setData('text/plain', label);
        event.dataTransfer.effectAllowed = 'copy';
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
        render();
      });

      li.appendChild(handle);
      li.appendChild(num);
      li.appendChild(row);
      li.appendChild(removeBtn);
      return li;
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
      head.draggable = true;
      head.title = 'Drag entire project onto the entry page';

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
          render();
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
      nameInput.addEventListener('mousedown', function (event) {
        event.stopPropagation();
      });
      nameInput.addEventListener('click', function (event) {
        event.stopPropagation();
      });

      const metaEl = document.createElement('span');
      metaEl.className = 'studio-stream-album-meta';
      metaEl.textContent =
        'project · ' + tracks.length + ' track' + (tracks.length === 1 ? '' : 's');
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
      entryBtn.setAttribute('aria-label', 'Add project to this entry');
      entryBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (typeof onInsertStack === 'function') onInsertStack();
      });

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'studio-stream-album-action';
      clearBtn.textContent = 'clear';
      clearBtn.setAttribute('aria-label', 'Clear project');
      clearBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (!root.confirm('Clear this project? The songs stay in your library.')) return;
        shared.clearStack();
        render();
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

      head.addEventListener('dragstart', function (event) {
        if (event.target.closest('button, input')) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData(STACK_ALBUM_MIME, '1');
        event.dataTransfer.setData('text/plain', meta.title || 'project');
        event.dataTransfer.effectAllowed = 'copy';
        head.classList.add('is-dragging');
      });
      head.addEventListener('dragend', function () {
        head.classList.remove('is-dragging');
      });

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
        const item = findItem(id);
        if (!item) return;
        shared.addToStack(item);
        render();
        setStatus('added to project');
      });

      wrap.appendChild(head);
      wrap.appendChild(ol);
      return wrap;
    }

    function attachSongDropTargets(li, item) {
      li.addEventListener('dragover', function (event) {
        if (Array.from(event.dataTransfer.types).indexOf(MUX_MIME) < 0) return;
        const draggedId = event.dataTransfer.getData(MUX_MIME) || dragMuxId;
        if (!draggedId || draggedId === item.playbackId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        clearRowDropMarkers();
        li.classList.add('is-stack-drop-target');
      });

      li.addEventListener('dragleave', function (event) {
        if (li.contains(event.relatedTarget)) return;
        li.classList.remove('is-stack-drop-target');
      });

      li.addEventListener('drop', function (event) {
        if (Array.from(event.dataTransfer.types).indexOf(MUX_MIME) < 0) return;
        event.preventDefault();
        event.stopPropagation();
        clearRowDropMarkers();
        const draggedId = event.dataTransfer.getData(MUX_MIME) || dragMuxId;
        if (!draggedId || draggedId === item.playbackId) return;
        const dragged = findItem(draggedId);
        if (!dragged) return;
        shared.dropOntoSong(dragged, item);
        render();
        setStatus('project started — drag project onto entry or tap entry');
      });
    }

    function buildLibraryTrackItem(item, trackNum) {
      const label = labelForItem(item);
      const kind = item.kind === 'video' ? 'video' : 'audio';
      const duration = shared.formatDuration(item.duration);

      const li = document.createElement('li');
      li.className = 'music-tracklist-item studio-editor-mux-item studio-stream-track-item';
      li.draggable = true;
      li.title = label + ' — double-click: add song · drag: page, stack, or song';
      li.dataset.muxAssetId = item.muxAssetId || '';

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

      li.addEventListener('dragstart', function (event) {
        dragMuxId = item.playbackId;
        event.dataTransfer.setData(MUX_MIME, item.playbackId);
        if (item.muxAssetId) {
          event.dataTransfer.setData(
            root.STUDIO_MUX_PLAYBACK_MIME || 'application/x-burnfolder-mux-playback',
            item.playbackId
          );
          event.dataTransfer.setData(
            'application/x-burnfolder-mux-asset',
            item.muxAssetId
          );
        }
        event.dataTransfer.setData('text/plain', label);
        event.dataTransfer.effectAllowed = 'copy';
        li.classList.add('is-dragging');
      });
      li.addEventListener('dragend', function () {
        dragMuxId = null;
        li.classList.remove('is-dragging');
        clearRowDropMarkers();
      });

      li.addEventListener('dblclick', function () {
        if (typeof onInsertTrack === 'function') onInsertTrack(item);
      });

      row.addEventListener('click', function (event) {
        event.preventDefault();
        if (options.onSelectItem) options.onSelectItem(item);
      });

      attachSongDropTargets(li, item);

      li.appendChild(num);
      li.appendChild(row);
      return li;
    }

    function render(assets) {
      const list = Array.isArray(assets) ? assets : libraryCache();
      gridEl.innerHTML = '';
      gridEl.classList.add('studio-editor-mux-list');

      if (!list.length && !shared.loadStack().length) {
        gridEl.innerHTML = '<p class="studio-empty">upload above — files appear here.</p>';
        return;
      }

      const albumGroup = buildAlbumGroup();
      if (albumGroup) gridEl.appendChild(albumGroup);

      const groupedKeys = stackGroupKeys();
      const audioItems = list.filter(function (item) {
        return !shared.isVideoItem(item);
      });
      const visibleAudio = groupedKeys.size
        ? audioItems.filter(function (item) {
            return !groupedKeys.has(groupKeyForItem(item));
          })
        : audioItems;
      const videoItems = list.filter(shared.isVideoItem);

      if (visibleAudio.length || videoItems.length) {
        const tracklist = document.createElement('ol');
        tracklist.className = 'music-tracklist entry-audio-list studio-editor-mux-tracklist';
        let n = 0;
        visibleAudio.forEach(function (item) {
          tracklist.appendChild(buildLibraryTrackItem(item, (n += 1)));
        });
        videoItems.forEach(function (item) {
          tracklist.appendChild(buildLibraryTrackItem(item, (n += 1)));
        });
        gridEl.appendChild(tracklist);
      } else if (!albumGroup) {
        gridEl.innerHTML = '<p class="studio-empty">upload above — files appear here.</p>';
      }
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
