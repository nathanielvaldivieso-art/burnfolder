(function () {
  'use strict';

  if (!window.studioEditorReady) return;

  const muxShared = window.BurnfolderStudioMux;
  const MUX_PLAYBACK_MIME = 'application/x-burnfolder-mux-playback';

  window.STUDIO_MUX_PLAYBACK_MIME = MUX_PLAYBACK_MIME;

  let muxLibraryCache = [];
  let journalNotesCache = [];
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

  function findJournalNote(id) {
    return journalNotesCache.find(function (note) {
      return note.id === id;
    });
  }

  function insertMuxItem(item) {
    if (!item) return;
    whenEditorReady(function (api) {
      api.insertAsset(muxItemToAsset(item));
          setStatus('added song');
    });
  }

  function insertJournalNote(note) {
    if (!note) return;
    whenEditorReady(function (api) {
      api.insertJournal(note);
      setStatus('added note');
    });
  }

  function updateJournalPickerButtons() {
    const select = document.getElementById('editorJournalSelect');
    const addBtn = document.getElementById('editorJournalAddBtn');
    const hasSelection = select && select.value && !select.disabled;

    if (addBtn) addBtn.disabled = !hasSelection;
  }

  function resetMuxMenu() {
    const menu = document.getElementById('editorMuxMenu');
    if (menu) menu.value = '';
  }

  function renderEditorMuxGrid(assets) {
    const grid = document.getElementById('editorMuxGrid');
    if (!grid) return;

    grid.innerHTML = '';

    if (!assets.length) {
      grid.innerHTML = '<p class="studio-empty">upload above — files appear here.</p>';
      return;
    }

    assets.forEach(function (item) {
      const label = muxFileLabel(item);
      const kind = item.kind === 'video' ? 'video' : 'audio';
      const thumb =
        muxShared && muxShared.muxThumbnailUrl
          ? muxShared.muxThumbnailUrl(item.playbackId)
          : '';

      const tile = document.createElement('div');
      tile.className = 'studio-editor-mux-tile';
      tile.draggable = true;
      tile.title = label + ' — double-click: new song · drag: drop on page or stack';
      tile.dataset.muxAssetId = item.muxAssetId;

      const cover = document.createElement('div');
      cover.className = 'studio-editor-mux-tile-cover';

      const kindTag = document.createElement('span');
      kindTag.className = 'studio-editor-mux-kind';
      kindTag.textContent = kind;
      cover.appendChild(kindTag);

      if (thumb) {
        const img = document.createElement('img');
        img.src = thumb;
        img.alt = '';
        img.loading = 'lazy';
        cover.appendChild(img);
      } else {
        const glyph = document.createElement('span');
        glyph.className = 'studio-editor-mux-glyph';
        glyph.textContent = kind === 'video' ? '▶' : '♫';
        cover.appendChild(glyph);
      }

      const name = document.createElement('span');
      name.className = 'studio-editor-mux-name';
      name.textContent = label;

      tile.appendChild(cover);
      tile.appendChild(name);

      tile.addEventListener('dragstart', function (event) {
        event.dataTransfer.setData(MUX_PLAYBACK_MIME, item.playbackId);
        event.dataTransfer.setData('text/plain', label);
        event.dataTransfer.effectAllowed = 'copy';
        tile.classList.add('is-dragging');
      });

      tile.addEventListener('dragend', function () {
        tile.classList.remove('is-dragging');
      });

      tile.addEventListener('dblclick', function () {
        insertMuxItem(item);
      });

      tile.addEventListener('click', function () {
        contextMuxAssetId = item.muxAssetId;
      });

      grid.appendChild(tile);
    });
  }

  function renderJournalDropdown(notes) {
    const select = document.getElementById('editorJournalSelect');
    if (!select) return;

    journalNotesCache = notes || [];
    select.innerHTML = '';

    if (!journalNotesCache.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'no saved notes';
      select.appendChild(opt);
      select.disabled = true;
      updateJournalPickerButtons();
      return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'choose a note…';
    select.appendChild(placeholder);

    journalNotesCache.forEach(function (note) {
      const opt = document.createElement('option');
      opt.value = note.id;
      const title = (note.title && String(note.title).trim()) || 'untitled note';
      const preview = (note.body && String(note.body).trim()) || '';
      opt.textContent = preview ? title + ' — ' + preview.replace(/\s+/g, ' ').slice(0, 40) : title;
      select.appendChild(opt);
    });

    select.disabled = false;
    updateJournalPickerButtons();
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

  function loadJournalList() {
    const select = document.getElementById('editorJournalSelect');
    if (!window.BurnfolderJournal || !window.BurnfolderJournal.listNotes) {
      if (select) {
        select.innerHTML = '<option value="">journal unavailable</option>';
        select.disabled = true;
      }
      updateJournalPickerButtons();
      return Promise.resolve([]);
    }

    if (select) {
      select.disabled = true;
      select.innerHTML = '<option value="">loading…</option>';
    }
    updateJournalPickerButtons();

    return window.BurnfolderJournal.listNotes()
      .then(function (notes) {
        renderJournalDropdown(notes);
        return notes;
      })
      .catch(function (err) {
        renderJournalDropdown([]);
        setStatus(err.message || 'could not load notes');
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

  function mountJournalPicker() {
    const select = document.getElementById('editorJournalSelect');
    const addBtn = document.getElementById('editorJournalAddBtn');

    if (select) {
      select.addEventListener('change', updateJournalPickerButtons);
    }

    if (addBtn && select) {
      addBtn.addEventListener('click', function () {
        const noteId = select.value;
        if (!noteId) {
          setStatus('choose a note first');
          return;
        }
        const note = findJournalNote(noteId);
        if (note) {
          insertJournalNote(note);
          return;
        }
        window.BurnfolderJournal.getNote(noteId).then(function (fetched) {
          if (fetched) insertJournalNote(fetched);
        });
      });
    }

    loadJournalList();
  }

  function todayKey() {
    const now = new Date();
    return now.getMonth() + 1 + '.' + now.getDate() + '.' + String(now.getFullYear()).slice(-2);
  }

  function mountJournalCompose() {
    const saveBtn = document.getElementById('journalSaveBtn');
    const titleInput = document.getElementById('journalNewTitle');
    const bodyInput = document.getElementById('journalNewBody');
    if (!saveBtn || !window.BurnfolderJournal) return;

    saveBtn.addEventListener('click', function () {
      window.BurnfolderJournal.createNote(titleInput.value, bodyInput.value)
        .then(function (note) {
          titleInput.value = '';
          bodyInput.value = '';
          return loadJournalList().then(function () {
            if (note && note.id) {
              const select = document.getElementById('editorJournalSelect');
              if (select) select.value = note.id;
              updateJournalPickerButtons();
            }
            setStatus('saved note');
          });
        })
        .catch(function (err) {
          setStatus(err.message || 'could not save note');
        });
    });
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
    const journalId = params.get('insertJournal');
    applyPendingStackFromStream();
    if (!assetId && !journalId) return;

    whenEditorReady(function (api) {
      if (journalId) {
        window.BurnfolderJournal.getNote(journalId).then(function (note) {
          if (note) api.insertJournal(note);
        });
      }
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
  mountJournalCompose();
  mountEditorLibrary();
  mountJournalPicker();
  mountSidebarUpload();
  mountPreviewDrop();
  mountToolbar();
  applyQueryInserts();
})();
