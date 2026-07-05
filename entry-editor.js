(function() {
  'use strict';

  if (document.getElementById('entryBlocks')) {
    const BLOCK_STORAGE_KEY = 'burnfolderEntryEditorBlockDraft';
    const LEGACY_STORAGE_KEY = 'burnfolderEntryEditorDraft';
    const BLOCK_SCRIPT_VERSION = '20260509c';
    const blockEls = {
      date: null,
      blocks: null,
      preview: null,
      dataOutput: null,
      htmlOutput: null,
      songsOutput: null,
      journalOutput: null,
      status: null
    };

    function refreshBlockEditorDom() {
      blockEls.date = document.getElementById('entryDate');
      blockEls.blocks = document.getElementById('entryBlocks');
      blockEls.preview = document.getElementById('entryPreview');
      blockEls.dataOutput = document.getElementById('entryDataOutput');
      blockEls.htmlOutput = document.getElementById('entryHtmlOutput');
      blockEls.songsOutput = document.getElementById('songsEntryOutput');
      blockEls.journalOutput = document.getElementById('journalEntryOutput');
      blockEls.status = document.getElementById('entryEditorStatus');
    }

    function bindBlockEditorEvents() {
      if (blockEls.date && blockEls.date.dataset.editorBound !== '1') {
        blockEls.date.dataset.editorBound = '1';
        blockEls.date.addEventListener('input', updateAll);
      }
    }

    refreshBlockEditorDom();
    let entryBlocks = [];
    let draggingBlockId = null;
    const STUDIO_BLOCK_DRAG_MIME = 'application/x-burnfolder-block';

    function todayKey() {
      const now = new Date();
      return `${now.getMonth() + 1}.${now.getDate()}.${String(now.getFullYear()).slice(-2)}`;
    }

    function makeId() {
      return `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function normalizeDateKey(value) {
      return String(value || '').trim() || todayKey();
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function escapeJsString(value) {
      return JSON.stringify(String(value || ''));
    }

    function textToHtml(value) {
      return escapeHtml(value).replace(/\n/g, '<br>');
    }

    function textBlockHasRenderableContent(text) {
      if (window.textBlockHasRenderableContent) {
        return window.textBlockHasRenderableContent(text);
      }
      const raw = String(text || '');
      return raw.length > 0 && (raw.trim().length > 0 || raw.includes('\n'));
    }

    function renderTextBlockHtml(value) {
      const raw = String(value || '');
      if (!textBlockHasRenderableContent(raw)) return '';
      const trimmed = raw.trim();
      if (trimmed && window.isEntryTextHtml && window.isEntryTextHtml(trimmed)) {
        return window.sanitizeEntryTextHtml(trimmed);
      }
      return textToHtml(raw);
    }

    function spacingBlockHtml(block) {
      const size = window.normalizeSpacingSize ? window.normalizeSpacingSize(block.size) : 'md';
      return `  <div class="entry-spacing entry-spacing--${size}" aria-hidden="true"></div>`;
    }

    function setStatus(message) {
      if (!blockEls.status) return;
      blockEls.status.textContent = message;
      window.clearTimeout(setStatus.timer);
      setStatus.timer = window.setTimeout(() => {
        blockEls.status.textContent = '';
      }, 2400);
    }

    function normalizeTextSize(size) {
      return size === 'sm' || size === 'lg' ? size : 'md';
    }

    function textParagraphClass(block) {
      const size = normalizeTextSize(block.textSize);
      return size === 'md' ? 'page-annotation' : `page-annotation entry-text--${size}`;
    }

    function createBlock(type, data) {
      const base = { id: makeId(), type };
      const payload = data || {};
      if (type === 'text') {
        return {
          ...base,
          text: payload.text ? payload.text : '',
          textSize: normalizeTextSize(payload.textSize)
        };
      }
      if (type === 'spacing') return { ...base, size: payload.size ? payload.size : 'md' };
      if (type === 'image') {
        return {
          ...base,
          src: payload.src ? payload.src : '',
          alt: payload.alt ? payload.alt : '',
          assetId: payload.assetId ? payload.assetId : ''
        };
      }
      if (type === 'video') {
        return {
          ...base,
          playbackId: payload.playbackId ? payload.playbackId : '',
          title: payload.title ? payload.title : ''
        };
      }
      if (type === 'album') {
        return {
          ...base,
          title: payload.title ? payload.title : '',
          coverArt: payload.coverArt ? payload.coverArt : '',
          coverAlt: payload.coverAlt ? payload.coverAlt : '',
          tracks: Array.isArray(payload.tracks) && payload.tracks.length
            ? payload.tracks.map(track => ({ id: track.id || makeId(), title: track.title || '', playbackId: track.playbackId || '' }))
            : [{ id: makeId(), title: '', playbackId: '' }]
        };
      }
      if (type === 'playlist') {
        const playlistId = payload.playlistId || payload.id || base.id;
        return {
          ...base,
          id: playlistId,
          playlistId: playlistId,
          title: payload.title ? payload.title : '',
          coverArt: payload.coverArt ? payload.coverArt : '',
          coverAlt: payload.coverAlt ? payload.coverAlt : '',
          coverAssetId: payload.coverAssetId ? payload.coverAssetId : '',
          tracks: Array.isArray(payload.tracks) && payload.tracks.length
            ? payload.tracks.map(function (track) {
              return {
                id: track.id || makeId(),
                title: track.title || '',
                playbackId: track.playbackId || ''
              };
            })
            : [{ id: makeId(), title: '', playbackId: '' }]
        };
      }
      return {
        ...base,
        title: payload.title ? payload.title : '',
        playbackId: payload.playbackId ? payload.playbackId : ''
      };
    }

    function getAudioBlocks() {
      return entryBlocks.flatMap(block => {
        if (block.type === 'audio' && (block.title || block.playbackId)) return [block];
        if (block.type === 'album' && Array.isArray(block.tracks)) {
          return block.tracks
            .filter(track => track.title || track.playbackId)
            .map(track => ({
              title: track.title,
              playbackId: track.playbackId,
              album: block.title || undefined,
              coverArt: block.coverArt || undefined
            }));
        }
        if (block.type === 'playlist' && Array.isArray(block.tracks)) {
          return block.tracks
            .filter(function (track) {
              return track.playbackId;
            })
            .map(function (track) {
              return {
                title: track.title,
                playbackId: track.playbackId,
                playlist: block.playlistId || block.id,
                coverArt: block.coverArt || undefined
              };
            });
        }
        return [];
      });
    }

    function gatherEntry() {
      return {
        date: normalizeDateKey(blockEls.date.value),
        blocks: entryBlocks.map(block => ({ ...block })),
        songs: getAudioBlocks()
      };
    }

    function moveBlock(fromIndex, toIndex) {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= entryBlocks.length || toIndex >= entryBlocks.length) return;
      const [block] = entryBlocks.splice(fromIndex, 1);
      entryBlocks.splice(toIndex, 0, block);
      renderEditorBlocks();
      updateAll();
    }

    function moveBlockById(id, direction) {
      const index = entryBlocks.findIndex(block => block.id === id);
      moveBlock(index, index + direction);
    }

    function removeBlock(id) {
      entryBlocks = entryBlocks.filter(block => block.id !== id);
      if (isStudioEditor() && window.studioInspectorPlaylistId === id) {
        selectStudioPlaylist(null);
      }
      renderEditorBlocks();
      updateAll();
    }

    function updateBlock(id, field, value) {
      const block = entryBlocks.find(item => item.id === id);
      if (!block) return;
      block[field] = value;
      updateAll();
    }

    function getTracksBlock(blockId) {
      const block = entryBlocks.find(item => item.id === blockId);
      if (!block || !Array.isArray(block.tracks)) return null;
      if (block.type !== 'album' && block.type !== 'playlist') return null;
      return block;
    }

    function syncEntryOutputs(entry) {
      const data = entry || gatherEntry();
      if (blockEls.dataOutput) blockEls.dataOutput.value = buildEntryDataSnippet(data);
      if (blockEls.htmlOutput) blockEls.htmlOutput.value = buildEntryHtml(data);
      if (blockEls.songsOutput) blockEls.songsOutput.value = buildSongsSnippet(data);
      if (blockEls.journalOutput) blockEls.journalOutput.value = buildJournalLine(data);
      saveDraft(data);
    }

    function updateBlockTrack(blockId, trackId, field, value) {
      const block = getTracksBlock(blockId);
      if (!block) return;
      const track = block.tracks.find(item => item.id === trackId);
      if (!track) return;
      track[field] = value;
      syncEntryOutputs();
      if (isStudioEditor()) {
        hydrateStudioPreviewAudio(gatherEntry());
      } else {
        updateAll();
      }
    }

    function addBlockTrack(blockId) {
      const block = getTracksBlock(blockId);
      if (!block) return;
      ensureBlockTrackIds(block);
      block.tracks.push({ id: makeId(), title: '', playbackId: '' });
      renderEditorBlocks();
      updateAll();
      if (isStudioEditor()) {
        selectStudioPlaylist(blockId);
      }
    }

    function removeBlockTrack(blockId, trackId) {
      const block = getTracksBlock(blockId);
      if (!block) return;
      block.tracks = block.tracks.filter(track => track.id !== trackId);
      if (!block.tracks.length) block.tracks.push({ id: makeId(), title: '', playbackId: '' });
      renderEditorBlocks();
      updateAll();
      if (isStudioEditor()) {
        selectStudioPlaylist(blockId, { scroll: false });
        setStatus('removed track');
      }
    }

    function ensureBlockTrackIds(block) {
      if (!block || !Array.isArray(block.tracks)) return;
      block.tracks.forEach(function (track) {
        if (!track.id) track.id = makeId();
      });
    }

    function applyBlockTrackReorder(blockId, fromTrackId, mutateTracks) {
      const block = getTracksBlock(blockId);
      if (!block) return;
      ensureBlockTrackIds(block);
      const fromIndex = block.tracks.findIndex(function (track) {
        return track.id === fromTrackId;
      });
      if (fromIndex < 0) return;

      const [track] = block.tracks.splice(fromIndex, 1);
      mutateTracks(block.tracks, track);
      renderEditorBlocks();
      updateAll();
      if (isStudioEditor()) {
        selectStudioPlaylist(blockId, { scroll: false });
      }
    }

    function reorderBlockTrackToSlot(blockId, fromTrackId, insertSlot) {
      applyBlockTrackReorder(blockId, fromTrackId, function (tracks, track) {
        let insertAt = insertSlot;
        if (insertAt < 0) insertAt = 0;
        if (insertAt > tracks.length) insertAt = tracks.length;
        tracks.splice(insertAt, 0, track);
      });
    }

    function reorderBlockTrackToFinalIndex(blockId, fromTrackId, finalIndex) {
      const block = getTracksBlock(blockId);
      if (!block) return;
      ensureBlockTrackIds(block);
      const fromIndex = block.tracks.findIndex(function (track) {
        return track.id === fromTrackId;
      });
      if (fromIndex < 0) return;

      const len = block.tracks.length;
      const [track] = block.tracks.splice(fromIndex, 1);

      if (finalIndex >= len) {
        block.tracks.push(track);
      } else {
        let target = finalIndex;
        if (target < 0) target = 0;
        if (target > len - 1) target = len - 1;
        let insertAt = target;
        if (fromIndex < target) insertAt -= 1;
        block.tracks.splice(insertAt, 0, track);
      }

      renderEditorBlocks();
      updateAll();
      if (isStudioEditor()) {
        selectStudioPlaylist(blockId, { scroll: false });
      }
    }

    function moveBlockTrack(blockId, trackId, direction) {
      const block = getTracksBlock(blockId);
      if (!block) return;
      ensureBlockTrackIds(block);
      const index = block.tracks.findIndex(function (track) {
        return track.id === trackId;
      });
      if (index < 0) return;
      reorderBlockTrackToSlot(blockId, trackId, index + direction);
    }

    function appendTrackToPlaylist(blockId, trackData) {
      const block = getTracksBlock(blockId);
      if (!block || block.type !== 'playlist') return false;

      const title = String(trackData.title || '').trim();
      const playbackId = String(trackData.playbackId || '').trim();
      if (!playbackId) return false;

      const emptySlot = block.tracks.find(function (track) {
        return !String(track.playbackId || '').trim();
      });
      if (emptySlot) {
        emptySlot.title = title || emptySlot.title;
        emptySlot.playbackId = playbackId;
      } else {
        block.tracks.push({
          id: makeId(),
          title: title,
          playbackId: playbackId
        });
      }

      updateAll();
      selectStudioPlaylist(blockId, { scroll: false });
      setStatus('added to stack');
      return true;
    }

    function insertTrackAtPlaylistIndex(blockId, trackData, insertIndex) {
      const block = getTracksBlock(blockId);
      if (!block || block.type !== 'playlist') return false;

      const title = String(trackData.title || '').trim();
      const playbackId = String(trackData.playbackId || '').trim();
      if (!playbackId) return false;

      ensureBlockTrackIds(block);
      block.tracks = block.tracks.filter(function (track) {
        return String(track.playbackId || '').trim();
      });

      let insertAt = insertIndex;
      if (insertAt < 0) insertAt = 0;
      if (insertAt > block.tracks.length) insertAt = block.tracks.length;

      block.tracks.splice(insertAt, 0, {
        id: makeId(),
        title: title,
        playbackId: playbackId
      });

      updateAll();
      selectStudioPlaylist(blockId, { scroll: false });
      setStatus('added to stack');
      return true;
    }

    function insertStackPlaylist(data) {
      const payload = data || {};
      const tracks = (payload.tracks || [])
        .filter(function (track) {
          return track && String(track.playbackId || '').trim();
        })
        .map(function (track) {
          return {
            id: makeId(),
            title: track.title || '',
            playbackId: track.playbackId || ''
          };
        });
      if (!tracks.length) return null;

      const block = pushBlock(
        createBlock('playlist', {
          title: payload.title || '',
          coverArt: payload.coverArt || '',
          coverAlt: payload.coverAlt || '',
          tracks: tracks
        })
      );
      selectStudioPlaylist(block.id);
      return block;
    }

    function normalizeLoadedBlock(block) {
      const copy = { ...block, id: block.id || makeId() };
      if (copy.type === 'playlist') {
        copy.playlistId = copy.playlistId || copy.id;
        copy.id = copy.id || copy.playlistId;
        if (!copy.coverAssetId) copy.coverAssetId = '';
      }
      if ((copy.type === 'album' || copy.type === 'playlist') && Array.isArray(copy.tracks)) {
        copy.tracks = copy.tracks.map(function (track) {
          return { ...track, id: track.id || makeId() };
        });
      }
      return copy;
    }

    function makeField(block, labelText, field, type) {
      const fieldWrap = document.createElement('div');
      fieldWrap.className = 'entry-editor-field';

      const label = document.createElement('label');
      label.textContent = labelText;

      const input = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
      if (type === 'textarea') input.rows = 5;
      if (type !== 'textarea') input.type = 'text';
      input.value = block[field] || '';
      input.spellcheck = false;
      input.addEventListener('input', () => updateBlock(block.id, field, input.value));

      fieldWrap.appendChild(label);
      fieldWrap.appendChild(input);
      return fieldWrap;
    }

    function htmlToPlainEditorText(value) {
      const raw = String(value || '');
      if (!raw || !window.isEntryTextHtml || !window.isEntryTextHtml(raw)) return raw;

      const root = document.createElement('div');
      root.innerHTML = window.sanitizeEntryTextHtml(raw);
      return root.innerText.replace(/\u00a0/g, ' ');
    }

    function makeSpacingFields(block) {
      const fieldWrap = document.createElement('div');
      fieldWrap.className = 'entry-editor-field';

      const label = document.createElement('label');
      label.textContent = 'spacing size';
      label.setAttribute('for', `spacing-size-${block.id}`);

      const select = document.createElement('select');
      select.id = `spacing-size-${block.id}`;
      select.className = 'entry-spacing-size-select';

      [
        { value: 'sm', label: 'small' },
        { value: 'md', label: 'medium' },
        { value: 'lg', label: 'large' }
      ].forEach(option => {
        const el = document.createElement('option');
        el.value = option.value;
        el.textContent = option.label;
        select.appendChild(el);
      });

      select.value = window.normalizeSpacingSize
        ? window.normalizeSpacingSize(block.size)
        : (block.size === 'sm' || block.size === 'lg' ? block.size : 'md');
      select.addEventListener('change', () => updateBlock(block.id, 'size', select.value));

      fieldWrap.appendChild(label);
      fieldWrap.appendChild(select);
      return fieldWrap;
    }

    function makeBlockFields(block) {
      const fields = document.createElement('div');
      fields.className = 'entry-block-fields';

      if (block.type === 'text') {
        const textField = makeField(block, 'text', 'text', 'textarea');
        const textarea = textField.querySelector('textarea');
        if (textarea) {
          const plain = htmlToPlainEditorText(block.text);
          textarea.value = plain;
          block.text = plain;
          textarea.classList.add('entry-textarea');
        }
        fields.appendChild(textField);
      } else if (block.type === 'spacing') {
        fields.appendChild(makeSpacingFields(block));
      } else if (block.type === 'image') {
        fields.appendChild(makeField(block, 'image path', 'src', 'input'));
        fields.appendChild(makeField(block, 'alt text', 'alt', 'input'));
      } else if (block.type === 'video') {
        fields.appendChild(makeField(block, 'Mux playback ID', 'playbackId', 'input'));
        fields.appendChild(makeField(block, 'video title', 'title', 'input'));
      } else if (block.type === 'album') {
        fields.appendChild(makeField(block, 'album title', 'title', 'input'));
        fields.appendChild(makeField(block, 'cover art path', 'coverArt', 'input'));
        fields.appendChild(makeField(block, 'cover alt text', 'coverAlt', 'input'));
        fields.appendChild(makeTrackListFields(block, { heading: 'album tracks', addLabel: 'add track' }));
      } else if (block.type === 'playlist') {
        fields.appendChild(makeField(block, 'playlist title (optional)', 'title', 'input'));
        fields.appendChild(makeField(block, 'cover art path (optional)', 'coverArt', 'input'));
        fields.appendChild(makeField(block, 'cover alt text (optional)', 'coverAlt', 'input'));
        fields.appendChild(makeTrackListFields(block, { heading: 'playlist tracks', addLabel: 'add track' }));
      } else {
        fields.appendChild(makeField(block, 'song title', 'title', 'input'));
        fields.appendChild(makeField(block, 'Mux playback ID', 'playbackId', 'input'));
      }

      return fields;
    }

    function makeTrackField(block, track, labelText, field) {
      const fieldWrap = document.createElement('div');
      fieldWrap.className = 'entry-editor-field';

      const label = document.createElement('label');
      label.textContent = labelText;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = track[field] || '';
      input.spellcheck = false;
      input.addEventListener('input', () => updateBlockTrack(block.id, track.id, field, input.value));

      fieldWrap.appendChild(label);
      fieldWrap.appendChild(input);
      return fieldWrap;
    }

    function makeTrackListFields(block, options) {
      const opts = options || {};
      const wrap = document.createElement('div');
      wrap.className = 'entry-album-track-list';

      const heading = document.createElement('div');
      heading.className = 'entry-album-track-heading';
      const headingText = document.createElement('span');
      headingText.textContent = opts.heading || 'tracks';
      const addBtn = document.createElement('button');
      addBtn.className = 'icon-btn';
      addBtn.type = 'button';
      addBtn.textContent = opts.addLabel || 'add track';
      addBtn.addEventListener('click', () => addBlockTrack(block.id));
      heading.appendChild(headingText);
      heading.appendChild(addBtn);
      wrap.appendChild(heading);

      block.tracks.forEach((track, index) => {
        const trackCard = document.createElement('div');
        trackCard.className = 'entry-album-track-card';

        const top = document.createElement('div');
        top.className = 'entry-album-track-top';

        const title = document.createElement('span');
        title.textContent = `track ${index + 1}`;

        const actions = document.createElement('div');
        actions.className = 'entry-block-actions';

        const upBtn = document.createElement('button');
        upBtn.className = 'icon-btn';
        upBtn.type = 'button';
        upBtn.textContent = 'up';
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => moveBlockTrack(block.id, track.id, -1));

        const downBtn = document.createElement('button');
        downBtn.className = 'icon-btn';
        downBtn.type = 'button';
        downBtn.textContent = 'down';
        downBtn.disabled = index === block.tracks.length - 1;
        downBtn.addEventListener('click', () => moveBlockTrack(block.id, track.id, 1));

        const removeBtn = document.createElement('button');
        removeBtn.className = 'icon-btn';
        removeBtn.type = 'button';
        removeBtn.textContent = 'remove';
        removeBtn.disabled = block.type === 'album' && block.tracks.length <= 1;
        removeBtn.addEventListener('click', () => removeBlockTrack(block.id, track.id));

        actions.appendChild(upBtn);
        actions.appendChild(downBtn);
        actions.appendChild(removeBtn);
        top.appendChild(title);
        top.appendChild(actions);

        trackCard.appendChild(top);
        trackCard.appendChild(makeTrackField(block, track, 'song title', 'title'));
        trackCard.appendChild(makeTrackField(block, track, 'Mux playback ID', 'playbackId'));
        wrap.appendChild(trackCard);
      });

      return wrap;
    }

    function muxThumbUrl(playbackId) {
      if (
        window.BurnfolderStudioMux &&
        typeof window.BurnfolderStudioMux.muxThumbnailUrl === 'function'
      ) {
        return window.BurnfolderStudioMux.muxThumbnailUrl(playbackId);
      }
      if (!playbackId) return '';
      return 'https://image.mux.com/' + playbackId + '/thumbnail.webp?time=1';
    }

    function makeStudioPlaylistTrackList(block) {
      ensureBlockTrackIds(block);

      const wrap = document.createElement('div');
      wrap.className = 'studio-playlist-track-list';
      wrap.id = 'studioPlaylistTrackList';

      const heading = document.createElement('div');
      heading.className = 'entry-album-track-heading';
      const headingText = document.createElement('span');
      headingText.textContent = 'tracks (top → bottom)';
      const addBtn = document.createElement('button');
      addBtn.className = 'icon-btn';
      addBtn.type = 'button';
      addBtn.textContent = 'add track';
      addBtn.addEventListener('click', function () {
        addBlockTrack(block.id);
      });
      heading.appendChild(headingText);
      heading.appendChild(addBtn);
      wrap.appendChild(heading);

      block.tracks.forEach(function (track, index) {
        const playbackId = String(track.playbackId || '').trim();
        const row = document.createElement('div');
        row.className = 'studio-playlist-track-row';
        row.draggable = true;
        row.dataset.trackId = track.id;

        const handle = document.createElement('span');
        handle.className = 'studio-playlist-track-drag';
        handle.textContent = '≡';
        handle.setAttribute('aria-hidden', 'true');
        handle.title = 'Drag to reorder';

        const thumb = document.createElement('div');
        thumb.className = 'studio-playlist-track-thumb';
        if (playbackId) {
          const img = document.createElement('img');
          img.src = muxThumbUrl(playbackId);
          img.alt = '';
          img.loading = 'lazy';
          thumb.appendChild(img);
        } else {
          thumb.textContent = '—';
        }

        const fields = document.createElement('div');
        fields.className = 'studio-playlist-track-fields';

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'studio-playlist-track-title-input';
        titleInput.placeholder = 'song title';
        titleInput.spellcheck = false;
        titleInput.value = track.title || '';
        titleInput.addEventListener('input', function () {
          updateBlockTrack(block.id, track.id, 'title', titleInput.value);
        });

        const idInput = document.createElement('input');
        idInput.type = 'text';
        idInput.className = 'studio-playlist-track-id-input';
        idInput.placeholder = 'mux playback id';
        idInput.spellcheck = false;
        idInput.value = playbackId;
        idInput.addEventListener('input', function () {
          updateBlockTrack(block.id, track.id, 'playbackId', idInput.value);
        });

        fields.appendChild(titleInput);
        fields.appendChild(idInput);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'icon-btn studio-playlist-track-remove';
        removeBtn.textContent = 'remove';
        removeBtn.addEventListener('click', function (event) {
          event.stopPropagation();
          removeBlockTrack(block.id, track.id);
        });

        row.appendChild(handle);
        row.appendChild(thumb);
        row.appendChild(fields);
        row.appendChild(removeBtn);

        row.addEventListener('dragstart', function (event) {
          studioPlaylistTrackDragId = track.id;
          event.dataTransfer.setData(STUDIO_PLAYLIST_TRACK_MIME, track.id);
          event.dataTransfer.setData('text/plain', track.id);
          event.dataTransfer.effectAllowed = 'move';
          row.classList.add('is-dragging');
        });

        row.addEventListener('dragend', function () {
          studioPlaylistTrackDragId = null;
          row.classList.remove('is-dragging');
          wrap.querySelectorAll('.studio-playlist-track-row').forEach(function (el) {
            el.classList.remove('is-drop-before', 'is-drop-after');
          });
        });

        row.addEventListener('dragover', function (event) {
          if (Array.from(event.dataTransfer.types).indexOf(STUDIO_PLAYLIST_TRACK_MIME) < 0) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';

          const draggedId = studioPlaylistTrackDragId;
          if (!draggedId || draggedId === track.id) return;

          wrap.querySelectorAll('.studio-playlist-track-row').forEach(function (el) {
            el.classList.remove('is-drop-before', 'is-drop-after');
          });

          const rect = row.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          row.classList.add(before ? 'is-drop-before' : 'is-drop-after');
        });

        row.addEventListener('dragleave', function (event) {
          if (row.contains(event.relatedTarget)) return;
          row.classList.remove('is-drop-before', 'is-drop-after');
        });

        row.addEventListener('drop', function (event) {
          if (Array.from(event.dataTransfer.types).indexOf(STUDIO_PLAYLIST_TRACK_MIME) < 0) {
            return;
          }
          event.preventDefault();

          const draggedId = event.dataTransfer.getData(STUDIO_PLAYLIST_TRACK_MIME);
          if (!draggedId || draggedId === track.id) return;

          const rect = row.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          let finalIndex = index;
          if (!before) finalIndex += 1;

          reorderBlockTrackToFinalIndex(block.id, draggedId, finalIndex);
        });

        wrap.appendChild(row);
      });

      return wrap;
    }

    function renderEditorBlocks() {
      blockEls.blocks.innerHTML = '';

      if (!entryBlocks.length) {
        const empty = document.createElement('p');
        empty.className = 'entry-editor-empty';
        empty.textContent = 'add a text, spacing, photo, audio, or video block to start.';
        blockEls.blocks.appendChild(empty);
        return;
      }

      entryBlocks.forEach((block, index) => {
        const card = document.createElement('article');
        card.className = 'entry-block-card';
        card.dataset.blockId = block.id;
        card.dataset.blockType = block.type;

        const top = document.createElement('div');
        top.className = 'entry-block-top';

        const handle = document.createElement('button');
        handle.className = 'entry-block-handle';
        handle.type = 'button';
        handle.draggable = true;
        handle.textContent = 'drag';
        handle.setAttribute('aria-label', `Drag ${block.type} block`);

        const title = document.createElement('span');
        title.className = 'entry-block-title';
        title.textContent = `${index + 1}. ${block.type}`;

        const actions = document.createElement('div');
        actions.className = 'entry-block-actions';

        const upBtn = document.createElement('button');
        upBtn.className = 'icon-btn';
        upBtn.type = 'button';
        upBtn.textContent = 'up';
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => moveBlockById(block.id, -1));

        const downBtn = document.createElement('button');
        downBtn.className = 'icon-btn';
        downBtn.type = 'button';
        downBtn.textContent = 'down';
        downBtn.disabled = index === entryBlocks.length - 1;
        downBtn.addEventListener('click', () => moveBlockById(block.id, 1));

        const removeBtn = document.createElement('button');
        removeBtn.className = 'icon-btn';
        removeBtn.type = 'button';
        removeBtn.textContent = 'remove';
        removeBtn.addEventListener('click', () => removeBlock(block.id));

        actions.appendChild(upBtn);
        actions.appendChild(downBtn);
        actions.appendChild(removeBtn);
        top.appendChild(handle);
        top.appendChild(title);
        top.appendChild(actions);

        card.appendChild(top);
        card.appendChild(makeBlockFields(block));

        handle.addEventListener('dragstart', event => {
          draggingBlockId = block.id;
          card.classList.add('is-dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', block.id);
        });

        handle.addEventListener('dragend', () => {
          draggingBlockId = null;
          card.classList.remove('is-dragging');
          blockEls.blocks.querySelectorAll('.entry-block-card').forEach(item => item.classList.remove('is-drop-target'));
        });

        card.addEventListener('dragover', event => {
          event.preventDefault();
          if (draggingBlockId && draggingBlockId !== block.id) {
            card.classList.add('is-drop-target');
          }
        });

        card.addEventListener('dragleave', () => {
          card.classList.remove('is-drop-target');
        });

        card.addEventListener('drop', event => {
          event.preventDefault();
          card.classList.remove('is-drop-target');
          const draggedId = event.dataTransfer.getData('text/plain') || draggingBlockId;
          const fromIndex = entryBlocks.findIndex(item => item.id === draggedId);
          const toIndex = entryBlocks.findIndex(item => item.id === block.id);
          moveBlock(fromIndex, toIndex);
        });

        blockEls.blocks.appendChild(card);
      });
    }

    function blockToHtml(block) {
      if (block.type === 'text' && textBlockHasRenderableContent(block.text)) {
        return `  <p class="${textParagraphClass(block)}">${renderTextBlockHtml(block.text)}</p>`;
      }

      if (block.type === 'spacing') {
        return spacingBlockHtml(block);
      }

      if (block.type === 'image' && block.src.trim()) {
        return `  <img src="${escapeHtml(block.src.trim())}" alt="${escapeHtml(block.alt.trim())}" class="page-img">`;
      }

      if (block.type === 'video' && block.playbackId.trim()) {
        const title = block.title.trim() || 'video';
        return `  <mux-player
    playback-id="${escapeHtml(block.playbackId.trim())}"
    metadata-video-title="${escapeHtml(title)}"
    playbackrates="1 1.5 2"
    noairplay
    class="page-inline-video"
    style="width:100%;margin-bottom:24px;"
  ></mux-player>`;
      }

      if (block.type === 'audio' && block.playbackId.trim()) {
        return `  <div class="entry-audio-list" data-playback-id="${escapeHtml(block.playbackId.trim())}"></div>`;
      }

      if (block.type === 'album') {
        const albumParts = ['  <div class="entry-album">'];
        if (block.coverArt.trim()) {
          albumParts.push(`    <img src="${escapeHtml(block.coverArt.trim())}" alt="${escapeHtml(block.coverAlt.trim() || block.title.trim() || 'album cover')}" class="entry-album-cover">`);
        }
        if (block.title.trim()) {
          albumParts.push(`    <p class="entry-album-title">${escapeHtml(block.title.trim())}</p>`);
        }
        if (block.title.trim()) {
          albumParts.push(`    <div class="entry-audio-list" data-album="${escapeHtml(block.title.trim())}"></div>`);
        }
        albumParts.push('  </div>');
        return albumParts.length > 2 ? albumParts.join('\n') : '';
      }

      if (block.type === 'playlist' && block.tracks && block.tracks.some(function (t) { return t.playbackId; })) {
        const playlistKey = block.playlistId || block.id;
        if (!playlistKey) return '';
        const chrome = playlistChromeFlags(block);
        const parts = [`  <div class="${playlistRootClass(block)}">`];
        if (chrome.hasCover) {
          parts.push(
            `    <img src="${escapeHtml(block.coverArt.trim())}" alt="${escapeHtml(block.coverAlt.trim() || block.title.trim() || 'cover art')}" class="entry-playlist-cover">`
          );
        }
        if (chrome.hasTitle) {
          parts.push(`    <p class="entry-playlist-title">${escapeHtml(block.title.trim())}</p>`);
        }
        parts.push(`    <div class="entry-audio-list" data-playlist="${escapeHtml(playlistKey)}"></div>`);
        parts.push('  </div>');
        return parts.join('\n');
      }

      return '';
    }

    function buildEntryHtml(entry) {
      const bodyParts = [`  <p class="page-id">${escapeHtml(entry.date)}</p>`];

      entry.blocks.forEach(block => {
        const html = blockToHtml(block);
        if (html) bodyParts.push(html);
      });

      if (!entry.blocks.some(block => block.type === 'audio' || block.type === 'album' || block.type === 'playlist')) {
        bodyParts.push('  <div id="audioList" style="margin-top: 48px;"></div>');
      }

      return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(entry.date)}</title>
<script src="https://cdn.jsdelivr.net/npm/@mux/mux-player" defer></script>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="site-header">
  <a href="index.html" class="site-brand">burnfolder.com</a>
  <nav class="site-nav" aria-label="Primary">
    <a href="music.html" class="page-nav">music</a>
    <a href="content.html" class="page-nav">video</a>
    <a href="shop.html" class="page-nav">shop</a>
  </nav>
  <a href="cart.html" class="icon-btn site-cart-btn site-cart-btn--hidden" id="cartFloat" title="View cart">cart</a>
</header>

<div class="page-wrap">
${bodyParts.join('\n\n')}
</div>

<div class="page-watermark">${escapeHtml(entry.date)}</div>

<!-- bottom player - do not modify -->
<div class="bottom-progress-bar" id="bottomBar">
  <div class="close-btn" id="closeBtn" aria-label="Close Now Playing">&times;</div>
  <div class="bottom-bar-content">
    <mux-player id="activeMuxPlayer" audio playsinline stream-type="on-demand" preload="metadata" style="position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;"></mux-player>
    <span class="song-title" id="songTitle">Track Title</span>
    <div class="bottom-bar-controls">
      <button class="bottom-play-pause-btn" id="bottomPlayPause" aria-label="Play/Pause">&#9654;</button>
      <div class="progress-bar-area" id="progressBarArea">
        <div class="progress" id="progress"></div>
        <div class="progress-playhead" id="progressPlayhead"></div>
      </div>
    </div>
    <div class="loading-spinner" id="loadingSpinner"></div>
  </div>
</div>
<script src="entries.js"></script>
<script src="entry-renderer.js"></script>
<script src="songs.js"></script>
<script src="stripe-publishable.js"></script>
<script src="spa-router.js"></script>
<script src="scripts.js?v=${BLOCK_SCRIPT_VERSION}"></script>
</body>
</html>
`;
    }

    function buildSongsSnippet(entry) {
      const tracks = entry.songs
        .filter(song => song.title.trim() && song.playbackId.trim())
        .map(song => {
          const fields = [
            `title: ${escapeJsString(song.title.trim())}`,
            `playbackId: ${escapeJsString(song.playbackId.trim())}`
          ];
          if (song.album) fields.push(`album: ${escapeJsString(song.album)}`);
          if (song.playlist) fields.push(`playlist: ${escapeJsString(song.playlist)}`);
          if (song.coverArt) fields.push(`coverArt: ${escapeJsString(song.coverArt)}`);
          return `    { ${fields.join(', ')} }`;
        });

      return `  ${escapeJsString(entry.date)}: [
${tracks.join(',\n')}
  ],`;
    }

    function buildJournalLine(entry) {
      const existing = Array.isArray(window.journalEntries) ? window.journalEntries : [];
      const next = [entry.date].concat(existing.filter(item => item !== entry.date));
      return `window.journalEntries = ${JSON.stringify(next)};`;
    }

    function cleanBlockForData(block) {
      if (block.type === 'text') {
        return {
          type: 'text',
          text: block.text || '',
          textSize: normalizeTextSize(block.textSize)
        };
      }
      if (block.type === 'spacing') {
        return {
          type: 'spacing',
          size: window.normalizeSpacingSize ? window.normalizeSpacingSize(block.size) : 'md'
        };
      }
      if (block.type === 'image') {
        const image = { type: 'image', src: block.src || '', alt: block.alt || '' };
        if (block.assetId) image.assetId = block.assetId;
        return image;
      }
      if (block.type === 'audio') return { type: 'audio', title: block.title || '', playbackId: block.playbackId || '' };
      if (block.type === 'video') return { type: 'video', title: block.title || '', playbackId: block.playbackId || '' };
      if (block.type === 'album') {
        return {
          type: 'album',
          title: block.title || '',
          coverArt: block.coverArt || '',
          coverAlt: block.coverAlt || '',
          tracks: (block.tracks || []).map(track => ({
            title: track.title || '',
            playbackId: track.playbackId || ''
          }))
        };
      }
      if (block.type === 'playlist') {
        return {
          type: 'playlist',
          playlistId: block.playlistId || block.id || '',
          title: block.title || '',
          coverArt: block.coverArt || '',
          coverAlt: block.coverAlt || '',
          tracks: (block.tracks || []).map(function (track) {
            return {
              title: track.title || '',
              playbackId: track.playbackId || ''
            };
          })
        };
      }
      return { type: block.type };
    }

    function buildEntryDataSnippet(entry) {
      const data = {
        date: entry.date,
        blocks: entry.blocks.map(cleanBlockForData)
      };
      return `  ${escapeJsString(entry.date)}: ${JSON.stringify(data, null, 2).replace(/\n/g, '\n  ')},`;
    }

    function buildEntryPackage(entry) {
      return [
        'entries.js entry:',
        buildEntryDataSnippet(entry),
        '',
        'entryOrder line:',
        `window.entryOrder = ${JSON.stringify([entry.date])};`,
        '',
        'html file:',
        `${entry.date}.html is generated in the HTML output. It loads entries.js and renders from the data object.`
      ].join('\n');
    }

    function buildEntryPackageJson(entry) {
      return JSON.stringify({
        packageType: 'burnfolder-entry',
        version: 1,
        entry: {
          date: entry.date,
          blocks: entry.blocks.map(cleanBlockForData)
        }
      }, null, 2);
    }

    function buildSongsFromEntry(entry) {
      const songs = [];

      (entry.blocks || []).forEach(function (block) {
        if (block.type === 'audio') {
          const playbackId = String(block.playbackId || '').trim();
          if (!playbackId) return;
          songs.push({
            title: String(block.title || '').trim() || 'untitled',
            playbackId: playbackId
          });
        }

        if (block.type === 'album' && Array.isArray(block.tracks)) {
          const albumTitle = String(block.title || '').trim();
          block.tracks.forEach(function (track) {
            const playbackId = String(track.playbackId || '').trim();
            if (!playbackId) return;
            songs.push({
              title: String(track.title || '').trim() || 'untitled',
              playbackId: playbackId,
              album: albumTitle || undefined
            });
          });
        }

        if (block.type === 'playlist' && Array.isArray(block.tracks)) {
          const coverArt = String(block.coverArt || '').trim() || undefined;
          block.tracks.forEach(function (track) {
            const playbackId = String(track.playbackId || '').trim();
            if (!playbackId) return;
            songs.push({
              title: String(track.title || '').trim() || 'untitled',
              playbackId: playbackId,
              playlist: block.playlistId || block.id,
              coverArt: coverArt
            });
          });
        }
      });

      return songs;
    }

    function getPlaylistBlock(playlistKey) {
      return entryBlocks.find(function (block) {
        return (
          block.type === 'playlist' &&
          String(block.playlistId || block.id) === String(playlistKey)
        );
      });
    }

    function pairForPlaylistTrack(block, track, songs) {
      const playbackId = String(track.playbackId || '').trim();
      if (!playbackId) return null;

      const playlistKey = block.playlistId || block.id;
      const coverArt = String(block.coverArt || '').trim() || undefined;
      const idx = songs.findIndex(function (song) {
        return song.playbackId === playbackId;
      });

      if (idx >= 0) {
        return { song: songs[idx], idx: idx, trackId: track.id };
      }

      return {
        song: {
          title: String(track.title || '').trim() || 'untitled',
          playbackId: playbackId,
          playlist: playlistKey,
          coverArt: coverArt
        },
        idx: -1,
        trackId: track.id
      };
    }

    function getPlaylistPairsForBlock(playlistKey, songs) {
      const block = getPlaylistBlock(playlistKey);
      if (!block) return [];

      ensureBlockTrackIds(block);
      const pairs = [];

      block.tracks.forEach(function (track) {
        const pair = pairForPlaylistTrack(block, track, songs);
        if (pair) pairs.push(pair);
      });

      return pairs;
    }

    function getSongsForPreviewContainer(container, songs) {
      if (container.dataset.playlist) {
        return getPlaylistPairsForBlock(container.dataset.playlist, songs);
      }

      if (container.dataset.album) {
        return songs
          .map(function (song, idx) {
            return { song: song, idx: idx };
          })
          .filter(function (item) {
            return item.song.album === container.dataset.album;
          });
      }

      if (container.dataset.playbackId) {
        const exact = songs
          .map(function (song, idx) {
            return { song: song, idx: idx };
          })
          .filter(function (item) {
            return item.song.playbackId === container.dataset.playbackId;
          });
        const standalone = exact.filter(function (item) {
          return !item.song.album && !item.song.playlist;
        });
        return standalone.length ? standalone : exact;
      }

      return songs.map(function (song, idx) {
        return { song: song, idx: idx };
      });
    }

    function createPublishedAudioListSlot(block, options) {
      const opts = options || {};
      const slot = document.createElement('div');
      slot.className = 'entry-audio-list';
      slot.style.marginTop = opts.inAlbum ? '12px' : '20px';

      if (opts.playlistId) {
        slot.dataset.playlist = opts.playlistId;
      } else if (opts.albumTitle) {
        slot.dataset.album = opts.albumTitle;
      } else if (block.playbackId && String(block.playbackId).trim()) {
        slot.dataset.playbackId = String(block.playbackId).trim();
      }

      return slot;
    }

    function hydrateStudioPreviewAudio(entry) {
      if (!isStudioEditor() || typeof window.fillTracklistContainer !== 'function') return;

      const songs = buildSongsFromEntry(entry);
      window.currentSongs = songs;

      const wrap = blockEls.preview && blockEls.preview.querySelector('.entry-editor-preview-wrap');
      if (!wrap) return;

      wrap.querySelectorAll('.entry-audio-list').forEach(function (container) {
        const inAlbum = !!container.dataset.album;
        const inPlaylist = !!container.dataset.playlist;
        const pairs = getSongsForPreviewContainer(container, songs);
        const queueSongs = pairs.map(function (item) {
          return item.song;
        });

        window.fillTracklistContainer(
          container,
          pairs.map(function (item, pairIndex) {
            const idx = item.idx;
            const song = item.song;
            const displayTitle =
              typeof window.getTracklistDisplayTitle === 'function'
                ? window.getTracklistDisplayTitle(song, { inAlbum: inAlbum || inPlaylist })
                : song.title;

            return {
              song: song,
              displayTitle: displayTitle,
              onPlay: function () {
                const player = document.getElementById('activeMuxPlayer');
                const activeSong =
                  typeof getActiveSong === 'function' ? getActiveSong() : null;
                const inSameQueue =
                  activeSong &&
                  queueSongs.some(function (s) {
                    return s.playbackId === activeSong.playbackId;
                  });

                if (
                  inSameQueue &&
                  typeof togglePlayPause === 'function' &&
                  player &&
                  !player.paused
                ) {
                  togglePlayPause();
                  return;
                }

                if (inPlaylist && typeof window.playTrackQueue === 'function') {
                  window.playTrackQueue(queueSongs, pairIndex);
                  return;
                }

                if (typeof playTrack === 'function') {
                  playTrack(idx);
                  return;
                }
                if (typeof playTrackBySong === 'function') {
                  playTrackBySong(song);
                }
              }
            };
          }),
          { freezePlayback: true }
        );
      });

        if (typeof window.syncTracklistPlayback === 'function') {
        window.syncTracklistPlayback();
      }

      attachStudioPlaylistTracklistReorder(wrap, entry);
      attachStudioPreviewMuxTrackDrops(wrap);
    }

    function attachStudioPreviewMuxTrackDrops(wrap) {
      if (!isStudioEditor()) return;

      const muxMime =
        window.STUDIO_MUX_PLAYBACK_MIME ||
        (window.BurnfolderStreamShared && window.BurnfolderStreamShared.MUX_MIME) ||
        'application/x-burnfolder-mux-playback';
      const albumTrackMime =
        window.STUDIO_ALBUM_TRACK_MIME || 'application/x-burnfolder-album-track';

      function trackFromDrag(event) {
        const playbackId =
          event.dataTransfer.getData(muxMime) ||
          event.dataTransfer.getData(albumTrackMime);
        if (!playbackId) return null;
        const label = event.dataTransfer.getData('text/plain') || '';
        return { title: label, playbackId: playbackId };
      }

      function acceptsMuxDrag(event) {
        const types = event.dataTransfer && event.dataTransfer.types;
        if (!types) return false;
        const list = Array.from(types);
        return list.indexOf(muxMime) >= 0 || list.indexOf(albumTrackMime) >= 0;
      }

      wrap.querySelectorAll('.entry-audio-list[data-playlist]').forEach(function (container) {
        const playlistKey = container.dataset.playlist;
        const block = getPlaylistBlock(playlistKey);
        if (!block) return;

        ensureBlockTrackIds(block);
        const tracksWithPlayback = block.tracks.filter(function (track) {
          return String(track.playbackId || '').trim();
        });

        container.querySelectorAll('.music-tracklist-item').forEach(function (itemEl, index) {
          if (itemEl.classList.contains('studio-track-drop-end')) return;

          itemEl.addEventListener('dragover', function (event) {
            if (!acceptsMuxDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'copy';
            itemEl.classList.add('is-stack-drop-target');
          });

          itemEl.addEventListener('dragleave', function (event) {
            if (itemEl.contains(event.relatedTarget)) return;
            itemEl.classList.remove('is-stack-drop-target');
          });

          itemEl.addEventListener('drop', function (event) {
            if (!acceptsMuxDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            itemEl.classList.remove('is-stack-drop-target');

            const trackData = trackFromDrag(event);
            if (!trackData) return;

            const rect = itemEl.getBoundingClientRect();
            const before = event.clientY < rect.top + rect.height / 2;
            let insertIndex = index;
            if (!before) insertIndex += 1;
            if (insertIndex > tracksWithPlayback.length) {
              insertIndex = tracksWithPlayback.length;
            }

            const blockIndex = block.tracks.findIndex(function (track) {
              return track.id === tracksWithPlayback[index].id;
            });
            if (blockIndex < 0) {
              appendTrackToPlaylist(block.id, trackData);
              return;
            }

            insertTrackAtPlaylistIndex(block.id, trackData, before ? blockIndex : blockIndex + 1);
          });
        });
      });
    }

    function clearPlaylistTrackDropMarkers(container) {
      container.querySelectorAll('.studio-playlist-track-item, .studio-track-drop-end').forEach(function (el) {
        el.classList.remove('is-drop-before', 'is-drop-after');
      });
      const list = container.querySelector('.music-tracklist');
      if (list) list.classList.remove('is-playlist-track-drag');
    }

    function markPlaylistTrackDropTarget(el, before) {
      el.classList.remove('is-drop-before', 'is-drop-after');
      el.classList.add(before ? 'is-drop-before' : 'is-drop-after');
    }

    function attachStudioPlaylistTracklistReorder(wrap, entry) {
      if (!isStudioEditor()) return;

      wrap.querySelectorAll('.entry-audio-list[data-playlist]').forEach(function (container) {
        const playlistKey = container.dataset.playlist;
        const block = getPlaylistBlock(playlistKey);
        if (!block) return;

        ensureBlockTrackIds(block);
        const list = container.querySelector('.music-tracklist');
        if (!list) return;

        let dropEnd = list.querySelector('.studio-track-drop-end');
        if (!dropEnd) {
          dropEnd = document.createElement('li');
          dropEnd.className = 'studio-track-drop-end';
          dropEnd.setAttribute('aria-hidden', 'true');
          list.appendChild(dropEnd);
        }

        const tracksWithPlayback = block.tracks.filter(function (track) {
          return String(track.playbackId || '').trim();
        });

        function updateTrackDropIndicator(event) {
          const types = event.dataTransfer && event.dataTransfer.types;
          if (!types || Array.from(types).indexOf(STUDIO_PLAYLIST_TRACK_MIME) < 0) return;

          const draggedId = studioPlaylistTrackDragId;
          if (!draggedId) return;

          clearPlaylistTrackDropMarkers(container);
          list.classList.add('is-playlist-track-drag');

          const trackItems = Array.from(list.querySelectorAll('.studio-playlist-track-item'));

          for (let i = 0; i < trackItems.length; i += 1) {
            const item = trackItems[i];
            if (item.dataset.trackId === draggedId) continue;

            const rect = item.getBoundingClientRect();
            if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
              const before = event.clientY < rect.top + rect.height / 2;
              markPlaylistTrackDropTarget(item, before);
              return;
            }
          }

          if (trackItems.length) {
            const last = trackItems[trackItems.length - 1];
            const lastRect = last.getBoundingClientRect();
            if (event.clientY > lastRect.bottom) {
              markPlaylistTrackDropTarget(dropEnd, true);
            }
          }
        }

        list.addEventListener('dragover', function (event) {
          if (Array.from(event.dataTransfer.types).indexOf(STUDIO_PLAYLIST_TRACK_MIME) < 0) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          updateTrackDropIndicator(event);
        });

        list.addEventListener('dragleave', function (event) {
          if (list.contains(event.relatedTarget)) return;
          clearPlaylistTrackDropMarkers(container);
        });

        list.addEventListener('drop', function (event) {
          if (Array.from(event.dataTransfer.types).indexOf(STUDIO_PLAYLIST_TRACK_MIME) < 0) {
            return;
          }
          event.preventDefault();

          const draggedId = event.dataTransfer.getData(STUDIO_PLAYLIST_TRACK_MIME);
          if (!draggedId) return;

          const marked = list.querySelector('.is-drop-before, .is-drop-after');
          clearPlaylistTrackDropMarkers(container);

          if (marked && marked.classList.contains('studio-track-drop-end')) {
            reorderBlockTrackToFinalIndex(block.id, draggedId, block.tracks.length);
            return;
          }

          if (!marked) return;

          const targetId = marked.dataset.trackId;
          const targetBlockIndex = block.tracks.findIndex(function (t) {
            return t.id === targetId;
          });
          if (targetBlockIndex < 0) return;

          let finalIndex = targetBlockIndex;
          if (marked.classList.contains('is-drop-after')) finalIndex += 1;
          reorderBlockTrackToFinalIndex(block.id, draggedId, finalIndex);
        });

        const items = list.querySelectorAll('.music-tracklist-item');

        items.forEach(function (item, index) {
          const track = tracksWithPlayback[index];
          if (!track) return;
          item.dataset.trackId = track.id;
          item.draggable = true;
          item.classList.add('studio-playlist-track-item');

          if (!item.querySelector('.studio-playlist-track-delete')) {
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'icon-btn studio-playlist-track-delete';
            deleteBtn.textContent = '×';
            deleteBtn.setAttribute('aria-label', 'Remove track from playlist');
            deleteBtn.addEventListener('mousedown', function (event) {
              event.stopPropagation();
            });
            deleteBtn.addEventListener('click', function (event) {
              event.stopPropagation();
              event.preventDefault();
              removeBlockTrack(block.id, track.id);
            });
            item.appendChild(deleteBtn);
          }

          item.addEventListener('dragstart', function (event) {
            event.stopPropagation();
            studioPlaylistTrackDragId = track.id;
            event.dataTransfer.setData(STUDIO_PLAYLIST_TRACK_MIME, track.id);
            event.dataTransfer.setData('text/plain', track.id);
            event.dataTransfer.effectAllowed = 'move';
            item.classList.add('is-dragging');
            list.classList.add('is-playlist-track-drag');
          });

          item.addEventListener('dragend', function () {
            studioPlaylistTrackDragId = null;
            item.classList.remove('is-dragging');
            clearPlaylistTrackDropMarkers(container);
          });
        });
      });
    }

    function renderAudioPreview(block) {
      const host = document.createElement('div');
      const list = document.createElement('ol');
      list.className = 'music-tracklist';

      const item = document.createElement('li');
      item.className = 'music-tracklist-item';

      const num = document.createElement('span');
      num.className = 'music-track-num';
      num.textContent = '1';

      const title = (block.title && block.title.trim()) || 'untitled song';

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'music-track-row';
      row.disabled = true;

      const name = document.createElement('span');
      name.className = 'music-track-title';
      name.textContent = title;

      const duration = document.createElement('span');
      duration.className = 'music-track-duration';
      duration.textContent = '--:--';

      row.appendChild(name);
      row.appendChild(duration);
      item.appendChild(num);
      item.appendChild(row);
      list.appendChild(item);
      host.appendChild(list);

      return host;
    }

    function isStudioEditor() {
      return document.body.classList.contains('studio-editor-page');
    }

    function playlistHasCover(block) {
      return !!(
        (block.coverAssetId && String(block.coverAssetId).trim()) ||
        (block.coverArt && String(block.coverArt).trim())
      );
    }

    function playlistChromeFlags(block) {
      return {
        hasTitle: !!(block.title && String(block.title).trim()),
        hasCover: playlistHasCover(block)
      };
    }

    function syncPlaylistChrome(block) {
      syncEntryOutputs();
      refreshStudioPlaylistChrome(block.id);
    }

    function applyPlaylistCoverImage(imgEl, block) {
      if (!imgEl || !block) return;

      const prevUrl = imgEl.dataset.blobUrl;
      if (prevUrl) {
        URL.revokeObjectURL(prevUrl);
        delete imgEl.dataset.blobUrl;
      }

      imgEl.removeAttribute('src');
      imgEl.hidden = true;

      const assetId = String(block.coverAssetId || '').trim();
      const path = String(block.coverArt || '').trim();

      function show(src) {
        if (!src) return;
        imgEl.src = src;
        imgEl.hidden = false;
      }

      if (assetId && window.BurnfolderAssetCloud && window.BurnfolderAssetCloud.getBlobUrl) {
        window.BurnfolderAssetCloud.getBlobUrl(assetId).then(function (url) {
          if (url) {
            imgEl.dataset.blobUrl = url;
            show(url);
            return;
          }
          if (path) show(path);
        });
        return;
      }

      if (path) show(path);
    }

    function setPlaylistCoverFromFile(blockId, file) {
      const block = entryBlocks.find(function (item) {
        return item.id === blockId && item.type === 'playlist';
      });
      if (!block || !file) return Promise.resolve();

      if (!window.BurnfolderAssetCloud || !window.BurnfolderAssetCloud.registerImageFile) {
        setStatus('image storage unavailable');
        return Promise.resolve();
      }

      const coverApi = window.BurnfolderCoverArt;
      const label = block.title || 'playlist';
      const register =
        coverApi && coverApi.registerCoverFromFile
          ? coverApi.registerCoverFromFile(file, label)
          : window.BurnfolderAssetCloud.registerImageFile(file, {
              publicPath: coverApi
                ? coverApi.suggestCoverPublicPath(label, file)
                : undefined
            });

      return register.then(function (asset) {
        block.coverAssetId = asset.coverAssetId || asset.id;
        block.coverArt = asset.coverArt || asset.publicPath || block.coverArt;
        if (!String(block.coverAlt || '').trim()) {
          block.coverAlt = asset.coverAlt || asset.displayTitle || block.coverAlt;
        }
        syncPlaylistChrome(block);
        saveDraft(gatherEntry());
        setStatus(
          block.coverArt
            ? 'cover → ' + block.coverArt + ' (saved to downloads — move to site IMAGES/)'
            : 'cover updated'
        );
      }).catch(function (err) {
        setStatus(err.message || 'could not add cover');
      });
    }

    function clearPlaylistCover(blockId) {
      const block = entryBlocks.find(function (item) {
        return item.id === blockId && item.type === 'playlist';
      });
      if (!block) return;

      block.coverAssetId = '';
      block.coverArt = '';
      block.coverAlt = '';
      syncPlaylistChrome(block);
      saveDraft(gatherEntry());
      setStatus('cover removed');
    }

    function buildStudioStackChrome(block) {
      const chrome = document.createElement('div');
      chrome.className = 'studio-stack-chrome';
      chrome.dataset.blockId = block.id;

      const coverWrap = document.createElement('div');
      coverWrap.className = 'studio-stack-cover-wrap';

      const drop = document.createElement('div');
      drop.className = 'studio-stack-cover-drop';
      drop.tabIndex = 0;
      drop.setAttribute('role', 'button');
      drop.setAttribute('aria-label', 'Stack cover image — drop or click to choose');

      const placeholder = document.createElement('span');
      placeholder.className = 'studio-stack-cover-placeholder';
      placeholder.textContent = 'cover';

      const img = document.createElement('img');
      img.className = 'studio-stack-cover-img entry-playlist-cover';
      img.alt = '';
      img.hidden = true;

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';
      fileInput.className = 'studio-stack-cover-input';
      fileInput.hidden = true;

      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'icon-btn studio-stack-cover-pick';
      pickBtn.textContent = 'choose image';

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'icon-btn studio-stack-cover-clear';
      clearBtn.textContent = 'remove cover';
      clearBtn.hidden = !playlistHasCover(block);

      drop.appendChild(placeholder);
      drop.appendChild(img);
      drop.appendChild(fileInput);
      drop.appendChild(pickBtn);

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'studio-stack-title-input';
      titleInput.placeholder = 'name (optional)';
      titleInput.spellcheck = false;
      titleInput.value = block.title || '';

      titleInput.addEventListener('input', function () {
        block.title = titleInput.value;
        syncPlaylistChrome(block);
        window.clearTimeout(titleInput.saveTimer);
        titleInput.saveTimer = window.setTimeout(function () {
          saveDraft(gatherEntry());
        }, 400);
      });

      titleInput.addEventListener('click', function (event) {
        event.stopPropagation();
      });

      function pickFile() {
        fileInput.click();
      }

      function onImageFile(file) {
        if (!file || !String(file.type || '').startsWith('image/')) {
          setStatus('use an image file');
          return;
        }
        setPlaylistCoverFromFile(block.id, file);
      }

      pickBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        pickFile();
      });

      drop.addEventListener('click', function (event) {
        if (event.target === clearBtn) return;
        event.stopPropagation();
        pickFile();
      });

      drop.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          pickFile();
        }
      });

      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) onImageFile(fileInput.files[0]);
        fileInput.value = '';
      });

      drop.addEventListener('dragover', function (event) {
        const types = event.dataTransfer && event.dataTransfer.types;
        const hasFiles = types && Array.from(types).indexOf('Files') >= 0;
        if (!hasFiles) return;
        event.preventDefault();
        event.stopPropagation();
        drop.classList.add('is-drop-target');
        event.dataTransfer.dropEffect = 'copy';
      });

      drop.addEventListener('dragleave', function (event) {
        if (drop.contains(event.relatedTarget)) return;
        drop.classList.remove('is-drop-target');
      });

      drop.addEventListener('drop', function (event) {
        event.preventDefault();
        event.stopPropagation();
        drop.classList.remove('is-drop-target');
        const file = event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) onImageFile(file);
      });

      clearBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        clearPlaylistCover(block.id);
        clearBtn.hidden = true;
      });

      coverWrap.appendChild(drop);
      coverWrap.appendChild(clearBtn);
      chrome.appendChild(coverWrap);
      chrome.appendChild(titleInput);

      applyPlaylistCoverImage(img, block);
      if (playlistHasCover(block)) {
        placeholder.hidden = true;
        clearBtn.hidden = false;
      }

      const coverObserver = { refresh: function () {
        applyPlaylistCoverImage(img, block);
        const has = playlistHasCover(block);
        placeholder.hidden = has;
        clearBtn.hidden = !has;
        pickBtn.textContent = has ? 'replace image' : 'choose image';
        drop.classList.toggle('has-cover', has);
      }};
      chrome._coverRefresh = coverObserver.refresh;

      return chrome;
    }

    function playlistRootClass(block) {
      const flags = playlistChromeFlags(block);
      const parts = ['entry-playlist'];
      if (flags.hasCover) parts.push('entry-playlist--has-cover');
      if (flags.hasTitle) parts.push('entry-playlist--has-title');
      if (!flags.hasCover && !flags.hasTitle) parts.push('entry-playlist--minimal');
      return parts.join(' ');
    }

    function appendPlaylistChrome(parent, block) {
      const flags = playlistChromeFlags(block);
      if (flags.hasCover) {
        const cover = document.createElement('img');
        cover.className = 'entry-playlist-cover';
        cover.src = String(block.coverArt).trim();
        cover.alt =
          (block.coverAlt && String(block.coverAlt).trim()) ||
          (flags.hasTitle ? block.title.trim() : 'cover art');
        parent.appendChild(cover);
      }
      if (flags.hasTitle) {
        const title = document.createElement('p');
        title.className = 'entry-playlist-title';
        title.textContent = block.title.trim();
        parent.appendChild(title);
      }
    }

    function refreshStudioPlaylistChrome(blockId) {
      if (!isStudioEditor()) return;
      const block = entryBlocks.find(function (item) {
        return item.id === blockId;
      });
      if (!block || block.type !== 'playlist') return;

      const previewWrap = blockEls.preview && blockEls.preview.querySelector('.entry-editor-preview-wrap');
      if (!previewWrap) return;

      const shell = previewWrap.querySelector(
        '.studio-preview-bubble[data-block-id="' + blockId + '"]'
      );
      if (!shell) return;

      const playlist = shell.querySelector('.entry-playlist');
      if (!playlist) return;

      playlist.className = playlistRootClass(block);

      const studioChrome = shell.querySelector('.studio-stack-chrome');
      if (studioChrome) {
        const titleInput = studioChrome.querySelector('.studio-stack-title-input');
        if (titleInput && document.activeElement !== titleInput) {
          titleInput.value = block.title || '';
        }
        if (typeof studioChrome._coverRefresh === 'function') {
          studioChrome._coverRefresh();
        }
        return;
      }

      playlist.querySelectorAll('.entry-playlist-cover, .entry-playlist-title').forEach(function (node) {
        node.remove();
      });

      const slot = playlist.querySelector('.entry-audio-list');
      const chromeFrag = document.createDocumentFragment();
      appendPlaylistChrome(chromeFrag, block);
      if (slot) {
        playlist.insertBefore(chromeFrag, slot);
      } else {
        playlist.appendChild(chromeFrag);
      }
    }

    function appendPreviewBlock(wrap, block, buildContent) {
      if (!isStudioEditor()) {
        const node = buildContent();
        if (node) wrap.appendChild(node);
        return;
      }

      const shell = document.createElement('div');
      shell.className = 'studio-preview-bubble';
      shell.dataset.blockId = block.id;
      shell.dataset.blockType = block.type;

      const drag = document.createElement('button');
      drag.type = 'button';
      drag.className = 'studio-bubble-drag icon-btn';
      drag.textContent = 'move';
      drag.draggable = true;
      drag.setAttribute('aria-label', 'Move ' + block.type + ' block');
      drag.title = 'Drag to reorder on the page';

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'studio-bubble-delete icon-btn';
      del.textContent = 'delete';
      del.setAttribute('aria-label', 'Delete ' + block.type + ' block');
      del.title = 'Remove this block from the page';
      del.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        removeBlock(block.id);
      });

      const body = document.createElement('div');
      body.className = 'studio-preview-bubble-body';
      const node = buildContent();
      if (node) body.appendChild(node);

      shell.appendChild(drag);
      shell.appendChild(body);
      shell.appendChild(del);
      wrap.appendChild(shell);
    }

    function renderPreview(entry) {
      blockEls.preview.innerHTML = '';

      const wrap = document.createElement('div');
      wrap.className = 'page-wrap entry-editor-preview-wrap';

      const id = document.createElement('p');
      id.className = 'page-id';
      id.textContent = entry.date;
      wrap.appendChild(id);

      entry.blocks.forEach(block => {
        if (block.type === 'spacing') {
          appendPreviewBlock(wrap, block, function () {
            const spacer = document.createElement('div');
            const size = window.normalizeSpacingSize ? window.normalizeSpacingSize(block.size) : 'md';
            spacer.className = `entry-spacing entry-spacing--${size}`;
            spacer.setAttribute('aria-hidden', 'true');
            return spacer;
          });
        }

        if (block.type === 'text') {
          appendPreviewBlock(wrap, block, function () {
            const p = document.createElement('p');
            p.className = textParagraphClass(block);
            p.dataset.blockId = block.id;
            const textValue = String(block.text || '');
            if (textBlockHasRenderableContent(textValue)) {
              if (window.renderTextIntoElement) {
                window.renderTextIntoElement(p, textValue);
              } else {
                p.textContent = textValue;
              }
            } else if (isStudioEditor()) {
              p.textContent = 'type here…';
              p.classList.add('studio-preview-text-empty');
            }
            return p;
          });
        }

        if (block.type === 'image' && (block.src.trim() || block.assetId)) {
          appendPreviewBlock(wrap, block, function () {
            const img = document.createElement('img');
            img.className = 'page-img';
            img.dataset.blockId = block.id;
            img.alt = block.alt.trim() || entry.date;
            const src = block.src.trim();
            if (block.assetId && window.BurnfolderAssetCloud && window.BurnfolderAssetCloud.getBlobUrl) {
              window.BurnfolderAssetCloud.getBlobUrl(block.assetId).then(function (blobUrl) {
                img.src = blobUrl || src;
              });
            }
            if (src) img.src = src;
            return img;
          });
        }

        if (block.type === 'video') {
          if (block.playbackId && block.playbackId.trim()) {
            appendPreviewBlock(wrap, block, function () {
              const player = document.createElement('mux-player');
              player.dataset.blockId = block.id;
              player.setAttribute('playback-id', block.playbackId.trim());
              player.setAttribute('metadata-video-title', block.title.trim() || entry.date);
              player.setAttribute('playbackrates', '1 1.5 2');
              player.setAttribute('noairplay', '');
              player.className = 'page-inline-video';
              player.style.width = '100%';
              player.style.marginBottom = '24px';
              return player;
            });
          } else if (isStudioEditor()) {
            appendPreviewBlock(wrap, block, function () {
              const note = document.createElement('p');
              note.className = 'studio-preview-placeholder';
              note.dataset.blockId = block.id;
              note.textContent = (block.title.trim() || 'video') + ' — stream from files when ready';
              return note;
            });
          }
        }

        if (block.type === 'audio') {
          if (block.playbackId && block.playbackId.trim()) {
            appendPreviewBlock(wrap, block, function () {
              if (isStudioEditor()) {
                return createPublishedAudioListSlot(block);
              }
              const audioHost = renderAudioPreview(block);
              audioHost.dataset.blockId = block.id;
              return audioHost;
            });
          } else if (isStudioEditor()) {
            appendPreviewBlock(wrap, block, function () {
              const note = document.createElement('p');
              note.className = 'studio-preview-placeholder';
              note.dataset.blockId = block.id;
              note.textContent = (block.title.trim() || 'audio') + ' — stream from files when ready';
              return note;
            });
          }
        }

        if (block.type === 'playlist') {
          appendPreviewBlock(wrap, block, function () {
            const playlist = document.createElement('div');
            playlist.className = playlistRootClass(block);
            if (isStudioEditor()) {
              playlist.appendChild(buildStudioStackChrome(block));
            } else {
              appendPlaylistChrome(playlist, block);
            }

            const hasTracks = block.tracks.some(function (track) {
              return track.playbackId && track.playbackId.trim();
            });

            if (hasTracks) {
              playlist.appendChild(
                createPublishedAudioListSlot(block, { playlistId: block.playlistId || block.id, inAlbum: true })
              );
            } else if (isStudioEditor()) {
              const emptyHint = document.createElement('p');
              emptyHint.className = 'studio-stack-empty';
              emptyHint.textContent = 'drop songs here';
              playlist.appendChild(emptyHint);
            }

            return playlist;
          });
        }

        if (block.type === 'album') {
          appendPreviewBlock(wrap, block, function () {
            const album = document.createElement('div');
            album.className = 'entry-album';

            if (block.coverArt.trim()) {
              const cover = document.createElement('img');
              cover.className = 'entry-album-cover';
              cover.src = block.coverArt.trim();
              cover.alt = block.coverAlt.trim() || block.title.trim() || 'album cover';
              album.appendChild(cover);
            }

            if (block.title.trim()) {
              const title = document.createElement('p');
              title.className = 'entry-album-title';
              title.textContent = block.title.trim();
              album.appendChild(title);
            }

            if (isStudioEditor()) {
              const hasTracks = block.tracks.some(function (track) {
                return track.playbackId && track.playbackId.trim();
              });
              if (hasTracks) {
                album.appendChild(
                  createPublishedAudioListSlot(block, { inAlbum: true, albumTitle: block.title.trim() })
                );
              }
            } else {
              block.tracks.forEach(function (track) {
                album.appendChild(renderAudioPreview(track));
              });
            }

            return album;
          });
        }
      });

      blockEls.preview.appendChild(wrap);

      if (isStudioEditor()) {
        attachStudioPreviewEditing(wrap);
        attachStudioPreviewReorder(wrap);
        attachStudioPlaylistEditing(wrap);
        hydrateStudioPreviewAudio(entry);
        if (window.studioInspectorPlaylistId) {
          const stillThere = entry.blocks.some(function (b) {
            return b.id === window.studioInspectorPlaylistId && b.type === 'playlist';
          });
          if (!stillThere) {
            selectStudioPlaylist(null);
          } else {
            renderStudioBlockInspector(window.studioInspectorPlaylistId);
          }
        }
      }
    }

    const STUDIO_MUX_PLAYBACK_MIME =
      window.STUDIO_MUX_PLAYBACK_MIME || 'application/x-burnfolder-mux-playback';
    const STUDIO_ALBUM_STACK_MIME =
      window.STUDIO_ALBUM_STACK_MIME || 'application/x-burnfolder-album-stack';
    const STUDIO_ALBUM_TRACK_MIME =
      window.STUDIO_ALBUM_TRACK_MIME || 'application/x-burnfolder-album-track';
    const STUDIO_PLAYLIST_TRACK_MIME = 'application/x-burnfolder-playlist-track';
    let studioPlaylistTrackDragId = null;

    function renderStudioBlockInspector(blockId) {
      const root = document.getElementById('studioBlockInspector');
      if (!root || !isStudioEditor()) return;

      root.innerHTML = '';

      if (!blockId) {
        const empty = document.createElement('p');
        empty.className = 'studio-inspector-empty';
        empty.textContent = 'click a stack in the page to edit tracks, title, or cover.';
        root.appendChild(empty);
        return;
      }

      const block = entryBlocks.find(function (item) {
        return item.id === blockId;
      });
      if (!block || block.type !== 'playlist') {
        const empty = document.createElement('p');
        empty.className = 'studio-inspector-empty';
        empty.textContent = 'click a stack in the page to edit tracks, title, or cover.';
        root.appendChild(empty);
        return;
      }

      const panel = document.createElement('div');
      panel.className = 'studio-playlist-inspector';

      const trackCount = block.tracks.filter(function (track) {
        return String(track.playbackId || '').trim();
      }).length;

      const intro = document.createElement('p');
      intro.className = 'studio-inspector-label';
      intro.textContent = trackCount ? 'stack · ' + trackCount + ' track' + (trackCount === 1 ? '' : 's') : 'stack · empty';
      panel.appendChild(intro);

      const chromeHint = document.createElement('p');
      chromeHint.className = 'studio-inspector-hint';
      chromeHint.textContent = 'name and cover are edited on the stack in the page.';
      panel.appendChild(chromeHint);

      panel.appendChild(makeStudioPlaylistTrackList(block));

      const hint = document.createElement('p');
      hint.className = 'studio-inspector-hint';
      hint.textContent = '≡ reorder · remove or × to delete track';
      panel.appendChild(hint);

      root.appendChild(panel);
    }

    function selectStudioPlaylist(blockId, opts) {
      const options = opts || {};
      window.studioInspectorPlaylistId = blockId || null;
      renderStudioBlockInspector(blockId || null);

      const stackPanel = document.querySelector('.studio-stack-panel');
      if (stackPanel) {
        stackPanel.classList.toggle('is-active', !!blockId);
      }

      const inspector = document.getElementById('studioBlockInspector');
      if (
        blockId &&
        options.scroll !== false &&
        inspector &&
        typeof inspector.scrollIntoView === 'function'
      ) {
        inspector.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }

      const wrap = blockEls.preview && blockEls.preview.querySelector('.entry-editor-preview-wrap');
      if (!wrap) return;

      studioPreviewBubbles(wrap).forEach(function (shell) {
        const selected =
          blockId && shell.dataset.blockType === 'playlist' && shell.dataset.blockId === blockId;
        shell.classList.toggle('is-playlist-selected', !!selected);
      });
    }

    function attachStudioPlaylistEditing(wrap) {
      function handlePreviewTap(event, shell) {
        if (
          event.target.closest(
            '.studio-bubble-drag, .studio-bubble-delete, .studio-playlist-track-delete, .music-track-row, .music-tracklist, button, a, input, textarea, select'
          )
        ) {
          return;
        }
        if (shell && shell.dataset.blockType === 'playlist') {
          selectStudioPlaylist(shell.dataset.blockId);
          return;
        }
        if (!event.target.closest('.studio-preview-bubble')) {
          selectStudioPlaylist(null);
        }
      }

      if (window.BurnfolderStudioTap && window.BurnfolderStudioTap.on) {
        window.BurnfolderStudioTap.on(wrap, '.studio-preview-bubble', handlePreviewTap);
      }

      wrap.addEventListener('click', function (event) {
        if (!event.target.closest('.studio-preview-bubble')) {
          selectStudioPlaylist(null);
          return;
        }

        const shell = event.target.closest('.studio-preview-bubble[data-block-type="playlist"]');
        if (!shell) return;
        if (
          event.target.closest(
            '.studio-bubble-drag, .studio-bubble-delete, .studio-playlist-track-delete, .music-track-row, .music-tracklist, button, a'
          )
        ) {
          return;
        }
        selectStudioPlaylist(shell.dataset.blockId);
      });

      wrap.querySelectorAll('.studio-preview-bubble[data-block-type="playlist"]').forEach(function (shell) {
        const playlistEl = shell.querySelector('.entry-playlist');
        if (!playlistEl) return;

        playlistEl.addEventListener('dragover', function (event) {
          const types = event.dataTransfer && event.dataTransfer.types;
          if (!types) return;
          const typeList = Array.from(types);
          const accepts =
            typeList.indexOf(STUDIO_MUX_PLAYBACK_MIME) >= 0 ||
            typeList.indexOf(STUDIO_ALBUM_TRACK_MIME) >= 0 ||
            typeList.indexOf(STUDIO_ALBUM_STACK_MIME) >= 0 ||
            (window.BurnfolderStreamShared &&
              typeList.indexOf(window.BurnfolderStreamShared.MUX_MIME) >= 0);
          if (!accepts) return;
          if (!isPointInElement(event.clientX, event.clientY, playlistEl)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'copy';
          shell.classList.add('is-playlist-drop-target');
        });

        playlistEl.addEventListener('dragleave', function (event) {
          if (playlistEl.contains(event.relatedTarget)) return;
          shell.classList.remove('is-playlist-drop-target');
        });

        playlistEl.addEventListener('drop', function (event) {
          const stackDrop = event.dataTransfer.getData(STUDIO_ALBUM_STACK_MIME);
          const playbackId =
            event.dataTransfer.getData(STUDIO_MUX_PLAYBACK_MIME) ||
            event.dataTransfer.getData(STUDIO_ALBUM_TRACK_MIME) ||
            (window.BurnfolderStreamShared
              ? event.dataTransfer.getData(window.BurnfolderStreamShared.MUX_MIME)
              : '');
          if (!stackDrop && !playbackId) return;
          if (!isPointInElement(event.clientX, event.clientY, playlistEl)) return;
          event.preventDefault();
          event.stopPropagation();
          shell.classList.remove('is-playlist-drop-target');

          if (stackDrop) {
            const shared = window.BurnfolderStreamShared;
            if (!shared) return;
            const tracks = shared.loadStack();
            const meta = shared.loadStackMeta();
            tracks.forEach(function (track) {
              appendTrackToPlaylist(shell.dataset.blockId, {
                title: track.title || '',
                playbackId: track.playbackId || ''
              });
            });
            const block = entryBlocks.find(function (item) {
              return item.id === shell.dataset.blockId;
            });
            if (block && block.type === 'playlist') {
              if (meta.title && !block.title) block.title = meta.title;
              if (meta.coverArt && !block.coverArt) {
                block.coverArt = meta.coverArt;
                block.coverAlt = meta.coverAlt || meta.title || '';
              }
              updateAll();
            }
            setStatus('project merged into stack');
            return;
          }

          const label =
            event.dataTransfer.getData('text/plain') ||
            event.dataTransfer.getData('application/x-burnfolder-mux-label') ||
            '';

          appendTrackToPlaylist(shell.dataset.blockId, {
            title: label,
            playbackId: playbackId
          });
        });
      });
    }

    let studioPreviewInputTimer = null;

    function studioPreviewBubbles(wrap) {
      return Array.from(wrap.querySelectorAll('.studio-preview-bubble'));
    }

    function clearStudioDropMarkers(wrap, keepDraggingId) {
      studioPreviewBubbles(wrap).forEach(function (shell) {
        shell.classList.remove(
          'is-drop-target',
          'is-drop-before',
          'is-drop-after',
          'is-merge-target'
        );
        if (!keepDraggingId || shell.dataset.blockId !== keepDraggingId) {
          shell.classList.remove('is-dragging');
        }
      });
    }

    function isStudioBlockDrag(event) {
      if (draggingBlockId) return true;
      const types = event.dataTransfer && event.dataTransfer.types;
      if (!types) return false;
      return Array.from(types).indexOf(STUDIO_BLOCK_DRAG_MIME) >= 0;
    }

    function playlistTracksFromBlock(block) {
      if (!block) return [];
      if (block.type === 'audio') {
        const playbackId = String(block.playbackId || '').trim();
        if (!playbackId) return [];
        return [{ id: block.id, title: block.title || '', playbackId: playbackId }];
      }
      if (block.type === 'playlist' && Array.isArray(block.tracks)) {
        return block.tracks
          .filter(function (track) {
            return String(track.playbackId || '').trim();
          })
          .map(function (track) {
            return {
              id: track.id || makeId(),
              title: track.title || '',
              playbackId: track.playbackId
            };
          });
      }
      return [];
    }

    function canMergeIntoPlaylist(blockA, blockB) {
      if (!blockA || !blockB || blockA.id === blockB.id) return false;
      if (blockA.type !== 'audio' && blockA.type !== 'playlist') return false;
      if (blockB.type !== 'audio' && blockB.type !== 'playlist') return false;
      if (!playlistTracksFromBlock(blockA).length) return false;
      if (!playlistTracksFromBlock(blockB).length) return false;
      return true;
    }

    function mergeIntoPlaylist(targetId, sourceId) {
      const target = entryBlocks.find(function (b) {
        return b.id === targetId;
      });
      const source = entryBlocks.find(function (b) {
        return b.id === sourceId;
      });
      if (!canMergeIntoPlaylist(source, target)) return false;

      const targetIndex = entryBlocks.findIndex(function (b) {
        return b.id === targetId;
      });
      const sourceIndex = entryBlocks.findIndex(function (b) {
        return b.id === sourceId;
      });

      const ordered = [target, source].sort(function (a, b) {
        return (
          entryBlocks.findIndex(function (x) {
            return x.id === a.id;
          }) -
          entryBlocks.findIndex(function (x) {
            return x.id === b.id;
          })
        );
      });

      let tracks = [];
      ordered.forEach(function (block) {
        tracks = tracks.concat(playlistTracksFromBlock(block));
      });

      const playlist = createBlock('playlist', {
        title: target.type === 'playlist' ? target.title : '',
        coverArt: target.type === 'playlist' ? target.coverArt : '',
        coverAlt: target.type === 'playlist' ? target.coverAlt : '',
        tracks: tracks
      });
      if (target.type === 'playlist') {
        playlist.id = target.id;
        playlist.playlistId = target.playlistId || target.id;
        playlist.coverAssetId = target.coverAssetId || '';
      }

      entryBlocks = entryBlocks.filter(function (b) {
        return b.id !== sourceId && b.id !== targetId;
      });
      const insertAt = Math.min(targetIndex, sourceIndex);
      entryBlocks.splice(insertAt, 0, playlist);
      renderEditorBlocks();
      updateAll();
      if (isStudioEditor()) {
        selectStudioPlaylist(playlist.id);
      }
      setStatus('stack created — plays top to bottom');
      return true;
    }

    function isPlaylistMergeDrop(event, shell) {
      const rect = shell.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const edge = Math.min(20, rect.height * 0.22);
      return y > edge && y < rect.height - edge;
    }

    function isPointInElement(clientX, clientY, element) {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    }

    function getPlaylistBlockIdAtPoint(clientX, clientY, scope) {
      const root = scope || document;
      const playlists = root.querySelectorAll(
        '.studio-preview-bubble[data-block-type="playlist"] .entry-playlist'
      );
      for (let i = 0; i < playlists.length; i += 1) {
        const playlistEl = playlists[i];
        if (!isPointInElement(clientX, clientY, playlistEl)) continue;
        const shell = playlistEl.closest('.studio-preview-bubble[data-block-type="playlist"]');
        if (shell && shell.dataset.blockId) return shell.dataset.blockId;
      }
      return null;
    }

    function attachStudioPreviewReorder(wrap) {
      studioPreviewBubbles(wrap).forEach(function (shell) {
        const handle = shell.querySelector('.studio-bubble-drag');
        if (!handle) return;

        handle.addEventListener('dragstart', function (event) {
          draggingBlockId = shell.dataset.blockId;
          shell.classList.add('is-dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(STUDIO_BLOCK_DRAG_MIME, shell.dataset.blockId);
          event.dataTransfer.setData('text/plain', shell.dataset.blockId);
        });

        handle.addEventListener('dragend', function () {
          draggingBlockId = null;
          clearStudioDropMarkers(wrap);
        });
      });

      studioPreviewBubbles(wrap).forEach(function (shell) {
        shell.addEventListener('dragover', function (event) {
          if (!isStudioBlockDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';

          const draggedId =
            event.dataTransfer.getData(STUDIO_BLOCK_DRAG_MIME) || draggingBlockId;
          clearStudioDropMarkers(wrap, draggedId);

          if (draggedId === shell.dataset.blockId) return;

          const draggedBlock = entryBlocks.find(function (b) {
            return b.id === draggedId;
          });
          const targetBlock = entryBlocks.find(function (b) {
            return b.id === shell.dataset.blockId;
          });
          const mergeDrop =
            isPlaylistMergeDrop(event, shell) && canMergeIntoPlaylist(draggedBlock, targetBlock);

          shell.classList.add('is-drop-target');
          shell.classList.toggle('is-merge-target', mergeDrop);
          const rect = shell.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          shell.classList.toggle('is-drop-before', !mergeDrop && before);
          shell.classList.toggle('is-drop-after', !mergeDrop && !before);
        });

        shell.addEventListener('dragleave', function (event) {
          if (shell.contains(event.relatedTarget)) return;
          shell.classList.remove(
            'is-drop-target',
            'is-drop-before',
            'is-drop-after',
            'is-merge-target'
          );
        });

        shell.addEventListener('drop', function (event) {
          if (!isStudioBlockDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();

          const draggedId =
            event.dataTransfer.getData(STUDIO_BLOCK_DRAG_MIME) || draggingBlockId;
          clearStudioDropMarkers(wrap);
          draggingBlockId = null;

          if (!draggedId || draggedId === shell.dataset.blockId) return;

          const draggedBlock = entryBlocks.find(function (b) {
            return b.id === draggedId;
          });
          const targetBlock = entryBlocks.find(function (b) {
            return b.id === shell.dataset.blockId;
          });

          if (
            isPlaylistMergeDrop(event, shell) &&
            mergeIntoPlaylist(shell.dataset.blockId, draggedId)
          ) {
            return;
          }

          const fromIndex = entryBlocks.findIndex(function (b) {
            return b.id === draggedId;
          });
          let toIndex = entryBlocks.findIndex(function (b) {
            return b.id === shell.dataset.blockId;
          });
          if (fromIndex < 0 || toIndex < 0) return;

          const rect = shell.getBoundingClientRect();
          const insertBefore = event.clientY < rect.top + rect.height / 2;
          if (!insertBefore) toIndex += 1;
          if (fromIndex < toIndex) toIndex -= 1;

          moveBlock(fromIndex, toIndex);
        });
      });
    }

    function attachStudioPreviewEditing(wrap) {
      wrap.querySelectorAll('.studio-preview-bubble-body [data-block-id]').forEach(function (node) {
        const blockId = node.dataset.blockId;
        const block = entryBlocks.find(function (item) {
          return item.id === blockId;
        });
        if (!block || block.type !== 'text') return;

        node.contentEditable = 'true';
        node.classList.add('studio-preview-text-editable');
        if (window.BurnfolderDisableInputAutocorrect) {
          window.BurnfolderDisableInputAutocorrect.apply(node);
        }

        node.addEventListener('focus', function () {
          window.studioSelectedBlockId = blockId;
          if (node.classList.contains('studio-preview-text-empty')) {
            node.textContent = '';
            node.classList.remove('studio-preview-text-empty');
          }
        });

        node.addEventListener('input', function () {
          block.text = node.innerText.replace(/\u00a0/g, ' ');
          window.clearTimeout(studioPreviewInputTimer);
          studioPreviewInputTimer = window.setTimeout(function () {
            saveDraft(gatherEntry());
            blockEls.dataOutput.value = buildEntryDataSnippet(gatherEntry());
            blockEls.htmlOutput.value = buildEntryHtml(gatherEntry());
            blockEls.songsOutput && (blockEls.songsOutput.value = buildSongsSnippet(gatherEntry()));
            blockEls.journalOutput && (blockEls.journalOutput.value = buildJournalLine(gatherEntry()));
          }, 400);
        });

        node.addEventListener('blur', function () {
          if (!textBlockHasRenderableContent(block.text)) {
            node.textContent = 'type here…';
            node.classList.add('studio-preview-text-empty');
          }
          updateAll();
        });
      });
    }

    function insertStudioAsset(asset) {
      if (!asset) return null;
      const title = asset.displayTitle || asset.name;
      const playbackId = asset.muxPlaybackId || asset.playbackId || '';

      if (playbackId && (asset.kind === 'video' || asset.kind === 'audio' || !asset.kind)) {
        const blockType = asset.kind === 'video' ? 'video' : 'audio';
        return createBlock(blockType, {
          title: title,
          playbackId: playbackId
        });
      }

      if (asset.kind === 'audio') {
        return createBlock('audio', {
          title: title,
          playbackId: playbackId
        });
      }
      if (asset.kind === 'video') {
        return createBlock('video', {
          title: title,
          playbackId: playbackId
        });
      }
      if (asset.notes) {
        return createBlock('text', { text: asset.notes, textSize: 'md' });
      }
      return createBlock('text', {
        text: title + (asset.kind && asset.kind !== 'text' ? ' (' + asset.kind + ')' : ''),
        textSize: 'md'
      });
    }

    function insertStudioJournal(note) {
      const text = ((note.title ? note.title + '\n\n' : '') + (note.body || '')).trim();
      return createBlock('text', { text: text, textSize: 'md' });
    }

    function pushBlock(block) {
      entryBlocks.push(block);
      renderEditorBlocks();
      updateAll();
      return block;
    }

    function publishEntryEditorApi() {
      const api = {
        addBlock: function (type, data) {
          return pushBlock(createBlock(type, data || {}));
        },
        insertAsset: function (asset) {
          return pushBlock(insertStudioAsset(asset));
        },
        getPlaylistBlockIdAtPoint: function (clientX, clientY) {
          const preview = document.getElementById('entryPreview');
          return getPlaylistBlockIdAtPoint(clientX, clientY, preview);
        },
        appendToPlaylist: function (blockId, asset) {
          if (!asset) return null;
          const title = asset.displayTitle || asset.name || '';
          const playbackId = asset.muxPlaybackId || asset.playbackId || '';
          if (!appendTrackToPlaylist(blockId, { title: title, playbackId: playbackId })) {
            return null;
          }
          return entryBlocks.find(function (b) {
            return b.id === blockId;
          });
        },
        insertStackPlaylist: function (data) {
          return insertStackPlaylist(data);
        },
        selectPlaylist: function (blockId) {
          selectStudioPlaylist(blockId || null);
        },
        insertJournal: function (note) {
          return pushBlock(insertStudioJournal(note));
        },
        addText: function (text, opts) {
          return pushBlock(createBlock('text', {
            text: text || '',
            textSize: opts && opts.textSize ? opts.textSize : 'md'
          }));
        },
        addSpacing: function (size) {
          return pushBlock(createBlock('spacing', { size: size || 'md' }));
        },
        setTextSize: function (size) {
          const normalized = normalizeTextSize(size);
          let block = entryBlocks.find(function (item) {
            return item.id === window.studioSelectedBlockId && item.type === 'text';
          });
          if (!block) {
            block = entryBlocks.slice().reverse().find(function (item) {
              return item.type === 'text';
            });
          }
          if (!block) {
            block = pushBlock(createBlock('text', { text: '', textSize: normalized }));
          } else {
            block.textSize = normalized;
            updateAll();
          }
          return block;
        },
        refresh: updateAll,
        removeBlock: function (id) {
          removeBlock(id);
        },
        getBlocks: function () {
          return entryBlocks.slice();
        },
        getPublishPayload: function () {
          const entry = gatherEntry();
          return {
            date: entry.date,
            blocks: entry.blocks.map(cleanBlockForData)
          };
        }
      };

      window.burnfolderEntryEditorApi = api;
      window.dispatchEvent(new CustomEvent('burnfolder-entry-editor-ready', { detail: api }));
      return api;
    }

    function saveDraft(entry) {
      if (window.burnfolderStudio && typeof window.burnfolderStudio.persistDraft === 'function') {
        window.burnfolderStudio.persistDraft({
          date: entry.date,
          blocks: entry.blocks
        });
        return;
      }

      window.localStorage.setItem(BLOCK_STORAGE_KEY, JSON.stringify({
        date: entry.date,
        blocks: entry.blocks
      }));
    }

    function updateAll() {
      const entry = gatherEntry();
      syncEntryOutputs(entry);
      renderPreview(entry);
      renderEditorBlocks();
    }

    async function copyText(value) {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return;
      }

      const temp = document.createElement('textarea');
      temp.value = value;
      temp.style.position = 'fixed';
      temp.style.left = '-9999px';
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      document.execCommand('copy');
      temp.remove();
    }

    function downloadHtml() {
      const entry = gatherEntry();
      const blob = new Blob([blockEls.htmlOutput.value], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${entry.date}.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus(`downloaded ${entry.date}.html`);
    }

    function downloadEntryPackage() {
      const entry = gatherEntry();
      const blob = new Blob([buildEntryPackageJson(entry)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${entry.date}-entry-package.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus(`downloaded ${entry.date} package`);
    }

    async function saveHtmlFile() {
      const entry = gatherEntry();

      if (!window.showSaveFilePicker) {
        downloadHtml();
        setStatus('save picker unavailable, downloaded instead');
        return;
      }

      const handle = await window.showSaveFilePicker({
        suggestedName: `${entry.date}.html`,
        types: [{ description: 'HTML file', accept: { 'text/html': ['.html'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blockEls.htmlOutput.value);
      await writable.close();
      setStatus(`saved ${entry.date}.html`);
    }

    function seedBlocksForDate(date) {
      const entry = window.entryDataByDate && window.entryDataByDate[date];
      if (entry && Array.isArray(entry.blocks) && entry.blocks.length) {
        return entry.blocks.map(block => createBlock(block.type, block));
      }

      const songs = window.songsByPage && window.songsByPage[date] ? window.songsByPage[date] : [];
      return songs.length ? songs.map(song => createBlock('audio', song)) : [createBlock('text', { text: '' })];
    }

    function migrateLegacyDraft(currentDate) {
      const saved = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!saved) return null;

      try {
        const draft = JSON.parse(saved);
        const migratedBlocks = [];

        if (draft.text) {
          String(draft.text).split(/\n\s*\n/g).map(part => part.trim()).filter(Boolean).forEach(text => {
            migratedBlocks.push(createBlock('text', { text }));
          });
        }

        if (draft.image) {
          migratedBlocks.push(createBlock('image', { src: draft.image, alt: draft.imageAlt || draft.date || currentDate }));
        }

        if (draft.videoPlaybackId) {
          migratedBlocks.push(createBlock('video', { playbackId: draft.videoPlaybackId, title: draft.videoTitle || draft.date || currentDate }));
        }

        if (Array.isArray(draft.songs)) {
          draft.songs.forEach(song => {
            migratedBlocks.push(createBlock('audio', song));
          });
        }

        if (!migratedBlocks.length) return null;

        return {
          date: draft.date || currentDate,
          blocks: migratedBlocks
        };
      } catch (error) {
        return null;
      }
    }

    function loadDraft() {
      const saved = window.localStorage.getItem(BLOCK_STORAGE_KEY);
      const currentDate = normalizeDateKey(blockEls.date.value);

      if (saved) {
        try {
          const draft = JSON.parse(saved);
          blockEls.date.value = draft.date || currentDate;
          entryBlocks = Array.isArray(draft.blocks) && draft.blocks.length
            ? draft.blocks.map(normalizeLoadedBlock)
            : seedBlocksForDate(blockEls.date.value);
          return;
        } catch (error) {
          window.localStorage.removeItem(BLOCK_STORAGE_KEY);
        }
      }

      const legacyDraft = migrateLegacyDraft(currentDate);
      if (legacyDraft) {
        blockEls.date.value = legacyDraft.date;
        entryBlocks = legacyDraft.blocks;
        return;
      }

      blockEls.date.value = currentDate;
      entryBlocks = seedBlocksForDate(currentDate);
    }

    function addBlock(type) {
      entryBlocks.push(createBlock(type));
      renderEditorBlocks();
      updateAll();
    }

    function bindBlockEditorStaticControls() {
      [
        ['addTextBlockBtn', 'text'],
        ['addSpacingBlockBtn', 'spacing'],
        ['addImageBlockBtn', 'image'],
        ['addAudioBlockBtn', 'audio'],
        ['addAlbumBlockBtn', 'album'],
        ['addVideoBlockBtn', 'video']
      ].forEach(function (pair) {
        const btn = document.getElementById(pair[0]);
        if (!btn || btn.dataset.editorBound === '1') return;
        btn.dataset.editorBound = '1';
        btn.addEventListener('click', function () {
          addBlock(pair[1]);
        });
      });

      const refreshPreviewBtn = document.getElementById('refreshPreviewBtn');
      if (refreshPreviewBtn && refreshPreviewBtn.dataset.editorBound !== '1') {
        refreshPreviewBtn.dataset.editorBound = '1';
        refreshPreviewBtn.addEventListener('click', updateAll);
      }

      const copyHtmlBtn = document.getElementById('copyHtmlBtn');
      if (copyHtmlBtn && copyHtmlBtn.dataset.editorBound !== '1') {
        copyHtmlBtn.dataset.editorBound = '1';
        copyHtmlBtn.addEventListener('click', async function () {
          await copyText(blockEls.htmlOutput.value);
          setStatus('copied html');
        });
      }

      const copyPackageBtn = document.getElementById('copyPackageBtn');
      if (copyPackageBtn && copyPackageBtn.dataset.editorBound !== '1') {
        copyPackageBtn.dataset.editorBound = '1';
        copyPackageBtn.addEventListener('click', async function () {
          await copyText(buildEntryPackage(gatherEntry()));
          setStatus('copied entry package');
        });
      }

      const downloadPackageBtn = document.getElementById('downloadPackageBtn');
      if (downloadPackageBtn && downloadPackageBtn.dataset.editorBound !== '1') {
        downloadPackageBtn.dataset.editorBound = '1';
        downloadPackageBtn.addEventListener('click', downloadEntryPackage);
      }

      const downloadHtmlBtn = document.getElementById('downloadHtmlBtn');
      if (downloadHtmlBtn && downloadHtmlBtn.dataset.editorBound !== '1') {
        downloadHtmlBtn.dataset.editorBound = '1';
        downloadHtmlBtn.addEventListener('click', downloadHtml);
      }

      const saveHtmlBtn = document.getElementById('saveHtmlBtn');
      if (saveHtmlBtn && saveHtmlBtn.dataset.editorBound !== '1') {
        saveHtmlBtn.dataset.editorBound = '1';
        saveHtmlBtn.addEventListener('click', function () {
          saveHtmlFile().catch(function () {
            setStatus('could not save html');
          });
        });
      }

      document.querySelectorAll('[data-copy-target]').forEach(function (button) {
        if (button.dataset.editorBound === '1') return;
        button.dataset.editorBound = '1';
        button.addEventListener('click', async function () {
          const target = document.getElementById(button.dataset.copyTarget);
          await copyText(target.value);
          setStatus('copied');
        });
      });
    }

    let blockEditorBootPromise = null;
    let blockEditorBootToken = 0;

    function finishBlockEditorBootFallback() {
      loadDraft();
      if (
        document.body.classList.contains('studio-editor-page') &&
        !entryBlocks.length
      ) {
        entryBlocks.push(createBlock('text', { text: '', textSize: 'md' }));
      }
      renderEditorBlocks();
      updateAll();
      publishEntryEditorApi();
    }

    async function bootBlockEditor() {
      if (window.burnfolderStudio && typeof window.burnfolderStudio.loadInitialDraft === 'function') {
        const remote = await window.burnfolderStudio.loadInitialDraft();
        if (remote && remote.date) {
          blockEls.date.value = remote.date;
          entryBlocks = Array.isArray(remote.blocks) && remote.blocks.length
            ? remote.blocks.map(function (block) {
              const next = normalizeLoadedBlock(block);
              if (next.type === 'text') next.textSize = normalizeTextSize(next.textSize);
              return next;
            })
            : seedBlocksForDate(remote.date);
        } else {
          loadDraft();
        }
      } else {
        loadDraft();
      }

      if (
        document.body.classList.contains('studio-editor-page') &&
        !entryBlocks.length
      ) {
        entryBlocks.push(createBlock('text', { text: '', textSize: 'md' }));
      }

      renderEditorBlocks();
      updateAll();
      publishEntryEditorApi();
    }

    function runBlockEditorBoot() {
      refreshBlockEditorDom();
      bindBlockEditorEvents();
      bindBlockEditorStaticControls();

      blockEditorBootToken += 1;
      const token = blockEditorBootToken;

      blockEditorBootPromise = bootBlockEditor()
        .catch(function () {
          if (token !== blockEditorBootToken) return;
          finishBlockEditorBootFallback();
        })
        .finally(function () {
          if (token === blockEditorBootToken) {
            blockEditorBootPromise = null;
          }
        });

      return blockEditorBootPromise;
    }

    window.studioReloadEntryDraft = function () {
      blockEditorBootToken += 1;
      blockEditorBootPromise = null;
      return runBlockEditorBoot();
    };

    window.studioInitEntryEditorDom = function () {
      if (!document.getElementById('entryBlocks')) return Promise.resolve();
      refreshBlockEditorDom();
      bindBlockEditorEvents();
      bindBlockEditorStaticControls();
      return Promise.resolve();
    };

    window.__studioBlockEditorLoaded = true;
    runBlockEditorBoot();
    return;
  }

  const STORAGE_KEY = 'burnfolderEntryEditorDraft';
  const SCRIPT_VERSION = '20260509c';

  const els = {
    date: document.getElementById('entryDate'),
    image: document.getElementById('entryImage'),
    imageAlt: document.getElementById('entryImageAlt'),
    text: document.getElementById('entryText'),
    videoPlaybackId: document.getElementById('entryVideoPlaybackId'),
    videoTitle: document.getElementById('entryVideoTitle'),
    songs: document.getElementById('entrySongs'),
    preview: document.getElementById('entryPreview'),
    htmlOutput: document.getElementById('entryHtmlOutput'),
    songsOutput: document.getElementById('songsEntryOutput'),
    journalOutput: document.getElementById('journalEntryOutput'),
    status: document.getElementById('entryEditorStatus')
  };

  function todayKey() {
    const now = new Date();
    return `${now.getMonth() + 1}.${now.getDate()}.${String(now.getFullYear()).slice(-2)}`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeJsString(value) {
    return JSON.stringify(String(value || ''));
  }

  function normalizeDateKey(value) {
    return String(value || '').trim() || todayKey();
  }

  function splitParagraphs(value) {
    return String(value || '')
      .split(/\n\s*\n/g)
      .map(part => part.trim())
      .filter(Boolean);
  }

  function setStatus(message) {
    if (!els.status) return;
    els.status.textContent = message;
    window.clearTimeout(setStatus.timer);
    setStatus.timer = window.setTimeout(() => {
      els.status.textContent = '';
    }, 2400);
  }

  function getSongsFromForm() {
    return Array.from(els.songs.querySelectorAll('.entry-song-row'))
      .map(row => ({
        title: row.querySelector('[data-song-title]').value.trim(),
        playbackId: row.querySelector('[data-song-playback-id]').value.trim()
      }))
      .filter(song => song.title || song.playbackId);
  }

  function addSongRow(song) {
    const row = document.createElement('div');
    row.className = 'entry-song-row';

    const titleField = document.createElement('div');
    titleField.className = 'entry-editor-field';
    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'song title';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = song && song.title ? song.title : '';
    titleInput.setAttribute('data-song-title', '');
    titleField.appendChild(titleLabel);
    titleField.appendChild(titleInput);

    const playbackField = document.createElement('div');
    playbackField.className = 'entry-editor-field';
    const playbackLabel = document.createElement('label');
    playbackLabel.textContent = 'Mux playback ID';
    const playbackInput = document.createElement('input');
    playbackInput.type = 'text';
    playbackInput.value = song && song.playbackId ? song.playbackId : '';
    playbackInput.spellcheck = false;
    playbackInput.setAttribute('data-song-playback-id', '');
    playbackField.appendChild(playbackLabel);
    playbackField.appendChild(playbackInput);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'icon-btn entry-song-remove';
    removeBtn.type = 'button';
    removeBtn.textContent = 'remove';
    removeBtn.addEventListener('click', () => {
      row.remove();
      updateAll();
    });

    row.appendChild(titleField);
    row.appendChild(playbackField);
    row.appendChild(removeBtn);
    els.songs.appendChild(row);

    row.addEventListener('input', updateAll);
  }

  function gatherEntry() {
    const date = normalizeDateKey(els.date.value);
    return {
      date,
      image: els.image.value.trim(),
      imageAlt: els.imageAlt.value.trim() || date,
      textBlocks: splitParagraphs(els.text.value),
      videoPlaybackId: els.videoPlaybackId.value.trim(),
      videoTitle: els.videoTitle.value.trim() || date,
      songs: getSongsFromForm()
    };
  }

  function renderTextBlock(block) {
    return escapeHtml(block).replace(/\n/g, '<br>');
  }

  function buildEntryHtml(entry) {
    const bodyParts = [`  <p class="page-id">${escapeHtml(entry.date)}</p>`];

    if (entry.videoPlaybackId) {
      bodyParts.push(`  <mux-player
    playback-id="${escapeHtml(entry.videoPlaybackId)}"
    metadata-video-title="${escapeHtml(entry.videoTitle)}"
    playbackrates="1 1.5 2"
    noairplay
    class="page-inline-video"
    style="width:100%;margin-bottom:24px;"
  ></mux-player>`);
    }

    if (entry.image) {
      bodyParts.push(`  <img src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.imageAlt)}" class="page-img">`);
    }

    entry.textBlocks.forEach(block => {
      bodyParts.push(`  <p class="page-annotation">${renderTextBlock(block)}</p>`);
    });

    bodyParts.push('  <div id="audioList" style="margin-top: 48px;"></div>');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(entry.date)}</title>
<script src="https://cdn.jsdelivr.net/npm/@mux/mux-player" defer></script>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="site-header">
  <a href="index.html" class="site-brand">burnfolder.com</a>
  <nav class="site-nav" aria-label="Primary">
    <a href="music.html" class="page-nav">music</a>
    <a href="content.html" class="page-nav">video</a>
    <a href="shop.html" class="page-nav">shop</a>
  </nav>
  <a href="cart.html" class="icon-btn site-cart-btn site-cart-btn--hidden" id="cartFloat" title="View cart">cart</a>
</header>

<div class="page-wrap">
${bodyParts.join('\n\n')}
</div>

<div class="page-watermark">${escapeHtml(entry.date)}</div>

<!-- bottom player - do not modify -->
<div class="bottom-progress-bar" id="bottomBar">
  <div class="close-btn" id="closeBtn" aria-label="Close Now Playing">&times;</div>
  <div class="bottom-bar-content">
    <mux-player id="activeMuxPlayer" audio playsinline stream-type="on-demand" preload="metadata" style="position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;"></mux-player>
    <span class="song-title" id="songTitle">Track Title</span>
    <div class="bottom-bar-controls">
      <button class="bottom-play-pause-btn" id="bottomPlayPause" aria-label="Play/Pause">&#9654;</button>
      <div class="progress-bar-area" id="progressBarArea">
        <div class="progress" id="progress"></div>
        <div class="progress-playhead" id="progressPlayhead"></div>
      </div>
    </div>
    <div class="loading-spinner" id="loadingSpinner"></div>
  </div>
</div>
<script src="songs.js"></script>
<script src="stripe-publishable.js"></script>
<script src="spa-router.js"></script>
<script src="scripts.js?v=${SCRIPT_VERSION}"></script>
</body>
</html>
`;
  }

  function buildSongsSnippet(entry) {
    const tracks = entry.songs
      .filter(song => song.title && song.playbackId)
      .map(song => `    { title: ${escapeJsString(song.title)}, playbackId: ${escapeJsString(song.playbackId)} }`);

    return `  ${escapeJsString(entry.date)}: [
${tracks.join(',\n')}
  ],`;
  }

  function buildJournalLine(entry) {
    const existing = Array.isArray(window.journalEntries) ? window.journalEntries : [];
    const next = [entry.date].concat(existing.filter(item => item !== entry.date));
    return `window.journalEntries = ${JSON.stringify(next)};`;
  }

  function appendTextWithBreaks(parent, value) {
    String(value || '').split('\n').forEach((line, index) => {
      if (index > 0) parent.appendChild(document.createElement('br'));
      parent.appendChild(document.createTextNode(line));
    });
  }

  function renderPreview(entry) {
    els.preview.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'page-wrap entry-editor-preview-wrap';

    const id = document.createElement('p');
    id.className = 'page-id';
    id.textContent = entry.date;
    wrap.appendChild(id);

    if (entry.videoPlaybackId) {
      const player = document.createElement('mux-player');
      player.setAttribute('playback-id', entry.videoPlaybackId);
      player.setAttribute('metadata-video-title', entry.videoTitle);
      player.setAttribute('playbackrates', '1 1.5 2');
      player.setAttribute('noairplay', '');
      player.className = 'page-inline-video';
      player.style.width = '100%';
      player.style.marginBottom = '24px';
      wrap.appendChild(player);
    }

    if (entry.image) {
      const img = document.createElement('img');
      img.className = 'page-img';
      img.src = entry.image;
      img.alt = entry.imageAlt;
      wrap.appendChild(img);
    }

    entry.textBlocks.forEach(block => {
      const p = document.createElement('p');
      p.className = 'page-annotation';
      appendTextWithBreaks(p, block);
      wrap.appendChild(p);
    });

    const songList = document.createElement('div');
    songList.className = 'entry-editor-song-preview';
    songList.style.marginTop = '48px';

    const list = document.createElement('ol');
    list.className = 'music-tracklist';
    entry.songs.forEach((song, index) => {
      const item = document.createElement('li');
      item.className = 'music-tracklist-item';

      const num = document.createElement('span');
      num.className = 'music-track-num';
      num.textContent = String(index + 1);

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'music-track-row';
      row.disabled = true;

      const name = document.createElement('span');
      name.className = 'music-track-title';
      name.textContent = song.title || 'untitled song';

      const duration = document.createElement('span');
      duration.className = 'music-track-duration';
      duration.textContent = '--:--';

      row.appendChild(name);
      row.appendChild(duration);
      item.appendChild(num);
      item.appendChild(row);
      list.appendChild(item);
    });
    songList.appendChild(list);

    wrap.appendChild(songList);
    els.preview.appendChild(wrap);
  }

  function saveDraft(entry) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      date: entry.date,
      image: entry.image,
      imageAlt: entry.imageAlt,
      text: els.text.value,
      videoPlaybackId: entry.videoPlaybackId,
      videoTitle: entry.videoTitle,
      songs: entry.songs
    }));
  }

  function updateAll() {
    const entry = gatherEntry();
    els.htmlOutput.value = buildEntryHtml(entry);
    els.songsOutput.value = buildSongsSnippet(entry);
    els.journalOutput.value = buildJournalLine(entry);
    renderPreview(entry);
    saveDraft(entry);
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const temp = document.createElement('textarea');
    temp.value = value;
    temp.style.position = 'fixed';
    temp.style.left = '-9999px';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();
    document.execCommand('copy');
    temp.remove();
  }

  function downloadHtml() {
    const entry = gatherEntry();
    const blob = new Blob([els.htmlOutput.value], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${entry.date}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`downloaded ${entry.date}.html`);
  }

  async function saveHtmlFile() {
    const entry = gatherEntry();

    if (!window.showSaveFilePicker) {
      downloadHtml();
      setStatus('save picker unavailable, downloaded instead');
      return;
    }

    const handle = await window.showSaveFilePicker({
      suggestedName: `${entry.date}.html`,
      types: [{ description: 'HTML file', accept: { 'text/html': ['.html'] } }]
    });
    const writable = await handle.createWritable();
    await writable.write(els.htmlOutput.value);
    await writable.close();
    setStatus(`saved ${entry.date}.html`);
  }

  function loadDraft() {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const currentDate = normalizeDateKey(els.date.value);
    const existingSongs = window.songsByPage && window.songsByPage[currentDate] ? window.songsByPage[currentDate] : [];

    if (saved) {
      try {
        const draft = JSON.parse(saved);
        els.date.value = draft.date || currentDate;
        els.image.value = draft.image || '';
        els.imageAlt.value = draft.imageAlt || '';
        els.text.value = draft.text || '';
        els.videoPlaybackId.value = draft.videoPlaybackId || '';
        els.videoTitle.value = draft.videoTitle || '';
        (draft.songs && draft.songs.length ? draft.songs : existingSongs).forEach(addSongRow);
        return;
      } catch (error) {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    els.date.value = currentDate;
    existingSongs.forEach(addSongRow);
    if (!existingSongs.length) addSongRow();
  }

  document.getElementById('addSongBtn').addEventListener('click', () => {
    addSongRow();
    updateAll();
  });

  const refreshPreviewBtnLegacy = document.getElementById('refreshPreviewBtn');
  if (refreshPreviewBtnLegacy) refreshPreviewBtnLegacy.addEventListener('click', updateAll);
  const copyHtmlBtnLegacy = document.getElementById('copyHtmlBtn');
  if (copyHtmlBtnLegacy) {
    copyHtmlBtnLegacy.addEventListener('click', async () => {
      await copyText(els.htmlOutput.value);
      setStatus('copied html');
    });
  }
  const downloadHtmlBtnLegacy = document.getElementById('downloadHtmlBtn');
  if (downloadHtmlBtnLegacy) downloadHtmlBtnLegacy.addEventListener('click', downloadHtml);
  const saveHtmlBtnLegacy = document.getElementById('saveHtmlBtn');
  if (saveHtmlBtnLegacy) {
    saveHtmlBtnLegacy.addEventListener('click', () => {
      saveHtmlFile().catch(() => setStatus('could not save html'));
    });
  }

  document.querySelectorAll('[data-copy-target]').forEach(button => {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.copyTarget);
      await copyText(target.value);
      setStatus('copied');
    });
  });

  [els.date, els.image, els.imageAlt, els.text, els.videoPlaybackId, els.videoTitle].forEach(input => {
    input.addEventListener('input', updateAll);
  });

  loadDraft();
  updateAll();
})();
