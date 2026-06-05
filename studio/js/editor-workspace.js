(function () {
  'use strict';

  if (!window.studioEditorReady) return;

  const muxShared = window.BurnfolderStudioMux;
  const MUX_PLAYBACK_MIME = 'application/x-burnfolder-mux-playback';

  window.STUDIO_MUX_PLAYBACK_MIME = MUX_PLAYBACK_MIME;

  let muxLibraryCache = [];
  let contextMuxAssetId = null;

  function setStatus(msg) {
    if (window.studioEditorSetStatus) window.studioEditorSetStatus(msg);
  }

  function whenEditorReady(fn) {
    if (window.burnfolderEntryEditorApi) {
      fn(window.burnfolderEntryEditorApi);
      return;
    }
    window.addEventListener(
      'burnfolder-entry-editor-ready',
      function (event) {
        fn(event.detail || window.burnfolderEntryEditorApi);
      },
      { once: true }
    );
  }

  function muxItemToAsset(item) {
    const kind =
      window.BurnfolderStreamShared && window.BurnfolderStreamShared.resolveMediaKind
        ? window.BurnfolderStreamShared.resolveMediaKind(item)
        : item.kind || 'audio';
    return {
      id: 'mux-' + item.playbackId,
      kind: kind,
      name: item.passthrough,
      displayTitle: item.displayTitle || item.passthrough,
      muxPlaybackId: item.playbackId,
      muxPassthrough: item.passthrough,
      muxAssetId: item.muxAssetId
    };
  }

  function muxFileLabel(item) {
    return muxShared ? muxShared.muxFileLabel(item) : item.passthrough || 'untitled';
  }

  function findMuxItem(id) {
    return muxShared ? muxShared.findMuxItem(muxLibraryCache, id) : null;
  }

  function insertMuxItem(item) {
    if (!item) return;
    whenEditorReady(function (api) {
      api.insertAsset(muxItemToAsset(item));
          setStatus('added song');
    });
  }

  function resetMuxMenu() {
    const menu = document.getElementById('editorMuxMenu');
    if (menu) menu.value = '';
  }

  function renderEditorMuxGrid(assets) {
    const grid = document.getElementById('editorMuxGrid');
    if (!grid) return;

    grid.innerHTML = '';
    grid.classList.add('studio-editor-mux-list');

    if (!assets.length) {
      grid.innerHTML = '<p class="studio-empty">upload above — files appear here.</p>';
      return;
    }

    const shared = window.BurnfolderStreamShared;
    const tracklist = document.createElement('ol');
    tracklist.className = 'music-tracklist entry-audio-list studio-editor-mux-tracklist';

    assets.forEach(function (item, index) {
      const label = muxFileLabel(item);
      const kind = item.kind === 'video' ? 'video' : 'audio';
      const duration =
        shared && shared.formatDuration ? shared.formatDuration(item.duration) : '';

      const li = document.createElement('li');
      li.className = 'music-tracklist-item studio-editor-mux-item';
      if (contextMuxAssetId && item.muxAssetId === contextMuxAssetId) {
        li.classList.add('is-selected');
      }
      li.draggable = true;
      li.title = label + ' — double-click: new song · drag: drop on page or stack';
      li.dataset.muxAssetId = item.muxAssetId || '';

      const num = document.createElement('span');
      num.className = 'music-track-num';
      num.textContent = String(index + 1);

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
        event.dataTransfer.setData(MUX_PLAYBACK_MIME, item.playbackId);
        event.dataTransfer.setData('text/plain', label);
        event.dataTransfer.effectAllowed = 'copy';
        li.classList.add('is-dragging');
      });

      li.addEventListener('dragend', function () {
        li.classList.remove('is-dragging');
      });

      li.addEventListener('dblclick', function () {
        insertMuxItem(item);
      });

      row.addEventListener('click', function (event) {
        event.preventDefault();
        contextMuxAssetId = item.muxAssetId;
        tracklist.querySelectorAll('.studio-editor-mux-item').forEach(function (el) {
          el.classList.toggle('is-selected', el.dataset.muxAssetId === contextMuxAssetId);
        });
      });

      li.appendChild(num);
      li.appendChild(row);
      tracklist.appendChild(li);
    });

    grid.appendChild(tracklist);
  }

  function deleteContextMuxItem() {
    const item = findMuxItem(contextMuxAssetId);
    if (!item || !item.muxAssetId) {
      setStatus('click a file in the library first');
      resetMuxMenu();
      return;
    }

    const label = muxFileLabel(item);
    if (!window.confirm('delete "' + label + '" from mux? this cannot be undone.')) {
      resetMuxMenu();
      return;
    }

    setStatus('deleting from mux…');

    window.BurnfolderMux.deleteMuxAsset(item.muxAssetId)
      .then(function () {
        if (window.BurnfolderAssetCloud && window.BurnfolderAssetCloud.deleteByMuxAssetId) {
          return window.BurnfolderAssetCloud.deleteByMuxAssetId(item.muxAssetId);
        }
        return 0;
      })
      .then(function () {
        setStatus('deleted ' + label);
        contextMuxAssetId = null;
        resetMuxMenu();
        return loadMuxLibrary();
      })
      .catch(function (err) {
        setStatus(err.message || 'delete failed');
        resetMuxMenu();
      });
  }

  function loadMuxLibrary() {
    const grid = document.getElementById('editorMuxGrid');

    if (!window.BurnfolderMux || !window.BurnfolderMux.listMuxAssets) {
      if (grid) {
        grid.innerHTML = '<p class="studio-empty">mux unavailable — run netlify dev</p>';
      }
      return Promise.resolve([]);
    }

    if (grid) {
      grid.innerHTML = '<p class="studio-empty">loading…</p>';
    }

    const load = muxShared ? muxShared.listMuxLibrary() : window.BurnfolderMux.listMuxAssets();

    return load
      .then(function (assets) {
        muxLibraryCache = assets;
        const catalogProvider = {
          getLibrary: function () {
            return muxLibraryCache;
          },
          getCatalog: function () {
            const shared = window.BurnfolderStreamShared;
            return shared && shared.buildStreamSongCatalog
              ? shared.buildStreamSongCatalog(muxLibraryCache)
              : muxLibraryCache;
          },
          labelForItem: muxFileLabel
        };
        window.BurnfolderPlaybackCatalogProvider = catalogProvider;
        if (window.BurnfolderPlaybackContext && window.BurnfolderPlaybackContext.setCatalogProvider) {
          window.BurnfolderPlaybackContext.setCatalogProvider(catalogProvider);
        }
        renderEditorMuxGrid(muxLibraryCache);
        resetMuxMenu();
        return muxLibraryCache;
      })
      .catch(function (err) {
        muxLibraryCache = [];
        if (grid) {
          grid.innerHTML =
            '<p class="studio-empty">' + (err.message || 'could not load mux') + '</p>';
        }
        resetMuxMenu();
        setStatus(err.message || 'could not load mux library');
        return [];
      });
  }

  function mountEditorLibrary() {
    const refreshBtn = document.getElementById('editorMuxRefreshBtn');
    const menu = document.getElementById('editorMuxMenu');

    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        setStatus('refreshing…');
        loadMuxLibrary().then(function (assets) {
          setStatus(assets.length ? assets.length + ' files' : 'no files');
        });
      });
    }

    if (menu) {
      menu.addEventListener('change', function () {
        const action = menu.value;
        if (!action) return;

        if (action === 'delete') {
          deleteContextMuxItem();
          return;
        }

        if (action === 'refresh') {
          resetMuxMenu();
          setStatus('refreshing…');
          loadMuxLibrary().then(function (assets) {
            setStatus(assets.length ? assets.length + ' files' : 'no files');
          });
          return;
        }

        resetMuxMenu();
      });
    }

    document.addEventListener('keydown', function (event) {
      if ((event.key === 'Delete' || event.key === 'Backspace') && contextMuxAssetId) {
        const active = document.activeElement;
        if (
          active &&
          (active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.isContentEditable)
        ) {
          return;
        }
        if (menu) {
          menu.value = 'delete';
          menu.dispatchEvent(new Event('change'));
        }
      }
    });

    loadMuxLibrary();
  }

  function todayKey() {
    const now = new Date();
    return now.getMonth() + 1 + '.' + now.getDate() + '.' + String(now.getFullYear()).slice(-2);
  }

  function mountDraftNav() {
    const select = document.getElementById('studioDraftSelect');
    const newBtn = document.getElementById('studioNewDraftBtn');
    const newDate = document.getElementById('studioNewDraftDate');
    if (!select || !window.BurnfolderDrafts) return;

    if (newDate && !newDate.value) newDate.value = todayKey();

    window.studioRefreshDraftSelect = function (currentId) {
      window.BurnfolderDrafts.listDrafts().then(function (items) {
        const prev = select.value;
        select.innerHTML = '';
        if (!items.length) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'no entries';
          select.appendChild(opt);
          return;
        }
        items.forEach(function (draft) {
          const opt = document.createElement('option');
          opt.value = draft.id;
          let label = draft.date_key;
          if (draft.status === 'published') label += ' · published';
          opt.textContent = label;
          if (currentId ? draft.id === currentId : draft.id === prev) {
            opt.selected = true;
          }
          select.appendChild(opt);
        });
      });
    };

    select.addEventListener('change', function () {
      if (!select.value || select.value === window.studioEditorDraftId) return;
      const url = new URL('index.html', window.location.href);
      url.searchParams.set('id', select.value);
      window.location.href = url.pathname + url.search;
    });

    if (newBtn) {
      newBtn.addEventListener('click', function () {
        const dateKey = String((newDate && newDate.value) || '').trim() || todayKey();
        window.BurnfolderDrafts.createDraft(dateKey).then(function (draft) {
          const url = new URL('index.html', window.location.href);
          url.searchParams.set('id', draft.id);
          window.location.href = url.pathname + url.search;
        });
      });
    }

    window.studioRefreshDraftSelect(window.studioEditorDraftId);
  }

  function mountToolbar() {
    const addTextBtn = document.getElementById('studioAddTextBtn');
    if (addTextBtn) {
      addTextBtn.addEventListener('click', function () {
        whenEditorReady(function (api) {
          api.addText('', { textSize: getActiveTextSize() });
          setStatus('added text');
        });
      });
    }

    document.querySelectorAll('[data-text-size]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const size = btn.getAttribute('data-text-size');
        setActiveTextSize(size);
        whenEditorReady(function (api) {
          api.setTextSize(size);
        });
      });
    });
  }

  function getActiveTextSize() {
    const active = document.querySelector('[data-text-size].is-active');
    return (active && active.getAttribute('data-text-size')) || 'md';
  }

  function setActiveTextSize(size) {
    document.querySelectorAll('[data-text-size]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-text-size') === size);
    });
  }

  function applyPendingStackFromStream() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('createStack') !== '1') return;

    let payload = null;
    try {
      const raw = window.localStorage.getItem('burnfolderPendingStack');
      if (raw) payload = JSON.parse(raw);
    } catch (e) {
      payload = null;
    }
    if (!payload || !Array.isArray(payload.tracks) || !payload.tracks.length) return;

    whenEditorReady(function (api) {
      const block = api.addBlock('playlist', {
        title: payload.title || '',
        coverArt: payload.coverArt || '',
        coverAlt: payload.coverAlt || '',
        tracks: payload.tracks.map(function (track) {
          return {
            title: track.title || '',
            playbackId: track.playbackId || ''
          };
        })
      });
      window.localStorage.removeItem('burnfolderPendingStack');
      if (block && api.selectPlaylist) api.selectPlaylist(block.id);
      setStatus('stack added to entry');
      if (window.history && window.history.replaceState) {
        const url = new URL(window.location.href);
        url.searchParams.delete('createStack');
        window.history.replaceState({}, '', url.pathname + url.search);
      }
    });
  }

  function applyQueryInserts() {
    const params = new URLSearchParams(window.location.search);
    const assetId = params.get('insertAsset');
    applyPendingStackFromStream();
    if (!assetId) return;

    whenEditorReady(function (api) {
      if (assetId) {
        window.BurnfolderAssetCloud.getAsset(assetId).then(function (row) {
          if (row && row.muxPlaybackId) {
            api.insertAsset({
              kind: row.kind,
              displayTitle: row.displayTitle || row.name,
              name: row.name,
              muxPlaybackId: row.muxPlaybackId,
              muxPassthrough: row.muxPassthrough
            });
            return;
          }
          loadMuxLibrary().then(function () {
            const item = muxLibraryCache.find(function (a) {
              return a.muxAssetId === assetId || a.playbackId === assetId;
            });
            if (item) api.insertAsset(muxItemToAsset(item));
          });
        });
      }
    });
  }

  function mountPreviewDrop() {
    const preview = document.getElementById('entryPreview');
    if (!preview) return;

    preview.addEventListener('dragover', function (event) {
      const types = event.dataTransfer && event.dataTransfer.types;
      if (!types) return;
      if (Array.from(types).indexOf(MUX_PLAYBACK_MIME) < 0) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      preview.classList.add('is-drop-target');
    });

    preview.addEventListener('dragleave', function (event) {
      if (preview.contains(event.relatedTarget)) return;
      preview.classList.remove('is-drop-target');
    });

    preview.addEventListener('drop', function (event) {
      const playbackId = event.dataTransfer.getData(MUX_PLAYBACK_MIME);
      if (!playbackId) return;

      event.preventDefault();
      preview.classList.remove('is-drop-target');

      const label = event.dataTransfer.getData('text/plain') || '';

      whenEditorReady(function (api) {
        const item = muxLibraryCache.find(function (a) {
          return a.playbackId === playbackId;
        });
        const asset = item
          ? muxItemToAsset(item)
          : {
              kind: 'audio',
              displayTitle: label,
              name: label,
              muxPlaybackId: playbackId
            };

        const playlistBlockId =
          typeof api.getPlaylistBlockIdAtPoint === 'function'
            ? api.getPlaylistBlockIdAtPoint(event.clientX, event.clientY)
            : null;

        if (playlistBlockId && typeof api.appendToPlaylist === 'function') {
          if (api.appendToPlaylist(playlistBlockId, asset)) {
            setStatus('added to stack');
            return;
          }
        }

        api.insertAsset(asset);
        setStatus('added song');
      });
    });
  }

  function mountSidebarUpload() {
    const root = document.getElementById('editorSidebarUpload');
    if (!root || !window.BurnfolderCloudUI) return;

    window.BurnfolderCloudUI.mountUploadZone(root, {
      onStatus: setStatus,
      onFileSuccess: function () {
        loadMuxLibrary();
      },
      onUploaded: function () {
        loadMuxLibrary();
      }
    });
  }

  window.addEventListener('burnfolder-assets-changed', function () {
    loadMuxLibrary();
  });

  mountDraftNav();
  mountEditorLibrary();
  mountSidebarUpload();
  mountPreviewDrop();
  mountToolbar();
  applyQueryInserts();
})();
