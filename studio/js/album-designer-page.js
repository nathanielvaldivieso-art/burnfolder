(function () {
  'use strict';

  const store = window.BurnfolderAlbumPageStore;
  const songStore = window.BurnfolderSongPageStore;
  const shared = window.BurnfolderStreamShared;
  const muxLib = window.BurnfolderStudioMux;
  const versionsApi = window.BurnfolderSongVersions;
  const albumRender = window.BurnfolderAlbumPageRender;

  if (!store || !shared || !muxLib) return;

  const params = new URLSearchParams(window.location.search);
  const initialAlbumId = (params.get('album') || '').trim();

  const albumPick = document.getElementById('albumDesignerPick');
  const albumMeta = document.getElementById('albumDesignerMeta');
  const notesEl = document.getElementById('albumDesignerNotes');
  const heroVideoEl = document.getElementById('albumDesignerHeroVideo');
  const mediaList = document.getElementById('albumDesignerMediaList');
  const previewRoot = document.getElementById('albumDesignerPreviewRoot');
  const previewTitle = document.getElementById('albumDesignerPreviewTitle');
  const previewSubtitle = document.getElementById('albumDesignerPreviewSubtitle');
  const statusEl = document.getElementById('albumDesignerStatus');
  const previewBtn = document.getElementById('albumDesignerPreviewBtn');
  const pushBtn = document.getElementById('albumDesignerPushBtn');
  const pickVideoBtn = document.getElementById('albumDesignerPickVideoBtn');
  const addImageBtn = document.getElementById('albumDesignerAddImageBtn');
  const addNoteBtn = document.getElementById('albumDesignerAddNoteBtn');
  const addLinkBtn = document.getElementById('albumDesignerAddLinkBtn');

  let libraryCache = [];
  let songCatalog = [];
  let activeAlbumId = '';
  let currentPage = null;
  let saveTimer = null;
  let loadingPage = false;

  function setStatus(msg, kind) {
    if (window.BurnfolderStudioStatus) {
      window.BurnfolderStudioStatus.set(statusEl, msg, kind);
      return;
    }
    if (statusEl) statusEl.textContent = msg || '';
  }

  function itemLabel(item) {
    return shared.muxFileLabel(item);
  }

  function buildCatalog(assets) {
    libraryCache = shared.normalizeLibrary(assets);
    if (!versionsApi) return libraryCache.slice();
    return versionsApi.mergeSongCatalog(versionsApi.getSiteCatalog(window), libraryCache, itemLabel);
  }

  function albumGroups() {
    return shared.loadGroups().filter(function (group) {
      return group && group.id && Array.isArray(group.tracks) && group.tracks.length;
    });
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

  function albumTracks(group) {
    return (group.tracks || [])
      .map(resolveStackTrackItem)
      .filter(function (item) {
        return item && item.playbackId && !shared.canPlayAsVideo(item);
      });
  }

  function videoOptions() {
    return libraryCache.filter(function (item) {
      return shared.canPlayAsVideo(item);
    });
  }

  function fillVideoSelect(selectEl, value) {
    if (!selectEl) return;
    const current = value || selectEl.value || '';
    selectEl.innerHTML = '<option value="">none</option>';
    videoOptions().forEach(function (item) {
      const opt = document.createElement('option');
      opt.value = item.playbackId;
      opt.textContent = itemLabel(item);
      selectEl.appendChild(opt);
    });
    selectEl.value = current;
  }

  function readEditorState() {
    return {
      notes: notesEl ? notesEl.value : '',
      heroVideoPlaybackId: heroVideoEl ? heroVideoEl.value : '',
      media: currentPage ? (currentPage.media || []).slice() : []
    };
  }

  function scheduleSave() {
    if (!activeAlbumId || loadingPage) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      store
        .savePage(activeAlbumId, readEditorState())
        .then(function (page) {
          currentPage = page;
          paintPreview();
          setStatus('saved');
        })
        .catch(function (err) {
          setStatus(err.message || 'save failed', 'error');
        });
    }, 500);
  }

  function renderMediaEditor() {
    if (!mediaList) return;
    mediaList.innerHTML = '';
    const items = currentPage && currentPage.media ? currentPage.media : [];
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'studio-song-designer-media-empty';
      empty.textContent = 'No visuals yet.';
      mediaList.appendChild(empty);
      return;
    }

    items.forEach(function (item) {
      const li = document.createElement('li');
      li.className = 'studio-song-designer-media-item';

      const head = document.createElement('div');
      head.className = 'studio-song-designer-media-item-head';
      const kind = document.createElement('span');
      kind.className = 'studio-song-designer-media-kind';
      kind.textContent = item.kind || 'note';
      head.appendChild(kind);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn studio-song-designer-media-remove';
      remove.textContent = 'remove';
      remove.addEventListener('click', function () {
        currentPage.media = (currentPage.media || []).filter(function (row) {
          return row.id !== item.id;
        });
        renderMediaEditor();
        scheduleSave();
      });
      head.appendChild(remove);
      li.appendChild(head);

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'studio-song-designer-media-title';
      titleInput.value = item.title || '';
      titleInput.placeholder = 'title';
      titleInput.addEventListener('input', function () {
        item.title = titleInput.value;
        scheduleSave();
      });
      li.appendChild(titleInput);

      if (item.kind === 'note' || item.kind === 'text') {
        const text = document.createElement('textarea');
        text.className = 'studio-song-designer-textarea';
        text.rows = 3;
        text.value = item.text || '';
        text.addEventListener('input', function () {
          item.text = text.value;
          scheduleSave();
        });
        li.appendChild(text);
      } else if (item.kind === 'link') {
        const hrefInput = document.createElement('input');
        hrefInput.type = 'url';
        hrefInput.className = 'studio-song-designer-media-title';
        hrefInput.value = item.href || '';
        hrefInput.placeholder = 'https://';
        hrefInput.addEventListener('input', function () {
          item.href = hrefInput.value;
          scheduleSave();
        });
        li.appendChild(hrefInput);
      } else if (item.kind === 'image' && item.imageData) {
        const img = document.createElement('img');
        img.className = 'studio-song-designer-media-thumb';
        img.src = item.imageData;
        img.alt = item.title || 'image';
        li.appendChild(img);
      } else if (item.kind === 'video' && item.playbackId) {
        const meta = document.createElement('p');
        meta.className = 'studio-song-designer-meta';
        meta.textContent = item.playbackId.slice(0, 12) + '…';
        li.appendChild(meta);
      }

      mediaList.appendChild(li);
    });
  }

  function addMediaItem(kind) {
    if (!currentPage) return;
    const item = {
      id: store.makeId('media'),
      kind: kind,
      title: '',
      playbackId: '',
      href: '',
      text: '',
      imageData: ''
    };
    currentPage.media = (currentPage.media || []).concat([item]);
    renderMediaEditor();
    scheduleSave();
  }

  function loadSongPagesForTracks(tracks) {
    const pages = {};
    if (!songStore || !versionsApi) return Promise.resolve(pages);
    const keys = {};
    tracks.forEach(function (item) {
      const key = versionsApi.getTrackGroupKey(itemLabel(item));
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
  }

  function paintPreview() {
    if (!albumRender || !previewRoot || !activeAlbumId) return;
    const group = shared.findGroupById(activeAlbumId);
    if (!group) return;
    const meta = shared.loadStackMeta(activeAlbumId);
    const tracks = albumTracks(group);

    if (previewTitle) previewTitle.textContent = meta.title || 'Album';
    if (previewSubtitle) {
      previewSubtitle.textContent =
        tracks.length + ' track' + (tracks.length === 1 ? '' : 's');
    }

    loadSongPagesForTracks(tracks).then(function (songPages) {
      albumRender.apply(previewRoot, {
        albumPage: currentPage,
        meta: meta,
        tracks: tracks,
        songPages: songPages,
        songCatalog: songCatalog,
        versionsApi: versionsApi,
        library: libraryCache,
        shared: shared,
        itemLabel: itemLabel,
        showSongLinks: false
      });
    });
  }

  function loadAlbumPage(albumId) {
    activeAlbumId = albumId;
    loadingPage = true;
    return store.getPage(albumId).then(function (page) {
      currentPage = page;
      if (notesEl) notesEl.value = page.notes || '';
      fillVideoSelect(heroVideoEl, page.heroVideoPlaybackId || '');
      renderMediaEditor();

      const group = shared.findGroupById(albumId);
      const meta = shared.loadStackMeta(albumId);
      if (albumMeta) {
        albumMeta.textContent = group
          ? (meta.title || 'untitled') + ' · ' + group.tracks.length + ' tracks'
          : 'album not found';
      }
      if (previewBtn) {
        previewBtn.href = shared.albumPageUrl(albumId);
        previewBtn.hidden = !group;
      }

      paintPreview();
      loadingPage = false;
    });
  }

  function populateAlbumPick() {
    if (!albumPick) return;
    const groups = albumGroups();
    albumPick.innerHTML = '';
    groups.forEach(function (group) {
      const meta = shared.loadStackMeta(group.id);
      const opt = document.createElement('option');
      opt.value = group.id;
      opt.textContent = (meta.title || 'untitled') + ' (' + group.tracks.length + ')';
      albumPick.appendChild(opt);
    });

    if (!groups.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'no albums yet';
      albumPick.appendChild(opt);
      return;
    }

    const pick =
      initialAlbumId && groups.some(function (g) { return g.id === initialAlbumId; })
        ? initialAlbumId
        : groups[0].id;
    albumPick.value = pick;
    loadAlbumPage(pick);
  }

  if (albumPick) {
    albumPick.addEventListener('change', function () {
      const id = albumPick.value;
      if (!id) return;
      const url = new URL(window.location.href);
      url.searchParams.set('album', id);
      window.history.replaceState({}, '', url.pathname + url.search);
      loadAlbumPage(id);
    });
  }

  if (notesEl) notesEl.addEventListener('input', scheduleSave);
  if (heroVideoEl) heroVideoEl.addEventListener('change', scheduleSave);

  if (pickVideoBtn) {
    pickVideoBtn.addEventListener('click', function () {
      const videos = videoOptions();
      if (!videos.length) {
        setStatus('no videos in library', 'error');
        return;
      }
      const pick = videos[0];
      addMediaItem('video');
      const last = currentPage.media[currentPage.media.length - 1];
      last.playbackId = pick.playbackId;
      last.title = itemLabel(pick);
      renderMediaEditor();
      scheduleSave();
    });
  }

  if (addImageBtn) {
    addImageBtn.addEventListener('click', function () {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', function () {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function () {
          addMediaItem('image');
          const last = currentPage.media[currentPage.media.length - 1];
          last.imageData = String(reader.result || '');
          last.title = file.name || 'image';
          renderMediaEditor();
          scheduleSave();
        };
        reader.readAsDataURL(file);
      });
      input.click();
    });
  }

  if (addNoteBtn) addNoteBtn.addEventListener('click', function () { addMediaItem('note'); });
  if (addLinkBtn) addLinkBtn.addEventListener('click', function () { addMediaItem('link'); });

  if (pushBtn) {
    pushBtn.addEventListener('click', function () {
      if (!store.pushToSite) {
        setStatus('push not available', 'error');
        return;
      }

      function doPush() {
        const payload = store.getPublishedPayload({
          shared: shared,
          versionsApi: versionsApi,
          songCatalog: songCatalog,
          itemLabel: itemLabel,
          resolveTrack: resolveStackTrackItem
        });
        const pageCount = Object.keys(payload).length;
        if (!pageCount) {
          setStatus('add content before pushing', 'error');
          return Promise.resolve();
        }

        if (
          !window.confirm(
            'Push ' +
              pageCount +
              ' album page' +
              (pageCount === 1 ? '' : 's') +
              ' to burnfolder.com?\n\nThis updates album-pages.js on the live site.'
          )
        ) {
          return Promise.resolve();
        }

        pushBtn.disabled = true;
        pushBtn.textContent = 'pushing…';
        setStatus('pushing to site…');

        return store
          .pushToSite({
            shared: shared,
            versionsApi: versionsApi,
            songCatalog: songCatalog,
            itemLabel: itemLabel,
            resolveTrack: resolveStackTrackItem
          })
          .then(function (data) {
            setStatus((data && data.message) || 'pushed to site', 'success');
          })
          .catch(function (err) {
            setStatus(err.message || 'push failed', 'error');
          })
          .finally(function () {
            pushBtn.disabled = false;
            pushBtn.textContent = 'push to site';
          });
      }

      window.clearTimeout(saveTimer);
      const flush = activeAlbumId
        ? store.savePage(activeAlbumId, readEditorState())
        : Promise.resolve();
      flush.then(doPush).catch(function (err) {
        setStatus(err.message || 'could not save before push', 'error');
      });
    });
  }

  document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
    const active = link.getAttribute('data-nav') === 'stream';
    link.classList.toggle('is-active', active);
    link.classList.toggle('page-nav', active);
  });

  Promise.all([
    store.ensureHydrated(),
    songStore ? songStore.ensureHydrated() : Promise.resolve(),
    muxLib.listMuxLibrary()
  ])
    .then(function (results) {
      songCatalog = buildCatalog(results[2] || []);
      fillVideoSelect(heroVideoEl, '');
      populateAlbumPick();
    })
    .catch(function (err) {
      setStatus(err.message || 'could not load', 'error');
    });
})();
