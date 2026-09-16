/**
 * Reusable album public-page editor that mounts inside a container.
 * Mirrors the capabilities of album-designer.html so it can live inside clips.html.
 */
(function (root) {
  'use strict';

  const store = root.BurnfolderAlbumPageStore;
  const songStore = root.BurnfolderSongPageStore;
  const shared = root.BurnfolderStreamShared;
  const muxLib = root.BurnfolderStudioMux;
  const versionsApi = root.BurnfolderSongVersions;
  const albumRender = root.BurnfolderAlbumPageRender;
  const coverArt = root.BurnfolderCoverArt;

  if (!store || !shared || !muxLib || !albumRender) return;

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

  function setStatus(statusEl, msg, kind) {
    if (!statusEl) return;
    if (root.BurnfolderStudioStatus) {
      root.BurnfolderStudioStatus.set(statusEl, msg, kind);
      return;
    }
    statusEl.textContent = msg || '';
  }

  function buildUi(container) {
    const rootEl = createEl('div', 'studio-focus studio-album-focus');
    rootEl.setAttribute('aria-label', 'Album page editor');

    const header = createEl('header', 'studio-focus-header');
    const closeBtn = createEl('button', 'icon-btn studio-focus-close', { type: 'button', text: 'close' });
    const title = createEl('h2', 'studio-focus-title', { text: 'Album' });
    const pushBtn = createEl('button', 'icon-btn studio-focus-push', { type: 'button', text: 'push' });
    header.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(pushBtn);

    const body = createEl('div', 'studio-focus-body');

    const editor = createEl('div', 'studio-focus-editor');

    const titleSection = createEl('section', 'studio-focus-section');
    titleSection.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'title' }));
    const titleInput = createEl('input', 'studio-song-designer-input', { type: 'text', placeholder: 'untitled', spellcheck: 'false', autocomplete: 'off' });
    titleSection.appendChild(titleInput);
    const meta = createEl('p', 'studio-focus-meta', { text: '—' });
    titleSection.appendChild(meta);

    const coverSection = createEl('section', 'studio-focus-section');
    coverSection.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'cover art' }));
    const coverRow = createEl('div', 'studio-song-designer-cover-row');
    const coverBtn = createEl('button', 'icon-btn', { type: 'button', text: 'choose cover' });
    const coverClearBtn = createEl('button', 'icon-btn', { type: 'button', text: 'remove' });
    const coverInput = createEl('input', '', { type: 'file', accept: 'image/*', hidden: 'hidden' });
    coverRow.appendChild(coverBtn);
    coverRow.appendChild(coverClearBtn);
    coverRow.appendChild(coverInput);
    coverSection.appendChild(coverRow);
    const coverPreview = createEl('img', 'studio-song-designer-cover-preview', { alt: '' });
    coverSection.appendChild(coverPreview);

    const notesSection = createEl('section', 'studio-focus-section');
    notesSection.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'thoughts' }));
    notesSection.appendChild(createEl('p', 'studio-focus-hint', { text: 'Album-level notes shown on the album hub. Song lyrics and notes compile automatically from each song page.' }));
    const notesEl = createEl('textarea', 'studio-song-designer-textarea studio-song-designer-textarea--tall', { rows: '8', placeholder: 'thoughts about this album…', spellcheck: 'false' });
    notesSection.appendChild(notesEl);

    const videoSection = createEl('section', 'studio-focus-section');
    videoSection.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'hero video' }));
    videoSection.appendChild(createEl('p', 'studio-focus-hint', { text: 'Optional hero video on the album hub.' }));
    const heroVideoEl = createEl('select', 'studio-song-designer-select');
    heroVideoEl.appendChild(createEl('option', '', { value: '', text: 'none' }));
    videoSection.appendChild(heroVideoEl);

    const visualsSection = createEl('section', 'studio-focus-section');
    const visualsHead = createEl('div', 'studio-focus-section-head');
    visualsHead.appendChild(createEl('h3', 'studio-focus-section-title', { text: 'visuals' }));
    const visualsActions = createEl('div', 'studio-focus-section-actions');
    const addVideoBtn = createEl('button', 'icon-btn', { type: 'button', text: 'from library' });
    const addImageBtn = createEl('button', 'icon-btn', { type: 'button', text: '+ image' });
    const addNoteBtn = createEl('button', 'icon-btn', { type: 'button', text: '+ note' });
    const addLinkBtn = createEl('button', 'icon-btn', { type: 'button', text: '+ link' });
    visualsActions.appendChild(addVideoBtn);
    visualsActions.appendChild(addImageBtn);
    visualsActions.appendChild(addNoteBtn);
    visualsActions.appendChild(addLinkBtn);
    visualsHead.appendChild(visualsActions);
    visualsSection.appendChild(visualsHead);
    const mediaList = createEl('ul', 'studio-song-designer-media-list');
    visualsSection.appendChild(mediaList);

    editor.appendChild(titleSection);
    editor.appendChild(coverSection);
    editor.appendChild(notesSection);
    editor.appendChild(videoSection);
    editor.appendChild(visualsSection);

    const previewWrap = createEl('div', 'studio-focus-preview-wrap');
    previewWrap.appendChild(createEl('p', 'studio-song-designer-preview-label', { text: 'preview' }));
    const previewRoot = createEl('div', 'studio-song-designer-preview song-hub-page');
    previewRoot.innerHTML =
      '<div class="song-hub-header">' +
      '<div class="song-hub-header-text">' +
      '<h2 class="song-hub-title" data-album-field="title">Album</h2>' +
      '<p class="song-hub-subtitle" data-album-field="subtitle">—</p>' +
      '<p class="song-hub-meta" data-album-field="track-meta" hidden></p>' +
      '</div></div>' +
      '<div class="song-hub-cover-row">' +
      '<div data-album-panel="cover" class="song-hub-cover-wrap" hidden>' +
      '<img data-album-field="cover" class="song-hub-cover-image" alt=""></div>' +
      '<button type="button" class="bottom-play-pause-btn song-hub-play" id="albumFocusPlay" hidden aria-label="Play album"></button>' +
      '</div>' +
      '<div data-album-panel="video" class="song-hub-panel" hidden>' +
      '<div data-album-field="video-hero" class="song-hub-video-hero"></div></div>' +
      '<div data-album-panel="links" class="song-hub-panel" hidden>' +
      '<nav class="album-hub-links" data-album-field="links" aria-label="Album links"></nav></div>' +
      '<div class="song-hub-panel"><div data-album-field="tracklist"></div></div>' +
      '<div data-album-panel="thoughts" class="song-hub-panel" hidden>' +
      '<div class="song-hub-panel-top"><p class="song-hub-label">Thoughts</p></div>' +
      '<div class="song-hub-notes" data-album-field="thoughts"></div></div>' +
      '<div data-album-panel="compiled-notes" class="song-hub-panel" hidden>' +
      '<div class="song-hub-panel-top"><p class="song-hub-label">Notes</p></div>' +
      '<div data-album-field="compiled-notes"></div></div>' +
      '<div data-album-panel="visuals" class="song-hub-panel" hidden>' +
      '<div class="song-hub-panel-top"><p class="song-hub-label">Visuals</p></div>' +
      '<div class="song-hub-content-grid" data-album-field="visuals-grid"></div></div>';
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
      titleInput: titleInput,
      meta: meta,
      coverBtn: coverBtn,
      coverClearBtn: coverClearBtn,
      coverInput: coverInput,
      coverPreview: coverPreview,
      notesEl: notesEl,
      heroVideoEl: heroVideoEl,
      addVideoBtn: addVideoBtn,
      addImageBtn: addImageBtn,
      addNoteBtn: addNoteBtn,
      addLinkBtn: addLinkBtn,
      mediaList: mediaList,
      previewRoot: previewRoot,
      statusEl: statusEl
    };
  }

  function AlbumFocus(container, albumId, options) {
    const opts = options || {};
    this.container = container;
    this.albumId = String(albumId || '').trim();
    this.block = (opts && opts.block) || null;
    this.ui = buildUi(container);
    this.libraryCache = [];
    this.songCatalog = [];
    this.currentPage = null;
    this.saveTimer = null;
    this.loadingPage = false;
    this.syncingTitle = false;

    this.bindEvents();
    this.boot();
  }

  AlbumFocus.prototype.setStatus = function (msg, kind) {
    setStatus(this.ui.statusEl, msg, kind);
  };

  AlbumFocus.prototype.itemLabel = function (item) {
    return shared.muxFileLabel(item);
  };

  AlbumFocus.prototype.buildCatalog = function (assets) {
    this.libraryCache = shared.normalizeLibrary(assets);
    if (!versionsApi) return this.libraryCache.slice();
    this.songCatalog = versionsApi.mergeSongCatalog(
      versionsApi.getSiteCatalog(root),
      this.libraryCache,
      this.itemLabel.bind(this)
    );
    return this.songCatalog.slice();
  };

  AlbumFocus.prototype.refreshLibrary = function () {
    const self = this;
    return muxLib.listMuxLibrary().then(function (assets) {
      self.buildCatalog(assets);
      return self.libraryCache.slice();
    });
  };

  AlbumFocus.prototype.albumTitleLabel = function (meta) {
    return (meta && meta.title) || 'untitled';
  };

  AlbumFocus.prototype.group = function () {
    return shared.findGroupById(this.albumId);
  };

  AlbumFocus.prototype.meta = function () {
    return shared.loadStackMeta(this.albumId);
  };

  AlbumFocus.prototype.resolveStackTrackItem = function (track) {
    if (!track || !track.playbackId) return track;
    const libItem = shared.findInLibrary(this.libraryCache, track.playbackId) || track;
    if (!versionsApi) return libItem;
    const newest = versionsApi.resolveNewestSongInCatalog(
      this.songCatalog,
      { title: track.title || this.itemLabel(libItem), playbackId: libItem.playbackId },
      this.itemLabel.bind(this)
    );
    if (!newest || !newest.playbackId) return libItem;
    return shared.findInLibrary(this.libraryCache, newest.playbackId) || libItem;
  };

  AlbumFocus.prototype.albumTracks = function (group) {
    return (group && group.tracks || [])
      .map(this.resolveStackTrackItem.bind(this))
      .filter(function (item) {
        return item && item.playbackId && !shared.canPlayAsVideo(item);
      });
  };

  AlbumFocus.prototype.videoOptions = function () {
    return this.libraryCache.filter(function (item) {
      return shared.canPlayAsVideo(item);
    });
  };

  AlbumFocus.prototype.fillVideoSelect = function (value) {
    const select = this.ui.heroVideoEl;
    const current = String(value || select.value || '').trim();
    select.innerHTML = '<option value="">none</option>';
    this.videoOptions().forEach(function (item) {
      const opt = createEl('option', '', { value: item.playbackId });
      opt.textContent = itemLabel(item);
      select.appendChild(opt);
    });
    select.value = current;
  };

  AlbumFocus.prototype.readEditorState = function () {
    return {
      notes: this.ui.notesEl ? this.ui.notesEl.value : '',
      heroVideoPlaybackId: this.ui.heroVideoEl ? this.ui.heroVideoEl.value : '',
      media: this.currentPage ? (this.currentPage.media || []).slice() : []
    };
  };

  AlbumFocus.prototype.scheduleSave = function () {
    const self = this;
    if (!this.albumId || this.loadingPage) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(function () {
      store
        .savePage(self.albumId, self.readEditorState())
        .then(function (page) {
          self.currentPage = page;
          self.paintPreview();
          self.setStatus('saved', 'success');
        })
        .catch(function (err) {
          self.setStatus(err.message || 'save failed', 'error');
        });
    }, 500);
  };

  AlbumFocus.prototype.paintAlbumChrome = function () {
    const group = this.group();
    const meta = this.meta();
    const fallbackTitle = (this.block && this.block.title) || '';
    const effectiveTitle = meta.title || fallbackTitle;
    this.syncingTitle = true;
    if (this.ui.titleInput) {
      if (document.activeElement !== this.ui.titleInput) {
        this.ui.titleInput.value = effectiveTitle;
      }
      this.ui.titleInput.disabled = !group;
    }
    this.syncingTitle = false;
    if (this.ui.meta) {
      if (!group) {
        this.ui.meta.textContent = 'album not found';
      } else if (group.tracks && group.tracks.length) {
        this.ui.meta.textContent = this.albumTitleLabel(meta) + ' · ' + group.tracks.length + ' tracks';
      } else {
        this.ui.meta.textContent = (this.albumTitleLabel(meta) || 'untitled') + ' · no tracks';
      }
    }
    this.ui.title.textContent = this.albumTitleLabel(meta) || effectiveTitle || 'Album';
  };

  AlbumFocus.prototype.paintCoverPreview = function (meta) {
    const coverApi = root.BurnfolderCoverArt;
    if (!meta || !(meta.coverArt || meta.coverAssetId)) {
      this.ui.coverPreview.hidden = true;
      this.ui.coverPreview.removeAttribute('src');
      this.ui.coverClearBtn.hidden = true;
      return;
    }
    this.ui.coverPreview.hidden = false;
    this.ui.coverClearBtn.hidden = false;
    if (coverApi && coverApi.applyCoverImage) {
      coverApi.applyCoverImage(this.ui.coverPreview, meta);
      return;
    }
    this.ui.coverPreview.src = meta.coverArt;
  };

  AlbumFocus.prototype.saveAlbumTitle = function (title) {
    if (!this.albumId || this.syncingTitle) return;
    const meta = this.meta();
    meta.title = title || '';
    if (meta.coverArt) meta.coverAlt = meta.title || meta.coverAlt || 'cover art';
    this.syncingTitle = true;
    shared.saveStackMeta(meta, this.albumId);
    this.syncingTitle = false;
    this.paintAlbumChrome();
    this.paintPreview();
    this.setStatus('saved', 'success');
  };

  AlbumFocus.prototype.loadSongPagesForTracks = function (tracks) {
    const self = this;
    const pages = {};
    if (!songStore || !versionsApi) return Promise.resolve(pages);
    const keys = {};
    tracks.forEach(function (item) {
      const key = versionsApi.getTrackGroupKey(self.itemLabel(item));
      if (key) keys[key] = true;
    });
    const list = Object.keys(keys);
    if (!list.length) return Promise.resolve(pages);
    return Promise.all(
      list.map(function (key) {
        return songStore.resolvePage(key, true).then(function (page) {
          pages[key] = page;
        });
      })
    ).then(function () {
      return pages;
    });
  };

  AlbumFocus.prototype.paintPreview = function () {
    const self = this;
    const group = this.group();
    if (!group || !albumRender) return;
    const meta = this.meta();
    const tracks = this.albumTracks(group);

    this.loadSongPagesForTracks(tracks).then(function (songPages) {
      albumRender.apply(self.ui.previewRoot, {
        albumPage: self.currentPage,
        meta: meta,
        tracks: tracks,
        songPages: songPages,
        songCatalog: self.songCatalog,
        versionsApi: versionsApi,
        library: self.libraryCache,
        shared: shared,
        itemLabel: self.itemLabel.bind(self),
        resolveTrack: self.resolveStackTrackItem.bind(self),
        songPageUrl: function (item) {
          return versionsApi && versionsApi.getSongHubHref ? versionsApi.getSongHubHref(item, '') : '';
        },
        showSongLinks: true,
        onRendered: function () {
          const playBtn = self.ui.previewRoot.querySelector('#albumFocusPlay');
          if (!playBtn) return;
          playBtn.hidden = !tracks.length;
        }
      });
    });
  };

  AlbumFocus.prototype.renderMediaEditor = function () {
    const self = this;
    const list = this.ui.mediaList;
    list.innerHTML = '';
    const items = this.currentPage && this.currentPage.media ? this.currentPage.media : [];
    if (!items.length) {
      list.appendChild(createEl('li', 'studio-song-designer-media-empty', { text: 'No visuals yet.' }));
      return;
    }

    items.forEach(function (item) {
      const li = createEl('li', 'studio-song-designer-media-item');

      const head = createEl('div', 'studio-song-designer-media-item-head');
      const kind = createEl('span', 'studio-song-designer-media-kind', { text: item.kind || 'note' });
      const remove = createEl('button', 'icon-btn studio-song-designer-media-remove', { type: 'button', text: 'remove' });
      remove.addEventListener('click', function () {
        self.currentPage.media = (self.currentPage.media || []).filter(function (row) {
          return row.id !== item.id;
        });
        self.renderMediaEditor();
        self.scheduleSave();
      });
      head.appendChild(kind);
      head.appendChild(remove);
      li.appendChild(head);

      const titleInput = createEl('input', 'studio-song-designer-media-title', { type: 'text', placeholder: 'title' });
      titleInput.value = item.title || '';
      titleInput.addEventListener('input', function () {
        item.title = titleInput.value;
        self.scheduleSave();
      });
      li.appendChild(titleInput);

      if (item.kind === 'note' || item.kind === 'text') {
        const text = createEl('textarea', 'studio-song-designer-textarea', { rows: '3' });
        text.value = item.text || '';
        text.addEventListener('input', function () {
          item.text = text.value;
          self.scheduleSave();
        });
        li.appendChild(text);
      } else if (item.kind === 'link') {
        const hrefInput = createEl('input', 'studio-song-designer-media-title', { type: 'url', placeholder: 'https://' });
        hrefInput.value = item.href || '';
        hrefInput.addEventListener('input', function () {
          item.href = hrefInput.value;
          self.scheduleSave();
        });
        li.appendChild(hrefInput);
      } else if (item.kind === 'image' && item.imageData) {
        const img = createEl('img', 'studio-song-designer-media-thumb');
        img.src = item.imageData;
        img.alt = item.title || 'image';
        li.appendChild(img);
      } else if (item.kind === 'video' && item.playbackId) {
        li.appendChild(createEl('p', 'studio-song-designer-meta', { text: item.playbackId.slice(0, 12) + '…' }));
      }

      list.appendChild(li);
    });
  };

  AlbumFocus.prototype.addMediaItem = function (kind) {
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
    this.scheduleSave();
  };

  AlbumFocus.prototype.loadAlbumPage = function (albumId) {
    const self = this;
    this.albumId = String(albumId || '').trim();
    this.loadingPage = true;
    return store.getPage(this.albumId).then(function (page) {
      self.currentPage = page;
      if (self.ui.notesEl) self.ui.notesEl.value = page.notes || '';
      self.fillVideoSelect(page.heroVideoPlaybackId || '');
      self.paintAlbumChrome();
      self.paintCoverPreview(self.meta());
      self.renderMediaEditor();
      self.paintPreview();
      self.loadingPage = false;
      self.setStatus('');
    });
  };

  AlbumFocus.prototype.bindEvents = function () {
    const self = this;

    this.ui.closeBtn.addEventListener('click', function () {
      if (typeof self.onClose === 'function') self.onClose();
    });

    this.ui.pushBtn.addEventListener('click', function () { self.pushToSite(); });

    this.ui.titleInput.addEventListener('input', function () {
      self.saveAlbumTitle(self.ui.titleInput.value);
    });

    this.ui.notesEl.addEventListener('input', function () { self.scheduleSave(); });
    this.ui.heroVideoEl.addEventListener('change', function () { self.scheduleSave(); });

    this.ui.coverBtn.addEventListener('click', function () { self.ui.coverInput.click(); });
    this.ui.coverInput.addEventListener('change', function () {
      const file = self.ui.coverInput.files && self.ui.coverInput.files[0];
      self.ui.coverInput.value = '';
      if (!file || !self.albumId) return;
      const coverApi = root.BurnfolderCoverArt;
      if (!coverApi || !coverApi.registerCoverFromFile) {
        self.setStatus('image storage unavailable', 'error');
        return;
      }
      const meta = self.meta();
      coverApi
        .registerCoverFromFile(file, meta.title || self.albumId || file.name || 'album')
        .then(function (result) {
          coverApi.patchFromCoverResult(meta, result);
          meta.coverAlt = meta.title ? meta.title + ' cover' : 'album cover';
          shared.saveStackMeta(meta, self.albumId);
          self.paintCoverPreview(meta);
          self.paintPreview();
          self.setStatus('cover set', 'success');
        })
        .catch(function (err) {
          self.setStatus(err.message || 'could not add cover', 'error');
        });
    });

    this.ui.coverClearBtn.addEventListener('click', function () {
      if (!self.albumId) return;
      const meta = self.meta();
      const coverApi = root.BurnfolderCoverArt;
      if (coverApi && coverApi.clearCoverMeta) coverApi.clearCoverMeta(meta);
      else {
        meta.coverArt = '';
        meta.coverAssetId = '';
      }
      shared.saveStackMeta(meta, self.albumId);
      self.paintCoverPreview(meta);
      self.paintPreview();
      self.setStatus('cover removed');
    });

    this.ui.addVideoBtn.addEventListener('click', function () {
      const videos = self.videoOptions();
      if (!videos.length) {
        self.setStatus('no videos in library', 'error');
        return;
      }
      const pick = videos[0];
      self.addMediaItem('video');
      const last = self.currentPage.media[self.currentPage.media.length - 1];
      last.playbackId = pick.playbackId;
      last.title = self.itemLabel(pick);
      self.renderMediaEditor();
      self.scheduleSave();
    });

    this.ui.addImageBtn.addEventListener('click', function () {
      const input = createEl('input', '', { type: 'file', accept: 'image/*', hidden: 'hidden' });
      input.addEventListener('change', function () {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function () {
          self.addMediaItem('image');
          const last = self.currentPage.media[self.currentPage.media.length - 1];
          last.imageData = String(reader.result || '');
          last.title = file.name || 'image';
          self.renderMediaEditor();
          self.scheduleSave();
        };
        reader.readAsDataURL(file);
      });
      input.click();
    });

    this.ui.addNoteBtn.addEventListener('click', function () { self.addMediaItem('note'); });
    this.ui.addLinkBtn.addEventListener('click', function () { self.addMediaItem('link'); });
  };

  AlbumFocus.prototype.pushToSite = function () {
    const self = this;
    if (!store.pushToSite) {
      this.setStatus('push not available', 'error');
      return;
    }

    function doPush() {
      const payload = store.getPublishedPayload({
        shared: shared,
        versionsApi: versionsApi,
        songCatalog: self.songCatalog,
        itemLabel: self.itemLabel.bind(self),
        resolveTrack: self.resolveStackTrackItem.bind(self)
      });
      const pageCount = Object.keys(payload).length;
      if (!pageCount) {
        self.setStatus('no albums to push — add an album stack first', 'error');
        return Promise.resolve();
      }
      if (!window.confirm(
        'Push ' + pageCount + ' album page' + (pageCount === 1 ? '' : 's') +
        ' to burnfolder.com?\n\nThis updates album-pages.js on the live site.'
      )) {
        return Promise.resolve();
      }
      self.ui.pushBtn.disabled = true;
      self.ui.pushBtn.textContent = 'pushing…';
      self.setStatus('pushing to site…');
      return store
        .pushToSite({
          shared: shared,
          versionsApi: versionsApi,
          songCatalog: self.songCatalog,
          itemLabel: self.itemLabel.bind(self),
          resolveTrack: self.resolveStackTrackItem.bind(self)
        })
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
    const flush = this.albumId
      ? store.savePage(this.albumId, this.readEditorState())
      : Promise.resolve();
    flush.then(doPush).catch(function (err) {
      self.setStatus(err.message || 'could not save before push', 'error');
    });
  };

  AlbumFocus.prototype.seedMetaFromBlock = function () {
    if (!this.block || !this.albumId) return;
    const meta = shared.loadStackMeta(this.albumId);
    let changed = false;
    if (!meta.title && this.block.title) {
      meta.title = this.block.title;
      changed = true;
    }
    if (!meta.coverArt && this.block.coverArt) {
      meta.coverArt = this.block.coverArt;
      meta.coverAssetId = this.block.coverAssetId || '';
      meta.coverAlt = meta.title || meta.coverAlt || 'cover art';
      changed = true;
    }
    if (changed) shared.saveStackMeta(meta, this.albumId);
  };

  AlbumFocus.prototype.boot = function () {
    const self = this;
    console.log('[album-focus] boot albumId=', self.albumId, 'block=', self.block);
    Promise.all([
      store.ensureHydrated(),
      songStore ? songStore.ensureHydrated() : Promise.resolve(),
      this.refreshLibrary()
    ])
      .then(function () {
        if (!self.albumId) {
          const first = shared.loadGroups()[0];
          self.albumId = first ? first.id : '';
        }
        if (!self.albumId) {
          self.setStatus('no albums yet');
          return;
        }
        self.seedMetaFromBlock();
        console.log('[album-focus] groups=', shared.loadGroups().map(function (g) { return g.id; }));
        return self.loadAlbumPage(self.albumId);
      })
      .catch(function (err) {
        console.error('[album-focus] boot error', err);
        self.setStatus(err.message || 'could not load', 'error');
      });
  };

  AlbumFocus.prototype.destroy = function () {
    if (this.container) this.container.innerHTML = '';
  };

  root.BurnfolderAlbumFocus = {
    mount: function (container, albumId, options) {
      return new AlbumFocus(container, albumId, options);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
