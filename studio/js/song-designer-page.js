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
  const paramPlayback = (params.get('p') || '').trim();

  const songPick = document.getElementById('designerSongPick');
  const songMeta = document.getElementById('designerSongMeta');
  const notesEl = document.getElementById('designerNotes');
  const versionPickerEl = document.getElementById('designerVersionPicker');
  const versionMetaEl = document.getElementById('designerVersionMeta');
  const keyRowEl = document.getElementById('designerKeyRow');
  const keyBtnEl = document.getElementById('designerKeyBtn');
  const keyMetaEl = document.getElementById('designerKeyMeta');
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
  const mediaInput = document.getElementById('designerMediaInput');
  const uploadQueueHost = document.getElementById('designerUploadQueue');
  const addTextBtn = document.getElementById('designerAddTextBtn');
  const addMediaBtn = document.getElementById('designerAddMediaBtn');
  const copyIdBtn = document.getElementById('designerCopyIdBtn');
  const deleteVersionBtn = document.getElementById('designerDeleteVersionBtn');

  let libraryCache = [];
  let songCatalog = [];
  let songGroups = [];
  let activeGroupKey = '';
  let activeVersionId = '';
  let currentPage = null;
  let saveTimer = null;
  let loadingPage = false;
  let shareHubApi = null;
  let dragSrcId = '';
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

  function defaultDisplayTitle(name) {
    if (assetCloud && assetCloud.defaultDisplayTitle) {
      return assetCloud.defaultDisplayTitle(name);
    }
    const safe = String(name || 'untitled');
    const dot = safe.lastIndexOf('.');
    return dot > 0 ? safe.slice(0, dot) : safe;
  }

  function isImageFile(file) {
    const mime = String(file.type || '').toLowerCase();
    const ext = (file.name || '').split('.').pop().toLowerCase();
    if (mime.indexOf('image/') === 0) return true;
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].indexOf(ext) >= 0;
  }

  function uploadBlockFile(file) {
    if (!file) return Promise.reject(new Error('choose a file'));
    if (isImageFile(file)) {
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () {
          resolve({
            kind: 'image',
            imageData: String(reader.result || ''),
            title: defaultDisplayTitle(file.name)
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
    if (uploadQueue) queueId = uploadQueue.add(file);
    setStatus('uploading ' + (file.type || 'file') + '…');
    return assetCloud
      .addFiles([file], {
        onProgress: function (_file, pct, phase) {
          if (!uploadQueue || !queueId) return;
          uploadQueue.update(queueId, {
            percent: pct,
            status: 'working',
            phase: phase,
            message: (phase || 'uploading') + ' ' + pct + '%'
          });
        },
        onFileSuccess: function () {
          if (!uploadQueue || !queueId) return;
          uploadQueue.update(queueId, {
            percent: 100,
            status: 'success',
            message: 'ready ✓'
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
        return {
          kind: asset.kind === 'audio' ? 'audio' : 'video',
          playbackId: asset.muxPlaybackId,
          title: asset.displayTitle || defaultDisplayTitle(file.name)
        };
      });
  }

  function addMediaFromFile(file) {
    if (!currentPage) return;
    uploadBlockFile(file)
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
        currentPage.media = (currentPage.media || []).concat([item]);
        renderMediaEditor();
        debouncedSave();
        setStatus(result.kind + ' block added', 'success');
      })
      .catch(function (err) {
        setStatus(err.message || 'add failed', 'error');
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
    songMeta.textContent = group ? (group.title || 'song') : 'song';
  }

  function updateVersionTools() {
    if (!copyIdBtn && !deleteVersionBtn) return;
    const versions = catalogVersionsForGroup(activeGroupKey);
    const song = versions.find(function (s) { return s.playbackId === activeVersionId; });
    if (copyIdBtn) {
      copyIdBtn.hidden = !song;
      if (song) copyIdBtn.dataset.playbackId = song.playbackId;
    }
    if (deleteVersionBtn) {
      deleteVersionBtn.hidden = !song || !song.muxAssetId;
      if (song) deleteVersionBtn.dataset.playbackId = song.playbackId;
    }
  }

  function deleteActiveVersion() {
    const versions = catalogVersionsForGroup(activeGroupKey);
    const song = versions.find(function (s) { return s.playbackId === activeVersionId; });
    if (!song || !song.muxAssetId) return;
    const label = shared.muxFileLabel(song);
    if (!window.confirm('delete "' + label + '" from mux? this cannot be undone.')) return;
    setStatus('deleting…');
    const player = window.BurnfolderStreamPlayer;
    if (player) player.stop();
    window.BurnfolderMux.deleteMuxAsset(song.muxAssetId)
      .then(function () {
        if (window.BurnfolderAssetCloud && window.BurnfolderAssetCloud.deleteByMuxAssetId) {
          return window.BurnfolderAssetCloud.deleteByMuxAssetId(song.muxAssetId);
        }
        return 0;
      })
      .then(function () {
        shared.removeFromStack(song.playbackId);
        return refreshDesignerLibrary();
      })
      .then(function () {
        songGroups = buildSongGroups(songCatalog);
        loadPage(activeGroupKey);
        setStatus('version deleted', 'success');
      })
      .catch(function (err) {
        setStatus(err.message || 'delete failed', 'error');
      });
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

    if (song.playbackId !== activeVersionId) {
      selectDesignerVersion(song.playbackId);
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
    const existing = store.normalizeVersionEntry(currentPage.versions[activeVersionId]);
    currentPage.versions[activeVersionId] = store.normalizeVersionEntry({
      lyrics: versionLyricsEl ? versionLyricsEl.value : existing.lyrics,
      notes: versionNotesEl ? versionNotesEl.value : existing.notes,
      media: Array.isArray(existing.media) ? existing.media.slice() : []
    });
  }

  function pickDefaultVersionId(page, versions) {
    const list = versions || [];
    const keyId = page ? String(page.keyPlaybackId || '').trim() : '';
    if (keyId && list.some(function (s) { return s && s.playbackId === keyId; })) {
      return keyId;
    }
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
        versionMetaEl.textContent = 'No versions.';
      }
      if (keyRowEl) keyRowEl.hidden = true;
      return;
    }

    if (versionMetaEl) versionMetaEl.hidden = true;

    if (!activeVersionId || !versions.some(function (s) { return s.playbackId === activeVersionId; })) {
      activeVersionId = pickDefaultVersionId(currentPage, versions);
    }

    const keyId = currentPage ? String(currentPage.keyPlaybackId || '').trim() : '';

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

      if (keyId && song.playbackId === keyId) {
        const keyMark = document.createElement('span');
        keyMark.className = 'studio-song-designer-version-chip-key';
        keyMark.textContent = 'key';
        keyMark.setAttribute('aria-label', 'key version');
        chip.appendChild(keyMark);
        chip.classList.add('is-key');
      }

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
    syncKeyVersionControls();
  }

  function syncKeyVersionControls() {
    if (!keyRowEl || !keyBtnEl) return;
    const versions = catalogVersionsForGroup(activeGroupKey);
    if (!versions.length || !activeVersionId) {
      keyRowEl.hidden = true;
      return;
    }
    keyRowEl.hidden = false;
    const keyId = currentPage ? String(currentPage.keyPlaybackId || '').trim() : '';
    const isKey = !!(keyId && keyId === activeVersionId);
    keyBtnEl.textContent = isKey ? 'clear' : 'key';
    keyBtnEl.classList.toggle('is-key-active', isKey);
    if (keyMetaEl) {
      if (!keyId) {
        keyMetaEl.textContent = '';
      } else {
        const keySong = versions.find(function (s) {
          return s.playbackId === keyId;
        });
        keyMetaEl.textContent = keySong ? versionsApi.displayTitleForSong(keySong) : '';
      }
    }
  }

  function setKeyVersion(playbackId) {
    if (!currentPage || !activeGroupKey) return;
    currentPage.keyPlaybackId = String(playbackId || '').trim();
    renderDesignerVersionPicker();
    debouncedSave();
  }

  function toggleKeyVersion() {
    if (!currentPage || !activeVersionId) return;
    const keyId = String(currentPage.keyPlaybackId || '').trim();
    if (keyId && keyId === activeVersionId) {
      setKeyVersion('');
      return;
    }
    setKeyVersion(activeVersionId);
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
    updateVersionTools();
    if (previewRoot) previewRoot.dataset.songVersionSelected = playbackId;
    paintPreview();
    const url = new URL(window.location.href);
    url.searchParams.set('p', playbackId);
    window.history.replaceState({}, '', url.pathname + url.search);
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
      embedded: true,
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
    if (activeVersionId) previewRoot.dataset.songVersionSelected = activeVersionId;
    renderApi.apply(previewRoot, {
      page: currentPage,
      baseTitle: group ? group.title : '',
      library: libraryCache,
      shared: shared,
      catalogVersions: catalogVersions,
      preferredPlaybackId: activeVersionId,
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
      keyPlaybackId: currentPage ? String(currentPage.keyPlaybackId || '').trim() : '',
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
      empty.textContent = 'No blocks.';
      mediaList.appendChild(empty);
      return;
    }

    items.forEach(function (item) {
      const li = document.createElement('li');
      li.className = 'studio-song-designer-media-item';
      li.dataset.id = item.id;

      const head = document.createElement('div');
      head.className = 'studio-song-designer-media-item-head';

      const handle = document.createElement('span');
      handle.className = 'studio-song-designer-media-handle';
      handle.textContent = '≡';
      handle.draggable = true;
      handle.addEventListener('dragstart', function (e) {
        dragSrcId = item.id;
        e.dataTransfer.effectAllowed = 'move';
        li.classList.add('is-dragging');
      });
      handle.addEventListener('dragend', function () {
        li.classList.remove('is-dragging');
      });

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

      head.appendChild(handle);
      head.appendChild(kind);
      head.appendChild(remove);
      li.appendChild(head);

      if (item.kind === 'video' || item.kind === 'audio') {
        if (item.playbackId) {
          const player = document.createElement('mux-player');
          player.setAttribute('playback-id', item.playbackId);
          player.setAttribute('stream-type', 'on-demand');
          player.setAttribute('playsinline', '');
          player.className = 'studio-song-designer-block-media';
          li.appendChild(player);
        } else {
          const preview = document.createElement('p');
          preview.className = 'studio-song-designer-media-preview';
          preview.textContent = 'no ' + item.kind;
          li.appendChild(preview);
        }

        const actions = document.createElement('div');
        actions.className = 'studio-song-designer-media-video-actions';

        const replaceBtn = document.createElement('button');
        replaceBtn.type = 'button';
        replaceBtn.className = 'icon-btn';
        replaceBtn.textContent = 'replace';
        const replaceInput = document.createElement('input');
        replaceInput.type = 'file';
        replaceInput.accept = 'image/*,audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov,.webm,.mkv,.jpg,.jpeg,.png,.webp,.gif';
        replaceInput.hidden = true;
        replaceBtn.addEventListener('click', function () {
          replaceInput.click();
        });
        replaceInput.addEventListener('change', function () {
          const picked = replaceInput.files && replaceInput.files[0];
          replaceInput.value = '';
          if (!picked) return;
          uploadBlockFile(picked)
            .then(function (result) {
              item.playbackId = result.playbackId;
              item.kind = result.kind;
              if (result.title) item.title = result.title;
              renderMediaEditor();
              debouncedSave();
            })
            .catch(function (err) {
              setStatus(err.message || 'upload failed', 'error');
            });
        });

        actions.appendChild(replaceBtn);
        li.appendChild(actions);
        li.appendChild(replaceInput);
      } else if (item.kind === 'image') {
        if (item.imageData) {
          const img = document.createElement('img');
          img.className = 'studio-song-designer-media-thumb studio-song-designer-block-media';
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
        file.accept = 'image/*,audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov,.webm,.mkv,.jpg,.jpeg,.png,.webp,.gif';
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
        text.placeholder = 'word bubble…';
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
    debouncedSave();
  }

  function moveMediaItem(fromId, toId) {
    const items = currentPage && currentPage.media ? currentPage.media : [];
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
    currentPage.media = items;
    renderMediaEditor();
    debouncedSave();
  }

  if (mediaList) {
    mediaList.addEventListener('dragover', function (e) { e.preventDefault(); });
    mediaList.addEventListener('drop', function (e) {
      e.preventDefault();
      const targetLi = e.target.closest('li[data-id]');
      if (targetLi) {
        const toId = targetLi.dataset.id;
        if (dragSrcId && toId && dragSrcId !== toId) {
          moveMediaItem(dragSrcId, toId);
        }
      } else if (dragSrcId) {
        moveMediaItem(dragSrcId, null);
      }
      dragSrcId = '';
    });
  }

  function loadPage(groupKey) {
    loadingPage = true;
    activeGroupKey = groupKey;
    const group = songGroups.find(function (g) {
      return g.groupKey === groupKey;
    });
    updateMeta(group);
    updateLinks(group);
    document.title = (group && group.title ? group.title : 'song') + ' — clips';

    return store.getPage(groupKey).then(function (page) {
      const catalogVersions = catalogVersionsForGroup(groupKey);
      const catalogIds = catalogVersions.map(function (song) {
        return song.playbackId;
      });
      const reconciled = store.reconcileVersionsToCatalog(page.versions || {}, catalogIds);
      const versionsChanged =
        Object.keys(reconciled).sort().join('\0') !==
        Object.keys(page.versions || {}).sort().join('\0');
      let workingPage = versionsChanged
        ? Object.assign({}, page, { versions: reconciled })
        : page;
      if (versionsChanged) {
        store.savePage(groupKey, { versions: reconciled }).catch(function () {});
      }
      currentPage = workingPage;
      activeVersionId = pickDefaultVersionId(currentPage, catalogVersions);
      if (paramPlayback && catalogVersions.some(function (s) { return s.playbackId === paramPlayback; })) {
        activeVersionId = paramPlayback;
      }
      const migration = migrateLegacyPageLyrics(currentPage, catalogVersions, activeVersionId);
      if (migration) {
        currentPage = Object.assign({}, currentPage, migration);
        if (migration.versions) currentPage.versions = migration.versions;
        store.savePage(groupKey, migration).catch(function () {});
      }
      if (notesEl) notesEl.value = currentPage.notes || '';
      renderDesignerVersionPicker();
      fillVersionEditorFields(activeVersionId);
      fillVideoSelect(heroVideoEl, currentPage.heroVideoPlaybackId || '');
      paintCoverPreview(currentPage);
      renderMediaEditor();
      paintPreview();
      mountShareHub();
      updateVersionTools();
      loadingPage = false;
      setStatus('');
    });
  }

  function selectSong(groupKey) {
    if (!groupKey) return;
    const url = new URL(window.location.href);
    url.searchParams.set('song', groupKey);
    url.searchParams.delete('p');
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

  if (keyBtnEl) {
    keyBtnEl.addEventListener('click', function () {
      toggleKeyVersion();
    });
  }

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
          mountShareHub();
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
      mountShareHub();
      coverClearBtn.hidden = true;
      debouncedSave();
    });
  }

  if (addTextBtn) addTextBtn.addEventListener('click', function () { addMediaItem('text'); });
  if (addMediaBtn) addMediaBtn.addEventListener('click', function () {
    if (!mediaInput) return;
    mediaInput.accept = 'image/*,audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov,.webm,.mkv,.jpg,.jpeg,.png,.webp,.gif';
    mediaInput.click();
  });

  if (copyIdBtn) {
    copyIdBtn.addEventListener('click', function () {
      const id = activeVersionId;
      if (!id) return;
      const api = window.BurnfolderShareLinks;
      if (api && api.copyText) {
        api.copyText(id).then(function () {
          setStatus('copied ' + id, 'success');
        }).catch(function () {
          setStatus('could not copy', 'error');
        });
      } else if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(id).then(function () {
          setStatus('copied ' + id, 'success');
        }).catch(function () {
          setStatus('could not copy', 'error');
        });
      }
    });
  }

  if (deleteVersionBtn) {
    deleteVersionBtn.addEventListener('click', function () {
      deleteActiveVersion();
    });
  }

  if (mediaInput) {
    mediaInput.addEventListener('change', function () {
      const file = mediaInput.files && mediaInput.files[0];
      mediaInput.value = '';
      if (!file) return;
      addMediaFromFile(file);
    });
  }

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
            pushBtn.textContent = 'push';
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
    const active = link.getAttribute('data-nav') === 'clips';
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
