(function () {
  'use strict';

  const store = window.BurnfolderSongPageStore;
  const shared = window.BurnfolderStreamShared;
  const muxLib = window.BurnfolderStudioMux;
  const versionsApi = window.BurnfolderSongVersions;
  const renderApi = window.BurnfolderSongPageRender;
  const clipNaming = window.BurnfolderSongClipNaming;
  const assetCloud = window.BurnfolderAssetCloud;

  if (!store || !shared || !muxLib) return;

  const params = new URLSearchParams(window.location.search);
  const initialSongKey = (params.get('song') || '').toLowerCase().trim();

  const songPick = document.getElementById('designerSongPick');
  const songMeta = document.getElementById('designerSongMeta');
  const notesEl = document.getElementById('designerNotes');
  const versionPickerEl = document.getElementById('designerVersionPicker');
  const versionMetaEl = document.getElementById('designerVersionMeta');
  const versionLyricsEl = document.getElementById('designerVersionLyrics');
  const versionNotesEl = document.getElementById('designerVersionNotes');
  const heroVideoEl = document.getElementById('designerHeroVideo');
  const coverBtn = document.getElementById('designerCoverBtn');
  const coverClearBtn = document.getElementById('designerCoverClearBtn');
  const coverInput = document.getElementById('designerCoverInput');
  const coverPreview = document.getElementById('designerCoverPreview');
  const mediaList = document.getElementById('designerMediaList');
  const previewRoot = document.getElementById('designerPreviewRoot');
  const previewTitle = document.getElementById('designerPreviewTitle');
  const previewSubtitle = document.getElementById('designerPreviewSubtitle');
  const statusEl = document.getElementById('designerStatus');
  const previewBtn = document.getElementById('designerPreviewBtn');
  const siteBtn = document.getElementById('designerSiteBtn');
  const pushBtn = document.getElementById('designerPushBtn');
  const uploadClipBtn = document.getElementById('designerUploadClipBtn');
  const pickVideoBtn = document.getElementById('designerPickVideoBtn');
  const clipInput = document.getElementById('designerClipInput');
  const uploadQueueHost = document.getElementById('designerUploadQueue');
  const addImageBtn = document.getElementById('designerAddImageBtn');
  const addNoteBtn = document.getElementById('designerAddNoteBtn');
  const addLinkBtn = document.getElementById('designerAddLinkBtn');

  let libraryCache = [];
  let songCatalog = [];
  let songGroups = [];
  let activeGroupKey = '';
  let activeVersionId = '';
  let currentPage = null;
  let saveTimer = null;
  let loadingPage = false;
  let shareHubApi = null;
  let uploadQueue = window.BurnfolderUploadQueue
    ? window.BurnfolderUploadQueue.attach(uploadQueueHost)
    : null;

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

  function buildSongGroups(catalog) {
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
    return Array.from(map.values()).sort(function (a, b) {
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
  }

  function songGroupKeyForItem(item) {
    if (!item) return '';
    if (item.songGroupKey) return item.songGroupKey;
    if (!clipNaming || !versionsApi) return '';
    return clipNaming.inferSongGroupKey(
      item.passthrough || item.muxFileName || item.displayTitle || '',
      versionsApi
    );
  }

  function refreshDesignerLibrary() {
    return muxLib.listMuxLibrary().then(function (assets) {
      songCatalog = buildCatalog(assets);
      libraryCache = shared.normalizeLibrary(assets);
      return libraryCache;
    });
  }

  function videoOptions() {
    const all = libraryCache.filter(function (item) {
      return shared.canPlayAsVideo(item);
    });
    if (!activeGroupKey) return all;
    const songClips = [];
    const rest = [];
    all.forEach(function (item) {
      if (songGroupKeyForItem(item) === activeGroupKey) songClips.push(item);
      else rest.push(item);
    });
    return songClips.concat(rest);
  }

  function fillVideoSelectOptions(select, selectedId, groupLabel, items) {
    if (!items.length) return;
    const og = document.createElement('optgroup');
    og.label = groupLabel;
    items.forEach(function (video) {
      const opt = document.createElement('option');
      opt.value = video.playbackId;
      const short =
        clipNaming && songGroupKeyForItem(video) === activeGroupKey
          ? clipNaming.clipLabelFromPassthrough(itemLabel(video), video.songTitle)
          : itemLabel(video);
      opt.textContent = short || itemLabel(video);
      if (video.playbackId === selectedId) opt.selected = true;
      og.appendChild(opt);
    });
    select.appendChild(og);
  }

  function uploadSongClip(file, clipTitle) {
    const group = songGroups.find(function (g) {
      return g.groupKey === activeGroupKey;
    });
    if (!assetCloud || !clipNaming || !file || !group) {
      return Promise.reject(new Error('cannot upload clip'));
    }
    if (assetCloud.isMuxableFile && !assetCloud.isMuxableFile(file)) {
      return Promise.reject(new Error('choose a video file (mp4, mov, webm…)'));
    }

    const muxFileName = clipNaming.buildClipMuxFileName(group.title, clipTitle || '', file.name);
    const displayTitle = clipNaming.clipDisplayTitle(
      group.title,
      clipTitle || assetCloud.defaultDisplayTitle(file.name)
    );

    let queueId = '';
    if (uploadQueue) queueId = uploadQueue.add(file);
    setStatus('uploading clip to video library…');

    return assetCloud
      .addFiles([file], {
        fileMeta: function () {
          return {
            fileName: muxFileName,
            displayTitle: displayTitle,
            songGroupKey: group.groupKey,
            songTitle: group.title
          };
        },
        onProgress: function (_file, pct, phase) {
          if (!uploadQueue || !queueId) return;
          uploadQueue.update(queueId, {
            percent: pct,
            status: 'working',
            phase: phase,
            message: phase + ' ' + pct + '%'
          });
        },
        onFileSuccess: function () {
          if (!uploadQueue || !queueId) return;
          uploadQueue.update(queueId, {
            percent: 100,
            status: 'success',
            message: 'in video library ✓'
          });
          uploadQueue.remove(queueId, 1600);
        },
        onFileError: function (_file, err) {
          if (!uploadQueue || !queueId) return;
          uploadQueue.update(queueId, {
            percent: 100,
            status: 'error',
            message: (err && err.message) || 'failed'
          });
          uploadQueue.remove(queueId, 8000);
        }
      })
      .then(function (added) {
        const asset = added && added[0];
        if (!asset || !asset.muxPlaybackId) {
          throw new Error('upload did not return a playback id');
        }
        return refreshDesignerLibrary().then(function () {
          const label = clipNaming.clipLabelFromPassthrough(displayTitle, group.title);
          const mediaItem = {
            id: store.makeId('media'),
            kind: 'video',
            title: label,
            playbackId: asset.muxPlaybackId,
            href: '',
            text: '',
            imageData: ''
          };
          currentPage.media = (currentPage.media || []).concat([mediaItem]);
          renderMediaEditor();
          debouncedSave();
          setStatus('clip added to video library', 'success');
          return mediaItem;
        });
      });
  }

  function fillVideoSelect(select, selectedId) {
    if (!select) return;
    const current = selectedId || '';
    select.innerHTML = '<option value="">none</option>';
    videoOptions().forEach(function (item) {
      const opt = document.createElement('option');
      opt.value = item.playbackId;
      opt.textContent = itemLabel(item);
      if (item.playbackId === current) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function fillSongPick(groups, selectedKey) {
    if (!songPick) return;
    songPick.innerHTML = '';
    groups.forEach(function (group) {
      const opt = document.createElement('option');
      opt.value = group.groupKey;
      opt.textContent = group.title + ' (' + group.count + ' version' + (group.count === 1 ? '' : 's') + ')';
      if (group.groupKey === selectedKey) opt.selected = true;
      songPick.appendChild(opt);
    });
  }

  function updateMeta(group) {
    if (!songMeta) return;
    if (!group) {
      songMeta.textContent = '—';
      return;
    }
    songMeta.textContent =
      group.count + ' version' + (group.count === 1 ? '' : 's') + ' · key: ' + group.groupKey;
  }

  function updateLinks(group) {
    if (!group) return;
    if (previewBtn) {
      previewBtn.href = 'stream-song.html?song=' + encodeURIComponent(group.groupKey);
      previewBtn.hidden = false;
    }
    if (siteBtn && versionsApi) {
      const siteSong = group.newest;
      siteBtn.href = versionsApi.getSongHubHref(siteSong, '../');
      siteBtn.hidden = false;
    }
  }

  function catalogVersionsForGroup(groupKey) {
    if (!versionsApi || !groupKey) return [];
    const list = versionsApi.collectVersionsByGroupKey(songCatalog, groupKey);
    return versionsApi.sortVersions(list, 'newest');
  }

  function libraryItemForSong(song) {
    if (!song) return null;
    const fromLib = shared.findInLibrary(libraryCache, song.playbackId);
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
  }

  function audioQueueItems(versions) {
    return (versions || [])
      .map(libraryItemForSong)
      .filter(function (row) {
        return row && !shared.canPlayAsVideo(row);
      });
  }

  function syncDesignerVersionPickerPlayback() {
    const player = window.BurnfolderStreamPlayer;
    if (!player || !versionPickerEl) return;
    versionPickerEl.querySelectorAll('.studio-song-designer-version-chip').forEach(function (chip) {
      const id = chip.dataset.playbackId;
      chip.classList.toggle('is-playing', !!player.isPlayingPlaybackId(id));
    });
  }

  function playDesignerVersion(song) {
    const player = window.BurnfolderStreamPlayer;
    if (!player || !song || !song.playbackId) return;

    const versions = catalogVersionsForGroup(activeGroupKey);
    const active = player.getActiveSong();
    const onGroup =
      active &&
      versions.some(function (item) {
        return item.playbackId === active.playbackId;
      });

    if (song.playbackId !== activeVersionId) {
      selectDesignerVersion(song.playbackId);
    }

    if (onGroup && active.playbackId === song.playbackId) {
      player.togglePause();
      syncDesignerVersionPickerPlayback();
      return;
    }

    if (window.BurnfolderStudioPlaybackShell) {
      window.BurnfolderStudioPlaybackShell.ensureShell();
      window.BurnfolderStudioPlaybackShell.mountBar();
    }

    const audioItems = audioQueueItems(versions);
    if (!audioItems.length) return;
    const idx = audioItems.findIndex(function (row) {
      return row.playbackId === song.playbackId;
    });
    player.playQueue(audioItems, idx >= 0 ? idx : 0);
    syncDesignerVersionPickerPlayback();
  }

  function versionEntryForEditor(page, playbackId) {
    const versions = (page && page.versions) || {};
    return store.normalizeVersionEntry(versions[playbackId]);
  }

  function migrateLegacyPageLyrics(page, versions, preferredPlaybackId) {
    const legacyLyrics = page && typeof page.lyrics === 'string' ? page.lyrics.trim() : '';
    if (!legacyLyrics) return null;
    const list = versions || [];
    const hasVersionLyrics = Object.keys(page.versions || {}).some(function (id) {
      return store.normalizeVersionEntry(page.versions[id]).lyrics.trim();
    });
    if (hasVersionLyrics) return { lyrics: '' };
    const playbackId =
      preferredPlaybackId ||
      (list[0] && list[0].playbackId ? list[0].playbackId : '');
    if (!playbackId) return null;
    const versionsPatch = Object.assign({}, page.versions || {});
    const existing = store.normalizeVersionEntry(versionsPatch[playbackId]);
    versionsPatch[playbackId] = store.normalizeVersionEntry({
      lyrics: legacyLyrics,
      notes: existing.notes
    });
    return { lyrics: '', versions: versionsPatch };
  }

  function flushActiveVersionFields() {
    if (!currentPage || !activeVersionId || loadingPage) return;
    if (!currentPage.versions) currentPage.versions = {};
    currentPage.versions[activeVersionId] = store.normalizeVersionEntry({
      lyrics: versionLyricsEl ? versionLyricsEl.value : '',
      notes: versionNotesEl ? versionNotesEl.value : ''
    });
  }

  function pickDefaultVersionId(page, versions) {
    const list = versions || [];
    for (let i = 0; i < list.length; i += 1) {
      const song = list[i];
      if (!song || !song.playbackId) continue;
      const entry = versionEntryForEditor(page, song.playbackId);
      if (store.versionHasContent(entry)) return song.playbackId;
    }
    return list[0] && list[0].playbackId ? list[0].playbackId : '';
  }

  function renderDesignerVersionPicker() {
    if (!versionPickerEl) return;
    const versions = catalogVersionsForGroup(activeGroupKey);
    versionPickerEl.innerHTML = '';

    if (!versions.length) {
      if (versionMetaEl) {
        versionMetaEl.hidden = false;
        versionMetaEl.textContent = 'No catalog versions yet — upload mixes in music first.';
      }
      return;
    }

    if (versionMetaEl) versionMetaEl.hidden = true;

    if (!activeVersionId || !versions.some(function (s) { return s.playbackId === activeVersionId; })) {
      activeVersionId = pickDefaultVersionId(currentPage, versions);
    }

    versions.forEach(function (song) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'studio-song-designer-version-chip';
      chip.dataset.playbackId = song.playbackId;
      chip.setAttribute('role', 'tab');
      chip.setAttribute(
        'aria-selected',
        song.playbackId === activeVersionId ? 'true' : 'false'
      );

      const label = document.createElement('span');
      label.textContent = versionsApi.displayTitleForSong(song);
      chip.appendChild(label);

      const row = versionEntryForEditor(currentPage, song.playbackId);
      if (store.versionHasContent(row)) {
        const dot = document.createElement('span');
        dot.className = 'studio-song-designer-version-chip-dot';
        dot.setAttribute('aria-hidden', 'true');
        chip.appendChild(dot);
      }

      chip.classList.toggle('is-active', song.playbackId === activeVersionId);
      chip.addEventListener('click', function () {
        playDesignerVersion(song);
      });
      versionPickerEl.appendChild(chip);
    });
    syncDesignerVersionPickerPlayback();
  }

  function fillVersionEditorFields(playbackId) {
    const entry = versionEntryForEditor(currentPage, playbackId);
    if (versionLyricsEl) versionLyricsEl.value = entry.lyrics || '';
    if (versionNotesEl) versionNotesEl.value = entry.notes || '';
  }

  function selectDesignerVersion(playbackId) {
    if (!playbackId || playbackId === activeVersionId) return;
    flushActiveVersionFields();
    activeVersionId = playbackId;
    fillVersionEditorFields(playbackId);
    renderDesignerVersionPicker();
    if (previewRoot) previewRoot.dataset.songVersionSelected = playbackId;
    paintPreview();
  }

  function mountShareHub() {
    const mount = document.getElementById('designerShareMount');
    const ui = window.BurnfolderShareHubUI;
    if (!mount || !ui || !versionsApi || !activeGroupKey) return;
    if (shareHubApi && shareHubApi.destroy) shareHubApi.destroy();
    const group = songGroups.find(function (g) {
      return g.groupKey === activeGroupKey;
    });
    shareHubApi = ui.mount(mount, {
      context: 'song',
      groupKey: activeGroupKey,
      getTitle: function () {
        return group ? group.title : activeGroupKey;
      },
      getVersions: function () {
        return catalogVersionsForGroup(activeGroupKey);
      },
      getCoverArt: function () {
        return currentPage && currentPage.coverArt ? currentPage.coverArt : '';
      }
    });
  }

  function paintPreview() {
    if (!previewRoot || !renderApi) return;
    const group = songGroups.find(function (g) {
      return g.groupKey === activeGroupKey;
    });
    const catalogVersions = catalogVersionsForGroup(activeGroupKey);
    if (previewTitle && group) previewTitle.textContent = group.title;
    if (previewSubtitle && group) {
      previewSubtitle.textContent =
        group.count + ' version' + (group.count === 1 ? '' : 's');
    }
    renderApi.apply(previewRoot, {
      page: currentPage,
      baseTitle: group ? group.title : '',
      library: libraryCache,
      shared: shared,
      catalogVersions: catalogVersions,
      showVersionPicker: true,
      onVersionSelect: function (playbackId) {
        const target = catalogVersions.find(function (item) {
          return item.playbackId === playbackId;
        });
        if (target) playDesignerVersion(target);
      }
    });
    if (activeVersionId && renderApi.selectVersion) {
      renderApi.selectVersion(previewRoot, currentPage, activeVersionId);
    }
  }

  function paintCoverPreview(page) {
    if (!coverPreview) return;
    const coverApi = window.BurnfolderCoverArt;
    if (!page || !page.coverArt) {
      coverPreview.hidden = true;
      coverPreview.removeAttribute('src');
      if (coverClearBtn) coverClearBtn.hidden = true;
      return;
    }
    coverPreview.hidden = false;
    if (coverClearBtn) coverClearBtn.hidden = false;
    if (coverApi && coverApi.applyCoverImage) {
      coverApi.applyCoverImage(coverPreview, page);
      return;
    }
    coverPreview.src = page.coverArt;
  }

  function readEditorState() {
    flushActiveVersionFields();
    return {
      notes: notesEl ? notesEl.value : '',
      lyrics: '',
      versions: Object.assign({}, currentPage ? currentPage.versions || {} : {}),
      heroVideoPlaybackId: heroVideoEl ? heroVideoEl.value : '',
      coverArt: currentPage ? currentPage.coverArt || '' : '',
      coverAssetId: currentPage ? currentPage.coverAssetId || '' : '',
      media: currentPage ? (currentPage.media || []).slice() : []
    };
  }

  function debouncedSave() {
    if (loadingPage || !activeGroupKey) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      const patch = readEditorState();
      store
        .savePage(activeGroupKey, patch)
        .then(function (saved) {
          currentPage = saved;
          setStatus('saved', 'success');
          paintPreview();
        })
        .catch(function (err) {
          setStatus(err.message || 'could not save', 'error');
        });
    }, 450);
  }

  function bindAutosave(el) {
    if (!el || el.dataset.bound === '1') return;
    el.dataset.bound = '1';
    el.addEventListener('input', debouncedSave);
    el.addEventListener('change', debouncedSave);
  }

  function renderMediaEditor() {
    if (!mediaList) return;
    mediaList.innerHTML = '';
    const items = currentPage && currentPage.media ? currentPage.media : [];
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'studio-song-designer-media-empty';
      empty.textContent = 'No clips yet — add video, images, notes, or links.';
      mediaList.appendChild(empty);
      return;
    }

    items.forEach(function (item) {
      const li = document.createElement('li');
      li.className = 'studio-song-designer-media-item';
      li.dataset.id = item.id;

      const head = document.createElement('div');
      head.className = 'studio-song-designer-media-item-head';

      const kind = document.createElement('span');
      kind.className = 'studio-song-designer-media-kind';
      kind.textContent = item.kind;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn studio-song-designer-media-remove';
      remove.textContent = 'remove';
      remove.addEventListener('click', function () {
        currentPage.media = (currentPage.media || []).filter(function (row) {
          return row.id !== item.id;
        });
        renderMediaEditor();
        debouncedSave();
      });

      head.appendChild(kind);
      head.appendChild(remove);
      li.appendChild(head);

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'studio-song-designer-media-title';
      titleInput.value = item.title || '';
      titleInput.placeholder = item.kind === 'video' ? 'clip title (used in video library name)' : 'title';
      titleInput.addEventListener('input', function () {
        item.title = titleInput.value;
        debouncedSave();
      });
      li.appendChild(titleInput);

      if (item.kind === 'video') {
        const select = document.createElement('select');
        select.className = 'studio-song-designer-select';
        const current = item.playbackId || '';
        const songVideos = videoOptions().filter(function (video) {
          return songGroupKeyForItem(video) === activeGroupKey;
        });
        const otherVideos = videoOptions().filter(function (video) {
          return songGroupKeyForItem(video) !== activeGroupKey;
        });
        fillVideoSelectOptions(select, current, 'this song', songVideos);
        fillVideoSelectOptions(select, current, 'video library', otherVideos);
        if (!songVideos.length && !otherVideos.length) {
          const empty = document.createElement('option');
          empty.value = '';
          empty.textContent = 'upload a clip first';
          select.appendChild(empty);
        }
        select.addEventListener('change', function () {
          item.playbackId = select.value;
          debouncedSave();
        });
        li.appendChild(select);

        const actions = document.createElement('div');
        actions.className = 'studio-song-designer-media-video-actions';

        const replaceBtn = document.createElement('button');
        replaceBtn.type = 'button';
        replaceBtn.className = 'icon-btn';
        replaceBtn.textContent = 'upload clip';
        const replaceInput = document.createElement('input');
        replaceInput.type = 'file';
        replaceInput.accept = 'video/*,.mp4,.mov,.webm,.mkv';
        replaceInput.hidden = true;
        replaceBtn.addEventListener('click', function () {
          replaceInput.click();
        });
        replaceInput.addEventListener('change', function () {
          const picked = replaceInput.files && replaceInput.files[0];
          replaceInput.value = '';
          if (!picked) return;
          uploadSongClip(picked, titleInput.value)
            .then(function (mediaItem) {
              item.playbackId = mediaItem.playbackId;
              if (!titleInput.value.trim()) {
                item.title = mediaItem.title;
                titleInput.value = mediaItem.title;
              }
              renderMediaEditor();
            })
            .catch(function (err) {
              setStatus(err.message || 'upload failed', 'error');
            });
        });

        const libraryLink = document.createElement('a');
        libraryLink.className = 'icon-btn';
        libraryLink.href = 'video.html';
        libraryLink.textContent = 'video library';

        actions.appendChild(replaceBtn);
        actions.appendChild(libraryLink);
        li.appendChild(actions);
        li.appendChild(replaceInput);
      } else if (item.kind === 'image') {
        if (item.imageData) {
          const img = document.createElement('img');
          img.className = 'studio-song-designer-media-thumb';
          img.src = item.imageData;
          img.alt = item.title || 'Image';
          li.appendChild(img);
        }
        const upload = document.createElement('button');
        upload.type = 'button';
        upload.className = 'icon-btn';
        upload.textContent = item.imageData ? 'replace image' : 'upload image';
        const file = document.createElement('input');
        file.type = 'file';
        file.accept = 'image/*';
        file.hidden = true;
        upload.addEventListener('click', function () {
          file.click();
        });
        file.addEventListener('change', function () {
          const picked = file.files && file.files[0];
          if (!picked) return;
          const reader = new FileReader();
          reader.onload = function () {
            item.imageData = String(reader.result || '');
            renderMediaEditor();
            debouncedSave();
          };
          reader.readAsDataURL(picked);
        });
        li.appendChild(upload);
        li.appendChild(file);
      } else if (item.kind === 'link') {
        const hrefInput = document.createElement('input');
        hrefInput.type = 'url';
        hrefInput.className = 'studio-song-designer-media-title';
        hrefInput.value = item.href || '';
        hrefInput.placeholder = 'https://… or 5.17.26.html';
        hrefInput.addEventListener('input', function () {
          item.href = hrefInput.value;
          debouncedSave();
        });
        li.appendChild(hrefInput);
      } else {
        const text = document.createElement('textarea');
        text.className = 'studio-song-designer-textarea studio-song-designer-textarea--compact';
        text.rows = 3;
        text.value = item.text || '';
        text.placeholder = 'note text…';
        text.addEventListener('input', function () {
          item.text = text.value;
          debouncedSave();
        });
        li.appendChild(text);
      }

      mediaList.appendChild(li);
    });
  }

  function addMediaItem(kind) {
    if (!currentPage) return;
    const songVideos = videoOptions().filter(function (video) {
      return songGroupKeyForItem(video) === activeGroupKey;
    });
    const defaultVideo = songVideos[0] || videoOptions()[0];
    const item = {
      id: store.makeId('media'),
      kind: kind,
      title: '',
      playbackId: kind === 'video' && defaultVideo ? defaultVideo.playbackId : '',
      href: '',
      text: '',
      imageData: ''
    };
    currentPage.media = (currentPage.media || []).concat([item]);
    renderMediaEditor();
    debouncedSave();
  }

  function loadPage(groupKey) {
    loadingPage = true;
    activeGroupKey = groupKey;
    const group = songGroups.find(function (g) {
      return g.groupKey === groupKey;
    });
    updateMeta(group);
    updateLinks(group);

    return store.getPage(groupKey).then(function (page) {
      currentPage = page;
      const catalogVersions = catalogVersionsForGroup(groupKey);
      activeVersionId = pickDefaultVersionId(page, catalogVersions);
      const migration = migrateLegacyPageLyrics(page, catalogVersions, activeVersionId);
      if (migration) {
        currentPage = Object.assign({}, page, migration);
        if (migration.versions) currentPage.versions = migration.versions;
        store.savePage(groupKey, migration).catch(function () {});
      }
      if (notesEl) notesEl.value = currentPage.notes || '';
      renderDesignerVersionPicker();
      fillVersionEditorFields(activeVersionId);
      fillVideoSelect(heroVideoEl, page.heroVideoPlaybackId || '');
      paintCoverPreview(page);
      renderMediaEditor();
      paintPreview();
      mountShareHub();
      loadingPage = false;
      setStatus('');
    });
  }

  function selectSong(groupKey) {
    if (!groupKey) return;
    const url = new URL(window.location.href);
    url.searchParams.set('song', groupKey);
    window.history.replaceState({}, '', url.pathname + url.search);
    loadPage(groupKey);
  }

  if (songPick) {
    songPick.addEventListener('change', function () {
      selectSong(songPick.value);
    });
  }

  bindAutosave(notesEl);
  bindAutosave(versionLyricsEl);
  bindAutosave(versionNotesEl);
  bindAutosave(heroVideoEl);

  if (coverBtn && coverInput) {
    coverBtn.addEventListener('click', function () {
      coverInput.click();
    });
    coverInput.addEventListener('change', function () {
      const file = coverInput.files && coverInput.files[0];
      coverInput.value = '';
      if (!file || !currentPage) return;
      const coverApi = window.BurnfolderCoverArt;
      const group = songGroups.find(function (row) {
        return row.groupKey === activeGroupKey;
      });
      const label = (group && group.title) || activeGroupKey || file.name || 'song';
      if (!coverApi || !coverApi.registerCoverFromFile) {
        setStatus('image storage unavailable', 'error');
        return;
      }
      coverApi
        .registerCoverFromFile(file, label)
        .then(function (result) {
          coverApi.patchFromCoverResult(currentPage, result);
          paintCoverPreview(currentPage);
          setStatus('cover → ' + currentPage.coverArt + ' (saved to downloads — move to site IMAGES/)', 'success');
          debouncedSave();
        })
        .catch(function (err) {
          setStatus(err.message || 'could not add cover', 'error');
        });
    });
  }

  if (coverClearBtn) {
    coverClearBtn.addEventListener('click', function () {
      if (!currentPage) return;
      const coverApi = window.BurnfolderCoverArt;
      if (coverApi && coverApi.clearCoverMeta) coverApi.clearCoverMeta(currentPage);
      else {
        currentPage.coverArt = '';
        currentPage.coverAssetId = '';
      }
      paintCoverPreview(currentPage);
      coverClearBtn.hidden = true;
      debouncedSave();
    });
  }

  if (uploadClipBtn && clipInput) {
    uploadClipBtn.addEventListener('click', function () {
      clipInput.click();
    });
    clipInput.addEventListener('change', function () {
      const file = clipInput.files && clipInput.files[0];
      clipInput.value = '';
      if (!file) return;
      uploadSongClip(file, '')
        .catch(function (err) {
          setStatus(err.message || 'upload failed', 'error');
        });
    });
  }

  if (pickVideoBtn) {
    pickVideoBtn.addEventListener('click', function () {
      addMediaItem('video');
    });
  }

  if (addImageBtn) addImageBtn.addEventListener('click', function () { addMediaItem('image'); });
  if (addNoteBtn) addNoteBtn.addEventListener('click', function () { addMediaItem('note'); });
  if (addLinkBtn) addLinkBtn.addEventListener('click', function () { addMediaItem('link'); });

  if (pushBtn) {
    pushBtn.addEventListener('click', function () {
      if (!store.pushToSite) {
        setStatus('push not available', 'error');
        return;
      }

      function doPush() {
        const payload = store.getPublishedPayload ? store.getPublishedPayload() : {};
        const pageCount = Object.keys(payload).length;
        if (!pageCount) {
          setStatus('add content before pushing', 'error');
          return Promise.resolve();
        }

        if (
          !window.confirm(
            'Push ' +
              pageCount +
              ' song page' +
              (pageCount === 1 ? '' : 's') +
              ' to burnfolder.com?\n\nThis updates song-pages.js on the live site.'
          )
        ) {
          return Promise.resolve();
        }

        pushBtn.disabled = true;
        pushBtn.textContent = 'pushing…';
        setStatus('pushing to site…');

        return store
          .pushToSite()
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
      const flush =
        activeGroupKey && store.savePage
          ? store.savePage(activeGroupKey, readEditorState())
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

  window.addEventListener('burnfolder-stream-playback', function () {
    syncDesignerVersionPickerPlayback();
  });

  window.addEventListener('burnfolder-assets-changed', function () {
    refreshDesignerLibrary()
      .then(function () {
        renderMediaEditor();
        paintPreview();
      })
      .catch(function () {});
  });

  muxLib
    .listMuxLibrary()
    .then(function (assets) {
      songCatalog = buildCatalog(assets);
      songGroups = buildSongGroups(songCatalog);
      const provider = {
        getCatalog: function () {
          return songCatalog;
        },
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
      if (!songGroups.length) {
        setStatus('upload songs in music first');
        return;
      }
      const startKey =
        initialSongKey && songGroups.some(function (g) { return g.groupKey === initialSongKey; })
          ? initialSongKey
          : songGroups[0].groupKey;
      fillSongPick(songGroups, startKey);
      return loadPage(startKey);
    })
    .catch(function (err) {
      setStatus(err.message || 'could not load library', 'error');
    });
})();
