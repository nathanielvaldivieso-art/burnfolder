/**
 * Reusable song public-page editor that mounts inside a container.
 * Mirrors the capabilities of song-designer.html so it can live inside clips.html.
 */
(function (root) {
  'use strict';

  const store = root.BurnfolderSongPageStore;
  const shared = root.BurnfolderStreamShared;
  const muxLib = root.BurnfolderStudioMux;
  const versionsApi = root.BurnfolderSongVersions;
  const renderApi = root.BurnfolderSongPageRender;
  const assetCloud = root.BurnfolderAssetCloud;

  if (!store || !shared || !muxLib || !versionsApi || !renderApi) return;

  function makeId(prefix) {
    return (
      String(prefix || 'sf') +
      '_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function setStatus(statusEl, msg, kind) {
    if (!statusEl) return;
    if (root.BurnfolderStudioStatus) {
      root.BurnfolderStudioStatus.set(statusEl, msg, kind);
      return;
    }
    statusEl.textContent = msg || '';
  }

  function createEl(tag, cls, attrs) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'text') el.textContent = attrs[key];
        else if (key === 'html') el.innerHTML = attrs[key];
        else el.setAttribute(key, attrs[key]);
      });
    }
    return el;
  }

  function buildUi(container) {
    const rootEl = createEl('div', 'studio-focus studio-song-focus');
    rootEl.setAttribute('aria-label', 'Song page editor');

    const header = createEl('header', 'studio-focus-header');
    const closeBtn = createEl('button', 'icon-btn studio-focus-close', { type: 'button', text: 'close' });
    const title = createEl('h2', 'studio-focus-title', { text: 'Song' });
    const pushBtn = createEl('button', 'icon-btn studio-focus-push', { type: 'button', text: 'push' });
    header.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(pushBtn);

    const body = createEl('div', 'studio-focus-body');

    const editor = createEl('div', 'studio-focus-editor');

    const coverSection = createEl('section', 'studio-focus-section');
    coverSection.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'cover art' }));
    const coverRow = createEl('div', 'studio-song-designer-cover-row');
    const coverBtn = createEl('button', 'icon-btn', { type: 'button', text: 'cover' });
    const coverClearBtn = createEl('button', 'icon-btn', { type: 'button', text: 'remove' });
    const coverInput = createEl('input', '', { type: 'file', accept: 'image/*', hidden: 'hidden' });
    coverRow.appendChild(coverBtn);
    coverRow.appendChild(coverClearBtn);
    coverRow.appendChild(coverInput);
    coverSection.appendChild(coverRow);
    const coverPreview = createEl('img', 'studio-song-designer-cover-preview', { alt: '' });
    coverSection.appendChild(coverPreview);

    const versionSection = createEl('section', 'studio-focus-section');
    versionSection.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'versions' }));
    const versionPicker = createEl('div', 'studio-song-designer-version-picker', { role: 'tablist', 'aria-label': 'Versions' });
    const versionTools = createEl('div', 'studio-focus-version-tools');
    const keyBtn = createEl('button', 'icon-btn', { type: 'button', text: 'key' });
    const keyMeta = createEl('span', 'studio-focus-key-meta');
    const copyIdBtn = createEl('button', 'icon-btn', { type: 'button', text: 'copy id' });
    const deleteVersionBtn = createEl('button', 'icon-btn', { type: 'button', text: 'delete' });
    versionTools.appendChild(keyBtn);
    versionTools.appendChild(keyMeta);
    versionTools.appendChild(copyIdBtn);
    versionTools.appendChild(deleteVersionBtn);
    versionSection.appendChild(versionPicker);
    versionSection.appendChild(versionTools);

    const lyricsSection = createEl('section', 'studio-focus-section');
    lyricsSection.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'lyrics' }));
    const lyricsEl = createEl('textarea', 'studio-song-designer-textarea', { rows: '6', placeholder: 'lyrics for selected version…', spellcheck: 'false' });
    lyricsSection.appendChild(lyricsEl);

    const vNotesSection = createEl('section', 'studio-focus-section');
    vNotesSection.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'version notes' }));
    const versionNotesEl = createEl('textarea', 'studio-song-designer-textarea', { rows: '4', placeholder: 'notes for selected version…', spellcheck: 'false' });
    vNotesSection.appendChild(versionNotesEl);

    const notesSection = createEl('section', 'studio-focus-section');
    notesSection.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'song notes' }));
    const notesEl = createEl('textarea', 'studio-song-designer-textarea studio-song-designer-textarea--tall', { rows: '6', placeholder: 'notes about this song…', spellcheck: 'false' });
    notesSection.appendChild(notesEl);

    const videoSection = createEl('section', 'studio-focus-section');
    videoSection.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'hero video' }));
    const heroVideoEl = createEl('select', 'studio-song-designer-select');
    heroVideoEl.appendChild(createEl('option', '', { value: '', text: 'none' }));
    videoSection.appendChild(heroVideoEl);

    const clipsSection = createEl('section', 'studio-focus-section');
    const clipsHead = createEl('div', 'studio-focus-section-head');
    clipsHead.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'clips grid' }));
    const clipsActions = createEl('div', 'studio-focus-section-actions');
    const addTextBtn = createEl('button', 'icon-btn', { type: 'button', text: 'text' });
    const addMediaBtn = createEl('button', 'icon-btn', { type: 'button', text: 'media' });
    clipsActions.appendChild(addTextBtn);
    clipsActions.appendChild(addMediaBtn);
    clipsHead.appendChild(clipsActions);
    clipsSection.appendChild(clipsHead);
    const mediaList = createEl('ul', 'studio-song-designer-media-list');
    const mediaInput = createEl('input', '', { type: 'file', accept: 'image/*,audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov,.webm,.mkv,.jpg,.jpeg,.png,.webp,.gif', hidden: 'hidden' });
    clipsSection.appendChild(mediaList);
    clipsSection.appendChild(mediaInput);

    const shareSection = createEl('section', 'studio-focus-section');
    shareSection.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'share' }));
    const shareMount = createEl('div', 'studio-focus-share-mount');
    shareSection.appendChild(shareMount);

    editor.appendChild(coverSection);
    editor.appendChild(versionSection);
    editor.appendChild(lyricsSection);
    editor.appendChild(vNotesSection);
    editor.appendChild(notesSection);
    editor.appendChild(videoSection);
    editor.appendChild(clipsSection);
    editor.appendChild(shareSection);

    const previewWrap = createEl('div', 'studio-focus-preview-wrap');
    previewWrap.appendChild(createEl('p', 'studio-song-designer-preview-label', { text: 'preview' }));
    const previewRoot = createEl('div', 'studio-song-designer-preview song-hub-page');
    previewRoot.innerHTML =
      '<h2 class="song-hub-title">Song</h2>' +
      '<p class="song-hub-subtitle"></p>' +
      '<div data-song-panel="cover" class="song-hub-cover-wrap" hidden>' +
      '<img data-song-field="cover" class="song-hub-cover-image" alt=""></div>' +
      '<div data-song-panel="video" class="song-hub-panel" hidden>' +
      '<div data-song-field="video-hero" class="studio-song-video-hero"></div></div>' +
      '<div data-song-panel="lyrics" class="song-hub-panel" hidden>' +
      '<div class="song-hub-lyrics song-hub-lyrics--open" data-song-field="version-lyrics"></div></div>' +
      '<div data-song-panel="version-notes" class="song-hub-panel" hidden>' +
      '<div class="song-hub-notes" data-song-field="version-notes"></div></div>' +
      '<div data-song-panel="clips" class="song-hub-panel" hidden>' +
      '<div class="song-hub-content-grid" data-song-field="clips-grid"></div></div>' +
      '<div data-song-panel="notes" class="song-hub-panel" hidden>' +
      '<div class="song-hub-notes" data-song-field="notes"></div></div>';
    previewWrap.appendChild(previewRoot);

    body.appendChild(editor);
    body.appendChild(previewWrap);

    const statusEl = createEl('p', 'studio-focus-status', { 'aria-live': 'polite' });

    rootEl.appendChild(header);
    rootEl.appendChild(body);
    rootEl.appendChild(statusEl);

    container.innerHTML = '';
    container.appendChild(rootEl);

    return {
      rootEl: rootEl,
      closeBtn: closeBtn,
      pushBtn: pushBtn,
      title: title,
      coverBtn: coverBtn,
      coverClearBtn: coverClearBtn,
      coverInput: coverInput,
      coverPreview: coverPreview,
      versionPicker: versionPicker,
      keyBtn: keyBtn,
      keyMeta: keyMeta,
      copyIdBtn: copyIdBtn,
      deleteVersionBtn: deleteVersionBtn,
      lyricsEl: lyricsEl,
      versionNotesEl: versionNotesEl,
      notesEl: notesEl,
      heroVideoEl: heroVideoEl,
      addTextBtn: addTextBtn,
      addMediaBtn: addMediaBtn,
      mediaList: mediaList,
      mediaInput: mediaInput,
      shareMount: shareMount,
      previewRoot: previewRoot,
      statusEl: statusEl
    };
  }

  function SongFocus(container, groupKey, options) {
    const opts = options || {};
    this.container = container;
    this.groupKey = String(groupKey || '').toLowerCase().trim();
    this.ui = buildUi(container);
    this.libraryCache = [];
    this.songCatalog = [];
    this.songGroups = [];
    this.activeVersionId = '';
    this.currentPage = null;
    this.saveTimer = null;
    this.loadingPage = false;
    this.shareHubApi = null;
    this.dragSrcId = '';
    this.uploadQueue = root.BurnfolderUploadQueue
      ? root.BurnfolderUploadQueue.attach(this.ui.rootEl)
      : null;

    this.bindEvents();
    this.boot();
  }

  SongFocus.prototype.setStatus = function (msg, kind) {
    setStatus(this.ui.statusEl, msg, kind);
  };

  SongFocus.prototype.itemLabel = function (item) {
    return shared.muxFileLabel(item);
  };

  SongFocus.prototype.buildCatalog = function (assets) {
    this.libraryCache = shared.normalizeLibrary(assets);
    if (!versionsApi) return this.libraryCache.slice();
    this.songCatalog = versionsApi.mergeSongCatalog(
      versionsApi.getSiteCatalog(root),
      this.libraryCache,
      this.itemLabel.bind(this)
    );
    return this.songCatalog.slice();
  };

  SongFocus.prototype.buildSongGroups = function (catalog) {
    const map = new Map();
    (catalog || []).forEach(function (song) {
      if (!song || !song.playbackId) return;
      const key = versionsApi.getTrackGroupKey(song.title);
      if (!map.has(key)) {
        map.set(key, {
          groupKey: key,
          title: versionsApi.getBaseTitle([song]),
          count: 1,
          newest: song
        });
        return;
      }
      const row = map.get(key);
      row.count += 1;
      row.newest = song;
      row.title = versionsApi.getBaseTitle([song, row.newest]);
    });
    const groups = Array.from(map.values()).sort(function (a, b) {
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
    this.songGroups = groups;
    return groups;
  };

  SongFocus.prototype.catalogVersionsForGroup = function (groupKey) {
    const key = String(groupKey || this.groupKey || '').toLowerCase().trim();
    if (!versionsApi || !key) return [];
    return versionsApi.sortVersions(
      versionsApi.collectVersionsByGroupKey(this.songCatalog, key),
      'newest'
    );
  };

  SongFocus.prototype.videoOptions = function () {
    return this.libraryCache.filter(function (item) {
      return shared.canPlayAsVideo(item);
    });
  };

  SongFocus.prototype.fillVideoSelect = function (selectedId) {
    const self = this;
    const select = this.ui.heroVideoEl;
    const current = String(selectedId || select.value || '').trim();
    select.innerHTML = '<option value="">none</option>';
    this.videoOptions().forEach(function (item) {
      const opt = createEl('option', '', { value: item.playbackId });
      opt.textContent = self.itemLabel(item);
      select.appendChild(opt);
    });
    select.value = current;
  };

  SongFocus.prototype.refreshLibrary = function () {
    const self = this;
    return muxLib.listMuxLibrary().then(function (assets) {
      self.buildCatalog(assets);
      return self.libraryCache.slice();
    });
  };

  SongFocus.prototype.updateMeta = function () {
    const self = this;
    const group = this.songGroups.find(function (g) {
      return g.groupKey === self.groupKey;
    });
    this.ui.title.textContent = group ? group.title || 'song' : 'song';
  };

  SongFocus.prototype.versionEntryForEditor = function (playbackId) {
    const versions = (this.currentPage && this.currentPage.versions) || {};
    return store.normalizeVersionEntry(versions[playbackId]);
  };

  SongFocus.prototype.versionHasContent = function (entry) {
    return store.versionHasContent(entry);
  };

  SongFocus.prototype.pickDefaultVersionId = function (versions) {
    const list = versions || [];
    const keyId = this.currentPage ? String(this.currentPage.keyPlaybackId || '').trim() : '';
    if (keyId && list.some(function (s) { return s && s.playbackId === keyId; })) {
      return keyId;
    }
    for (let i = 0; i < list.length; i += 1) {
      const song = list[i];
      if (!song || !song.playbackId) continue;
      const entry = this.versionEntryForEditor(song.playbackId);
      if (this.versionHasContent(entry)) return song.playbackId;
    }
    return list[0] && list[0].playbackId ? list[0].playbackId : '';
  };

  SongFocus.prototype.renderVersionPicker = function () {
    const self = this;
    const versions = this.catalogVersionsForGroup(this.groupKey);
    const picker = this.ui.versionPicker;
    picker.innerHTML = '';

    if (!versions.length) {
      picker.appendChild(createEl('p', 'studio-focus-empty', { text: 'No versions.' }));
      this.syncKeyControls();
      return;
    }

    if (!this.activeVersionId || !versions.some(function (s) { return s.playbackId === self.activeVersionId; })) {
      this.activeVersionId = this.pickDefaultVersionId(versions);
    }

    const keyId = this.currentPage ? String(this.currentPage.keyPlaybackId || '').trim() : '';

    versions.forEach(function (song) {
      const chip = createEl('button', 'studio-song-designer-version-chip', {
        type: 'button',
        role: 'tab',
        'data-playback-id': song.playbackId
      });
      chip.setAttribute('aria-selected', song.playbackId === self.activeVersionId ? 'true' : 'false');
      const label = createEl('span', '', { text: versionsApi.displayTitleForSong(song) });
      chip.appendChild(label);

      if (keyId && song.playbackId === keyId) {
        const keyMark = createEl('span', 'studio-song-designer-version-chip-key', { text: 'key' });
        keyMark.setAttribute('aria-label', 'key version');
        chip.appendChild(keyMark);
        chip.classList.add('is-key');
      }

      const entry = self.versionEntryForEditor(song.playbackId);
      if (self.versionHasContent(entry)) {
        chip.appendChild(createEl('span', 'studio-song-designer-version-chip-dot', { 'aria-hidden': 'true' }));
      }

      chip.classList.toggle('is-active', song.playbackId === self.activeVersionId);
      chip.addEventListener('click', function () {
        self.playVersion(song);
      });
      picker.appendChild(chip);
    });

    this.syncKeyControls();
  };

  SongFocus.prototype.syncKeyControls = function () {
    const versions = this.catalogVersionsForGroup(this.groupKey);
    const self = this;
    if (!versions.length || !this.activeVersionId) {
      this.ui.keyBtn.hidden = true;
      this.ui.keyMeta.textContent = '';
      return;
    }
    this.ui.keyBtn.hidden = false;
    const keyId = this.currentPage ? String(this.currentPage.keyPlaybackId || '').trim() : '';
    const isKey = !!(keyId && keyId === this.activeVersionId);
    this.ui.keyBtn.textContent = isKey ? 'clear' : 'key';
    this.ui.keyBtn.classList.toggle('is-key-active', isKey);
    if (!keyId) {
      this.ui.keyMeta.textContent = '';
    } else {
      const keySong = versions.find(function (s) { return s.playbackId === keyId; });
      this.ui.keyMeta.textContent = keySong ? versionsApi.displayTitleForSong(keySong) : '';
    }
  };

  SongFocus.prototype.setKeyVersion = function (playbackId) {
    if (!this.currentPage || !this.groupKey) return;
    this.currentPage.keyPlaybackId = String(playbackId || '').trim();
    this.renderVersionPicker();
    this.debouncedSave();
  };

  SongFocus.prototype.toggleKeyVersion = function () {
    if (!this.currentPage || !this.activeVersionId) return;
    const keyId = String(this.currentPage.keyPlaybackId || '').trim();
    if (keyId && keyId === this.activeVersionId) {
      this.setKeyVersion('');
      return;
    }
    this.setKeyVersion(this.activeVersionId);
  };

  SongFocus.prototype.fillVersionEditorFields = function (playbackId) {
    const entry = this.versionEntryForEditor(playbackId);
    this.ui.lyricsEl.value = entry.lyrics || '';
    this.ui.versionNotesEl.value = entry.notes || '';
  };

  SongFocus.prototype.selectVersion = function (playbackId, userInitiated) {
    if (!playbackId || playbackId === this.activeVersionId) return;
    this.flushActiveVersionFields();
    this.activeVersionId = playbackId;
    this.fillVersionEditorFields(playbackId);
    this.renderVersionPicker();
    this.paintPreview();
    if (userInitiated && typeof this.onVersionSelect === 'function') {
      this.onVersionSelect(playbackId);
    }
  };

  SongFocus.prototype.playVersion = function (song) {
    const self = this;
    this.selectVersion(song.playbackId);
    const player = root.BurnfolderStreamPlayer;
    if (!player || !song || !song.playbackId) return;

    const versions = this.catalogVersionsForGroup(this.groupKey);
    const shell = root.BurnfolderStudioPlaybackShell;
    if (shell) {
      shell.ensureShell();
      shell.mountBar();
    }

    const audioItems = versions
      .map(function (s) {
        return self.libraryItemForSong(s);
      })
      .filter(function (row) {
        return row && !shared.canPlayAsVideo(row);
      });
    if (!audioItems.length) return;
    const idx = audioItems.findIndex(function (row) {
      return row.playbackId === song.playbackId;
    });
    player.playQueue(audioItems, idx >= 0 ? idx : 0);
  };

  SongFocus.prototype.libraryItemForSong = function (song) {
    if (!song) return null;
    const fromLib = shared.findInLibrary(this.libraryCache, song.playbackId);
    if (fromLib) {
      return Object.assign({}, fromLib, {
        passthrough: song.title,
        displayTitle: versionsApi.displayTitleForSong(song)
      });
    }
    return {
      playbackId: song.playbackId,
      passthrough: song.title,
      displayTitle: versionsApi.displayTitleForSong(song),
      kind: song.kind || 'audio',
      hasVideoTrack: song.hasVideoTrack,
      muxAssetId: song.muxAssetId || null,
      createdAt: song.createdAt || null
    };
  };

  SongFocus.prototype.migrateLegacyLyrics = function (versions, preferredPlaybackId) {
    const legacyLyrics = this.currentPage && typeof this.currentPage.lyrics === 'string'
      ? this.currentPage.lyrics.trim()
      : '';
    if (!legacyLyrics) return null;
    const hasVersionLyrics = Object.keys(this.currentPage.versions || {}).some(function (id) {
      return store.normalizeVersionEntry(self.currentPage.versions[id]).lyrics.trim();
    });
    if (hasVersionLyrics) return { lyrics: '' };
    const playbackId =
      preferredPlaybackId ||
      (versions && versions[0] && versions[0].playbackId ? versions[0].playbackId : '');
    if (!playbackId) return null;
    const versionsPatch = Object.assign({}, this.currentPage.versions || {});
    const existing = store.normalizeVersionEntry(versionsPatch[playbackId]);
    versionsPatch[playbackId] = store.normalizeVersionEntry({
      lyrics: legacyLyrics,
      notes: existing.notes
    });
    return { lyrics: '', versions: versionsPatch };
  };

  SongFocus.prototype.flushActiveVersionFields = function () {
    if (!this.currentPage || !this.activeVersionId || this.loadingPage) return;
    if (!this.currentPage.versions) this.currentPage.versions = {};
    const existing = store.normalizeVersionEntry(this.currentPage.versions[this.activeVersionId]);
    this.currentPage.versions[this.activeVersionId] = store.normalizeVersionEntry({
      lyrics: this.ui.lyricsEl ? this.ui.lyricsEl.value : existing.lyrics,
      notes: this.ui.versionNotesEl ? this.ui.versionNotesEl.value : existing.notes,
      media: Array.isArray(existing.media) ? existing.media.slice() : []
    });
  };

  SongFocus.prototype.readEditorState = function () {
    this.flushActiveVersionFields();
    return {
      notes: this.ui.notesEl ? this.ui.notesEl.value : '',
      lyrics: '',
      versions: Object.assign({}, this.currentPage ? this.currentPage.versions || {} : {}),
      keyPlaybackId: this.currentPage ? String(this.currentPage.keyPlaybackId || '').trim() : '',
      heroVideoPlaybackId: this.ui.heroVideoEl ? this.ui.heroVideoEl.value : '',
      coverArt: this.currentPage ? this.currentPage.coverArt || '' : '',
      coverAssetId: this.currentPage ? this.currentPage.coverAssetId || '' : '',
      media: this.currentPage ? (this.currentPage.media || []).slice() : []
    };
  };

  SongFocus.prototype.debouncedSave = function () {
    const self = this;
    if (this.loadingPage || !this.groupKey) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(function () {
      const patch = self.readEditorState();
      store
        .savePage(self.groupKey, patch)
        .then(function (saved) {
          self.currentPage = saved;
          self.setStatus('saved', 'success');
          self.paintPreview();
        })
        .catch(function (err) {
          self.setStatus(err.message || 'could not save', 'error');
        });
    }, 450);
  };

  SongFocus.prototype.bindAutosave = function (el) {
    const self = this;
    if (!el || el.dataset.bound === '1') return;
    el.dataset.bound = '1';
    el.addEventListener('input', function () { self.debouncedSave(); });
    el.addEventListener('change', function () { self.debouncedSave(); });
  };

  SongFocus.prototype.paintCoverPreview = function () {
    const self = this;
    const coverApi = root.BurnfolderCoverArt;
    const page = this.currentPage;
    if (!page || !page.coverArt) {
      this.ui.coverPreview.hidden = true;
      this.ui.coverPreview.removeAttribute('src');
      this.ui.coverClearBtn.hidden = true;
      return;
    }
    this.ui.coverPreview.hidden = false;
    this.ui.coverClearBtn.hidden = false;
    if (coverApi && coverApi.applyCoverImage) {
      coverApi.applyCoverImage(this.ui.coverPreview, page);
      return;
    }
    this.ui.coverPreview.src = page.coverArt;
  };

  SongFocus.prototype.paintPreview = function () {
    const self = this;
    const group = this.songGroups.find(function (g) { return g.groupKey === self.groupKey; });
    const catalogVersions = this.catalogVersionsForGroup(this.groupKey);

    const titleEl = this.ui.previewRoot.querySelector('.song-hub-title');
    const subtitleEl = this.ui.previewRoot.querySelector('.song-hub-subtitle');
    if (titleEl && group) titleEl.textContent = group.title;
    if (subtitleEl && group) {
      subtitleEl.textContent = group.count + ' version' + (group.count === 1 ? '' : 's');
    }

    if (this.activeVersionId) {
      this.ui.previewRoot.dataset.songVersionSelected = this.activeVersionId;
    }

    renderApi.apply(this.ui.previewRoot, {
      page: this.currentPage,
      baseTitle: group ? group.title : '',
      library: this.libraryCache,
      shared: shared,
      catalogVersions: catalogVersions,
      preferredPlaybackId: this.activeVersionId,
      showVersionPicker: true,
      onVersionSelect: function (playbackId) {
        const target = catalogVersions.find(function (item) {
          return item.playbackId === playbackId;
        });
        if (target) self.playVersion(target);
      }
    });

    if (this.activeVersionId && renderApi.selectVersion) {
      renderApi.selectVersion(this.ui.previewRoot, this.currentPage, this.activeVersionId);
    }
  };

  SongFocus.prototype.mountShareHub = function () {
    const self = this;
    const mount = this.ui.shareMount;
    const ui = root.BurnfolderShareHubUI;
    if (!mount || !ui || !this.groupKey) return;
    if (this.shareHubApi && this.shareHubApi.destroy) this.shareHubApi.destroy();
    const group = this.songGroups.find(function (g) { return g.groupKey === self.groupKey; });
    this.shareHubApi = ui.mount(mount, {
      context: 'song',
      embedded: true,
      groupKey: this.groupKey,
      getTitle: function () {
        return group ? group.title : self.groupKey;
      },
      getVersions: function () {
        return self.catalogVersionsForGroup(self.groupKey);
      },
      getCoverArt: function () {
        return self.currentPage && self.currentPage.coverArt ? self.currentPage.coverArt : '';
      }
    });
  };

  SongFocus.prototype.renderMediaEditor = function () {
    const self = this;
    const list = this.ui.mediaList;
    list.innerHTML = '';
    const items = this.currentPage && this.currentPage.media ? this.currentPage.media : [];
    if (!items.length) {
      const empty = createEl('li', 'studio-song-designer-media-empty', { text: 'No blocks.' });
      list.appendChild(empty);
      return;
    }

    items.forEach(function (item) {
      const li = createEl('li', 'studio-song-designer-media-item');
      li.dataset.id = item.id;

      const head = createEl('div', 'studio-song-designer-media-item-head');
      const handle = createEl('span', 'studio-song-designer-media-handle', { text: '≡', draggable: 'true' });
      handle.addEventListener('dragstart', function () {
        self.dragSrcId = item.id;
        li.classList.add('is-dragging');
      });
      handle.addEventListener('dragend', function () {
        li.classList.remove('is-dragging');
      });

      const kind = createEl('span', 'studio-song-designer-media-kind', { text: item.kind });
      const remove = createEl('button', 'icon-btn studio-song-designer-media-remove', { type: 'button', text: 'remove' });
      remove.addEventListener('click', function () {
        self.currentPage.media = (self.currentPage.media || []).filter(function (row) {
          return row.id !== item.id;
        });
        self.renderMediaEditor();
        self.debouncedSave();
      });

      head.appendChild(handle);
      head.appendChild(kind);
      head.appendChild(remove);
      li.appendChild(head);

      if (item.kind === 'video' || item.kind === 'audio') {
        if (item.playbackId) {
          const player = createEl('mux-player', 'studio-song-designer-block-media');
          player.setAttribute('playback-id', item.playbackId);
          player.setAttribute('stream-type', 'on-demand');
          player.setAttribute('playsinline', '');
          li.appendChild(player);
        } else {
          li.appendChild(createEl('p', 'studio-song-designer-media-preview', { text: 'no ' + item.kind }));
        }
        const actions = createEl('div', 'studio-song-designer-media-video-actions');
        const replaceBtn = createEl('button', 'icon-btn', { type: 'button', text: 'replace' });
        const replaceInput = createEl('input', '', { type: 'file', accept: 'image/*,audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov,.webm,.mkv,.jpg,.jpeg,.png,.webp,.gif', hidden: 'hidden' });
        replaceBtn.addEventListener('click', function () { replaceInput.click(); });
        replaceInput.addEventListener('change', function () {
          const picked = replaceInput.files && replaceInput.files[0];
          replaceInput.value = '';
          if (!picked) return;
          self.uploadBlockFile(picked).then(function (result) {
            item.playbackId = result.playbackId;
            item.kind = result.kind;
            if (result.title) item.title = result.title;
            self.renderMediaEditor();
            self.debouncedSave();
          }).catch(function (err) {
            self.setStatus(err.message || 'upload failed', 'error');
          });
        });
        actions.appendChild(replaceBtn);
        li.appendChild(actions);
        li.appendChild(replaceInput);
      } else if (item.kind === 'image') {
        if (item.imageData) {
          const img = createEl('img', 'studio-song-designer-media-thumb studio-song-designer-block-media');
          img.src = item.imageData;
          img.alt = item.title || 'Image';
          li.appendChild(img);
        }
        const upload = createEl('button', 'icon-btn', { type: 'button', text: item.imageData ? 'replace image' : 'upload image' });
        const file = createEl('input', '', { type: 'file', accept: 'image/*', hidden: 'hidden' });
        upload.addEventListener('click', function () { file.click(); });
        file.addEventListener('change', function () {
          const picked = file.files && file.files[0];
          if (!picked) return;
          const reader = new FileReader();
          reader.onload = function () {
            item.imageData = String(reader.result || '');
            self.renderMediaEditor();
            self.debouncedSave();
          };
          reader.readAsDataURL(picked);
        });
        li.appendChild(upload);
        li.appendChild(file);
      } else if (item.kind === 'link') {
        const hrefInput = createEl('input', 'studio-song-designer-media-title', { type: 'url', placeholder: 'https://… or 5.17.26.html' });
        hrefInput.value = item.href || '';
        hrefInput.addEventListener('input', function () {
          item.href = hrefInput.value;
          self.debouncedSave();
        });
        li.appendChild(hrefInput);
      } else {
        const text = createEl('textarea', 'studio-song-designer-textarea studio-song-designer-textarea--compact', {
          rows: '3',
          placeholder: 'word bubble…'
        });
        text.value = item.text || '';
        text.addEventListener('input', function () {
          item.text = text.value;
          self.debouncedSave();
        });
        li.appendChild(text);
      }

      list.appendChild(li);
    });
  };

  SongFocus.prototype.moveMediaItem = function (fromId, toId) {
    const items = this.currentPage && this.currentPage.media ? this.currentPage.media : [];
    const fromIndex = items.findIndex(function (row) { return row.id === fromId; });
    if (fromIndex < 0) return;
    const toIndex = toId
      ? items.findIndex(function (row) { return row.id === toId; })
      : items.length;
    if (toIndex < 0) return;
    if (fromIndex === toIndex) return;
    const moved = items.splice(fromIndex, 1)[0];
    let insertAt = toIndex;
    if (fromIndex < toIndex) insertAt -= 1;
    items.splice(insertAt, 0, moved);
    this.currentPage.media = items;
    this.renderMediaEditor();
    this.debouncedSave();
  };

  SongFocus.prototype.addMediaItem = function (kind) {
    if (!this.currentPage) return;
    const item = {
      id: store.makeId('media'),
      kind: kind,
      title: '',
      playbackId: '',
      href: '',
      text: '',
      imageData: ''
    };
    this.currentPage.media = (this.currentPage.media || []).concat([item]);
    this.renderMediaEditor();
    this.debouncedSave();
  };

  SongFocus.prototype.isImageFile = function (file) {
    const mime = String(file.type || '').toLowerCase();
    const ext = (file.name || '').split('.').pop().toLowerCase();
    if (mime.indexOf('image/') === 0) return true;
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].indexOf(ext) >= 0;
  };

  SongFocus.prototype.defaultDisplayTitle = function (name) {
    if (assetCloud && assetCloud.defaultDisplayTitle) {
      return assetCloud.defaultDisplayTitle(name);
    }
    const safe = String(name || 'untitled');
    const dot = safe.lastIndexOf('.');
    return dot > 0 ? safe.slice(0, dot) : safe;
  };

  SongFocus.prototype.uploadBlockFile = function (file) {
    const self = this;
    if (!file) return Promise.reject(new Error('choose a file'));
    if (this.isImageFile(file)) {
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () {
          resolve({
            kind: 'image',
            imageData: String(reader.result || ''),
            title: self.defaultDisplayTitle(file.name)
          });
        };
        reader.onerror = function () { reject(new Error('could not read image')); };
        reader.readAsDataURL(file);
      });
    }
    if (!assetCloud || !assetCloud.isMuxableFile || !assetCloud.isMuxableFile(file)) {
      return Promise.reject(new Error('choose an image, audio or video file'));
    }
    if (!assetCloud.addFiles) {
      return Promise.reject(new Error('upload unavailable'));
    }
    let queueId = '';
    if (this.uploadQueue) queueId = this.uploadQueue.add(file);
    this.setStatus('uploading ' + (file.type || 'file') + '…');
    return assetCloud
      .addFiles([file], {
        onProgress: function (_file, pct, phase) {
          if (!self.uploadQueue || !queueId) return;
          self.uploadQueue.update(queueId, { percent: pct, status: 'working', phase: phase, message: (phase || 'uploading') + ' ' + pct + '%' });
        },
        onFileSuccess: function () {
          if (!self.uploadQueue || !queueId) return;
          self.uploadQueue.update(queueId, { percent: 100, status: 'success', message: 'ready ✓' });
          self.uploadQueue.remove(queueId, 1600);
        },
        onFileError: function (_file, err) {
          if (!self.uploadQueue || !queueId) return;
          self.uploadQueue.update(queueId, { percent: 100, status: 'error', message: (err && err.message) || 'failed' });
          self.uploadQueue.remove(queueId, 8000);
        }
      })
      .then(function (added) {
        const asset = added && added[0];
        if (!asset || !asset.muxPlaybackId) {
          throw new Error('upload did not return a playback id');
        }
        return {
          kind: asset.kind === 'audio' ? 'audio' : 'video',
          playbackId: asset.muxPlaybackId,
          title: asset.displayTitle || self.defaultDisplayTitle(file.name)
        };
      });
  };

  SongFocus.prototype.addMediaFromFile = function (file) {
    const self = this;
    if (!this.currentPage) return;
    this.uploadBlockFile(file)
      .then(function (result) {
        const item = {
          id: store.makeId('media'),
          kind: result.kind,
          title: result.title || '',
          playbackId: result.playbackId || '',
          href: '',
          text: '',
          imageData: result.imageData || ''
        };
        self.currentPage.media = (self.currentPage.media || []).concat([item]);
        self.renderMediaEditor();
        self.debouncedSave();
        self.setStatus(result.kind + ' block added', 'success');
      })
      .catch(function (err) {
        self.setStatus(err.message || 'add failed', 'error');
      });
  };

  SongFocus.prototype.loadPage = function (groupKey) {
    const self = this;
    this.loadingPage = true;
    this.groupKey = String(groupKey || '').toLowerCase().trim();

    const group = this.songGroups.find(function (g) { return g.groupKey === self.groupKey; });
    this.ui.title.textContent = group ? group.title || 'song' : 'song';

    return store.getPage(this.groupKey).then(function (page) {
      const catalogVersions = self.catalogVersionsForGroup(self.groupKey);
      const catalogIds = catalogVersions.map(function (song) { return song.playbackId; });
      const reconciled = store.reconcileVersionsToCatalog(page.versions || {}, catalogIds);
      const versionsChanged =
        Object.keys(reconciled).sort().join('\0') !==
        Object.keys(page.versions || {}).sort().join('\0');
      let workingPage = versionsChanged
        ? Object.assign({}, page, { versions: reconciled })
        : page;
      if (versionsChanged) {
        store.savePage(self.groupKey, { versions: reconciled }).catch(function () {});
      }
      self.currentPage = workingPage;
      self.activeVersionId = self.pickDefaultVersionId(catalogVersions);
      const migration = self.migrateLegacyLyrics(catalogVersions, self.activeVersionId);
      if (migration) {
        self.currentPage = Object.assign({}, self.currentPage, migration);
        if (migration.versions) self.currentPage.versions = migration.versions;
        store.savePage(self.groupKey, migration).catch(function () {});
      }
      if (self.ui.notesEl) self.ui.notesEl.value = self.currentPage.notes || '';
      self.renderVersionPicker();
      self.fillVersionEditorFields(self.activeVersionId);
      self.fillVideoSelect(self.currentPage.heroVideoPlaybackId || '');
      self.paintCoverPreview();
      self.renderMediaEditor();
      self.paintPreview();
      self.mountShareHub();
      self.loadingPage = false;
      self.setStatus('');
    });
  };

  SongFocus.prototype.boot = function () {
    const self = this;
    this.refreshLibrary().then(function () {
      self.buildSongGroups(self.songCatalog);
      if (!self.groupKey) {
        const first = self.songGroups[0];
        self.groupKey = first ? first.groupKey : '';
      }
      if (!self.groupKey) {
        self.setStatus('upload songs in music first');
        return;
      }
      return self.loadPage(self.groupKey);
    }).catch(function (err) {
      self.setStatus(err.message || 'could not load library', 'error');
    });
  };

  SongFocus.prototype.bindEvents = function () {
    const self = this;

    this.ui.closeBtn.addEventListener('click', function () {
      if (typeof self.onClose === 'function') self.onClose();
    });

    this.ui.pushBtn.addEventListener('click', function () { self.pushToSite(); });

    this.bindAutosave(this.ui.notesEl);
    this.bindAutosave(this.ui.lyricsEl);
    this.bindAutosave(this.ui.versionNotesEl);
    this.bindAutosave(this.ui.heroVideoEl);

    this.ui.keyBtn.addEventListener('click', function () { self.toggleKeyVersion(); });

    this.ui.coverBtn.addEventListener('click', function () { self.ui.coverInput.click(); });
    this.ui.coverInput.addEventListener('change', function () {
      const file = self.ui.coverInput.files && self.ui.coverInput.files[0];
      self.ui.coverInput.value = '';
      if (!file || !self.currentPage) return;
      const coverApi = root.BurnfolderCoverArt;
      const group = self.songGroups.find(function (g) { return g.groupKey === self.groupKey; });
      const label = (group && group.title) || self.groupKey || file.name || 'song';
      if (!coverApi || !coverApi.registerCoverFromFile) {
        self.setStatus('image storage unavailable', 'error');
        return;
      }
      coverApi
        .registerCoverFromFile(file, label)
        .then(function (result) {
          coverApi.patchFromCoverResult(self.currentPage, result);
          self.paintCoverPreview();
          self.mountShareHub();
          self.setStatus('cover set', 'success');
          self.debouncedSave();
        })
        .catch(function (err) {
          self.setStatus(err.message || 'could not add cover', 'error');
        });
    });

    this.ui.coverClearBtn.addEventListener('click', function () {
      if (!self.currentPage) return;
      const coverApi = root.BurnfolderCoverArt;
      if (coverApi && coverApi.clearCoverMeta) coverApi.clearCoverMeta(self.currentPage);
      else {
        self.currentPage.coverArt = '';
        self.currentPage.coverAssetId = '';
      }
      self.paintCoverPreview();
      self.mountShareHub();
      self.debouncedSave();
    });

    this.ui.addTextBtn.addEventListener('click', function () { self.addMediaItem('text'); });
    this.ui.addMediaBtn.addEventListener('click', function () {
      self.ui.mediaInput.click();
    });
    this.ui.mediaInput.addEventListener('change', function () {
      const file = self.ui.mediaInput.files && self.ui.mediaInput.files[0];
      self.ui.mediaInput.value = '';
      if (!file) return;
      self.addMediaFromFile(file);
    });

    this.ui.copyIdBtn.addEventListener('click', function () {
      const id = self.activeVersionId;
      if (!id) return;
      const api = root.BurnfolderShareLinks;
      if (api && api.copyText) {
        api.copyText(id).then(function () {
          self.setStatus('copied ' + id, 'success');
        }).catch(function () {
          self.setStatus('could not copy', 'error');
        });
      } else if (navigator.clipboard && root.isSecureContext) {
        navigator.clipboard.writeText(id).then(function () {
          self.setStatus('copied ' + id, 'success');
        }).catch(function () {
          self.setStatus('could not copy', 'error');
        });
      }
    });

    this.ui.deleteVersionBtn.addEventListener('click', function () { self.deleteActiveVersion(); });

    this.ui.mediaList.addEventListener('dragover', function (e) { e.preventDefault(); });
    this.ui.mediaList.addEventListener('drop', function (e) {
      e.preventDefault();
      const targetLi = e.target.closest('li[data-id]');
      if (targetLi) {
        const toId = targetLi.dataset.id;
        if (self.dragSrcId && toId && self.dragSrcId !== toId) {
          self.moveMediaItem(self.dragSrcId, toId);
        }
      } else if (self.dragSrcId) {
        self.moveMediaItem(self.dragSrcId, null);
      }
      self.dragSrcId = '';
    });
  };

  SongFocus.prototype.deleteActiveVersion = function () {
    const self = this;
    const versions = this.catalogVersionsForGroup(this.groupKey);
    const song = versions.find(function (s) { return s.playbackId === self.activeVersionId; });
    if (!song || !song.muxAssetId) return;
    const label = shared.muxFileLabel(song);
    if (!window.confirm('delete "' + label + '" from mux? this cannot be undone.')) return;
    this.setStatus('deleting…');
    const player = root.BurnfolderStreamPlayer;
    if (player) player.stop();
    root.BurnfolderMux.deleteMuxAsset(song.muxAssetId)
      .then(function () {
        if (root.BurnfolderAssetCloud && root.BurnfolderAssetCloud.deleteByMuxAssetId) {
          return root.BurnfolderAssetCloud.deleteByMuxAssetId(song.muxAssetId);
        }
        return 0;
      })
      .then(function () {
        shared.removeFromStack(song.playbackId);
        return self.refreshLibrary();
      })
      .then(function () {
        self.buildSongGroups(self.songCatalog);
        return self.loadPage(self.groupKey);
      })
      .then(function () {
        self.setStatus('version deleted', 'success');
      })
      .catch(function (err) {
        self.setStatus(err.message || 'delete failed', 'error');
      });
  };

  SongFocus.prototype.pushToSite = function () {
    const self = this;
    if (!store.pushToSite) {
      this.setStatus('push not available', 'error');
      return;
    }

    function doPush() {
      const payload = store.getPublishedPayload ? store.getPublishedPayload() : {};
      const pageCount = Object.keys(payload).length;
      if (!pageCount) {
        self.setStatus('add content before pushing', 'error');
        return Promise.resolve();
      }
      if (!window.confirm(
        'Push ' + pageCount + ' song page' + (pageCount === 1 ? '' : 's') +
        ' to burnfolder.com?\n\nThis updates song-pages.js on the live site.'
      )) {
        return Promise.resolve();
      }
      self.ui.pushBtn.disabled = true;
      self.ui.pushBtn.textContent = 'pushing…';
      self.setStatus('pushing to site…');
      return store
        .pushToSite()
        .then(function (data) {
          self.setStatus((data && data.message) || 'pushed to site', 'success');
        })
        .catch(function (err) {
          self.setStatus(err.message || 'push failed', 'error');
        })
        .finally(function () {
          self.ui.pushBtn.disabled = false;
          self.ui.pushBtn.textContent = 'push';
        });
    }

    window.clearTimeout(this.saveTimer);
    const flush = this.groupKey && store.savePage
      ? store.savePage(this.groupKey, this.readEditorState())
      : Promise.resolve();
    flush.then(doPush).catch(function (err) {
      self.setStatus(err.message || 'could not save before push', 'error');
    });
  };

  SongFocus.prototype.destroy = function () {
    if (this.shareHubApi && this.shareHubApi.destroy) this.shareHubApi.destroy();
    if (this.container) this.container.innerHTML = '';
  };

  root.BurnfolderSongFocus = {
    mount: function (container, groupKey, options) {
      return new SongFocus(container, groupKey, options);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
