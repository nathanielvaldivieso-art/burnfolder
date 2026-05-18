(function() {
  'use strict';

  if (document.getElementById('entryBlocks')) {
    const BLOCK_STORAGE_KEY = 'burnfolderEntryEditorBlockDraft';
    const LEGACY_STORAGE_KEY = 'burnfolderEntryEditorDraft';
    const BLOCK_SCRIPT_VERSION = '20260509c';
    const blockEls = {
      date: document.getElementById('entryDate'),
      blocks: document.getElementById('entryBlocks'),
      preview: document.getElementById('entryPreview'),
      dataOutput: document.getElementById('entryDataOutput'),
      htmlOutput: document.getElementById('entryHtmlOutput'),
      songsOutput: document.getElementById('songsEntryOutput'),
      journalOutput: document.getElementById('journalEntryOutput'),
      status: document.getElementById('entryEditorStatus')
    };
    let entryBlocks = [];
    let draggingBlockId = null;

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

    function setStatus(message) {
      if (!blockEls.status) return;
      blockEls.status.textContent = message;
      window.clearTimeout(setStatus.timer);
      setStatus.timer = window.setTimeout(() => {
        blockEls.status.textContent = '';
      }, 2400);
    }

    function createBlock(type, data) {
      const base = { id: makeId(), type };
      if (type === 'text') return { ...base, text: data && data.text ? data.text : '' };
      if (type === 'image') return { ...base, src: data && data.src ? data.src : '', alt: data && data.alt ? data.alt : '' };
      if (type === 'video') return { ...base, playbackId: data && data.playbackId ? data.playbackId : '', title: data && data.title ? data.title : '' };
      if (type === 'album') {
        return {
          ...base,
          title: data && data.title ? data.title : '',
          coverArt: data && data.coverArt ? data.coverArt : '',
          coverAlt: data && data.coverAlt ? data.coverAlt : '',
          tracks: Array.isArray(data && data.tracks) && data.tracks.length
            ? data.tracks.map(track => ({ id: track.id || makeId(), title: track.title || '', playbackId: track.playbackId || '' }))
            : [{ id: makeId(), title: '', playbackId: '' }]
        };
      }
      return { ...base, title: data && data.title ? data.title : '', playbackId: data && data.playbackId ? data.playbackId : '' };
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
      renderEditorBlocks();
      updateAll();
    }

    function updateBlock(id, field, value) {
      const block = entryBlocks.find(item => item.id === id);
      if (!block) return;
      block[field] = value;
      updateAll();
    }

    function updateAlbumTrack(blockId, trackId, field, value) {
      const block = entryBlocks.find(item => item.id === blockId);
      if (!block || !Array.isArray(block.tracks)) return;
      const track = block.tracks.find(item => item.id === trackId);
      if (!track) return;
      track[field] = value;
      updateAll();
    }

    function addAlbumTrack(blockId) {
      const block = entryBlocks.find(item => item.id === blockId);
      if (!block || !Array.isArray(block.tracks)) return;
      block.tracks.push({ id: makeId(), title: '', playbackId: '' });
      renderEditorBlocks();
      updateAll();
    }

    function removeAlbumTrack(blockId, trackId) {
      const block = entryBlocks.find(item => item.id === blockId);
      if (!block || !Array.isArray(block.tracks)) return;
      block.tracks = block.tracks.filter(track => track.id !== trackId);
      if (!block.tracks.length) block.tracks.push({ id: makeId(), title: '', playbackId: '' });
      renderEditorBlocks();
      updateAll();
    }

    function moveAlbumTrack(blockId, trackId, direction) {
      const block = entryBlocks.find(item => item.id === blockId);
      if (!block || !Array.isArray(block.tracks)) return;
      const index = block.tracks.findIndex(track => track.id === trackId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= block.tracks.length) return;
      const [track] = block.tracks.splice(index, 1);
      block.tracks.splice(nextIndex, 0, track);
      renderEditorBlocks();
      updateAll();
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

    function makeBlockFields(block) {
      const fields = document.createElement('div');
      fields.className = 'entry-block-fields';

      if (block.type === 'text') {
        fields.appendChild(makeField(block, 'text', 'text', 'textarea'));
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
        fields.appendChild(makeAlbumTrackFields(block));
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
      input.addEventListener('input', () => updateAlbumTrack(block.id, track.id, field, input.value));

      fieldWrap.appendChild(label);
      fieldWrap.appendChild(input);
      return fieldWrap;
    }

    function makeAlbumTrackFields(block) {
      const wrap = document.createElement('div');
      wrap.className = 'entry-album-track-list';

      const heading = document.createElement('div');
      heading.className = 'entry-album-track-heading';
      const headingText = document.createElement('span');
      headingText.textContent = 'album tracks';
      const addBtn = document.createElement('button');
      addBtn.className = 'icon-btn';
      addBtn.type = 'button';
      addBtn.textContent = 'add track';
      addBtn.addEventListener('click', () => addAlbumTrack(block.id));
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
        upBtn.addEventListener('click', () => moveAlbumTrack(block.id, track.id, -1));

        const downBtn = document.createElement('button');
        downBtn.className = 'icon-btn';
        downBtn.type = 'button';
        downBtn.textContent = 'down';
        downBtn.disabled = index === block.tracks.length - 1;
        downBtn.addEventListener('click', () => moveAlbumTrack(block.id, track.id, 1));

        const removeBtn = document.createElement('button');
        removeBtn.className = 'icon-btn';
        removeBtn.type = 'button';
        removeBtn.textContent = 'remove';
        removeBtn.addEventListener('click', () => removeAlbumTrack(block.id, track.id));

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

    function renderEditorBlocks() {
      blockEls.blocks.innerHTML = '';

      if (!entryBlocks.length) {
        const empty = document.createElement('p');
        empty.className = 'entry-editor-empty';
        empty.textContent = 'add a text, photo, audio, or video block to start.';
        blockEls.blocks.appendChild(empty);
        return;
      }

      entryBlocks.forEach((block, index) => {
        const card = document.createElement('article');
        card.className = 'entry-block-card';
        card.draggable = true;
        card.dataset.blockId = block.id;

        const top = document.createElement('div');
        top.className = 'entry-block-top';

        const handle = document.createElement('button');
        handle.className = 'entry-block-handle';
        handle.type = 'button';
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

        card.addEventListener('dragstart', event => {
          draggingBlockId = block.id;
          card.classList.add('is-dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', block.id);
        });

        card.addEventListener('dragend', () => {
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
      if (block.type === 'text' && block.text.trim()) {
        return `  <p class="page-annotation">${textToHtml(block.text.trim())}</p>`;
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
        return `  <div class="entry-audio-list" data-playback-id="${escapeHtml(block.playbackId.trim())}" style="margin-top: 48px;"></div>`;
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
          albumParts.push(`    <div class="entry-audio-list" data-album="${escapeHtml(block.title.trim())}" style="margin-top: 24px;"></div>`);
        }
        albumParts.push('  </div>');
        return albumParts.length > 2 ? albumParts.join('\n') : '';
      }

      return '';
    }

    function buildEntryHtml(entry) {
      const bodyParts = [`  <p class="page-id">${escapeHtml(entry.date)}</p>`];

      entry.blocks.forEach(block => {
        const html = blockToHtml(block);
        if (html) bodyParts.push(html);
      });

      if (!entry.blocks.some(block => block.type === 'audio' || block.type === 'album')) {
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
    <mux-player id="activeMuxPlayer" style="width:0;height:0;position:absolute;left:-9999px;"></mux-player>
    <span class="song-title" id="songTitle">Track Title</span>
    <div class="bottom-bar-controls">
      <div class="volume-control" id="volumeControl">
        <div class="speaker-icon" id="speakerIcon">&#9834;</div>
        <div class="volume-fader" id="volumeFader">
          <div class="volume-track">
            <div class="volume-fill" id="volumeFill"></div>
          </div>
        </div>
      </div>
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
      if (block.type === 'text') return { type: 'text', text: block.text || '' };
      if (block.type === 'image') return { type: 'image', src: block.src || '', alt: block.alt || '' };
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

    function appendTextWithBreaks(parent, value) {
      String(value || '').split('\n').forEach((line, index) => {
        if (index > 0) parent.appendChild(document.createElement('br'));
        parent.appendChild(document.createTextNode(line));
      });
    }

    function renderAudioPreview(block) {
      const row = document.createElement('div');
      row.className = 'mux-audio-container';

      const title = document.createElement('span');
      title.className = 'page-song-title';
      title.setAttribute('role', 'button');
      title.setAttribute('tabindex', '0');

      const name = document.createElement('span');
      name.className = 'audio-track-name';
      name.textContent = block.title || 'untitled song';

      const duration = document.createElement('span');
      duration.className = 'song-duration';
      duration.textContent = '--:--';

      title.appendChild(name);
      title.appendChild(duration);
      row.appendChild(title);
      return row;
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
        if (block.type === 'text' && block.text.trim()) {
          const p = document.createElement('p');
          p.className = 'page-annotation';
          appendTextWithBreaks(p, block.text.trim());
          wrap.appendChild(p);
        }

        if (block.type === 'image' && block.src.trim()) {
          const img = document.createElement('img');
          img.className = 'page-img';
          img.src = block.src.trim();
          img.alt = block.alt.trim() || entry.date;
          wrap.appendChild(img);
        }

        if (block.type === 'video' && block.playbackId.trim()) {
          const player = document.createElement('mux-player');
          player.setAttribute('playback-id', block.playbackId.trim());
          player.setAttribute('metadata-video-title', block.title.trim() || entry.date);
          player.setAttribute('playbackrates', '1 1.5 2');
          player.setAttribute('noairplay', '');
          player.className = 'page-inline-video';
          player.style.width = '100%';
          player.style.marginBottom = '24px';
          wrap.appendChild(player);
        }

        if (block.type === 'audio') {
          wrap.appendChild(renderAudioPreview(block));
        }

        if (block.type === 'album') {
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

          block.tracks.forEach(track => {
            album.appendChild(renderAudioPreview(track));
          });

          wrap.appendChild(album);
        }
      });

      blockEls.preview.appendChild(wrap);
    }

    function saveDraft(entry) {
      window.localStorage.setItem(BLOCK_STORAGE_KEY, JSON.stringify({
        date: entry.date,
        blocks: entry.blocks
      }));
    }

    function updateAll() {
      const entry = gatherEntry();
      blockEls.dataOutput.value = buildEntryDataSnippet(entry);
      blockEls.htmlOutput.value = buildEntryHtml(entry);
      blockEls.songsOutput.value = buildSongsSnippet(entry);
      blockEls.journalOutput.value = buildJournalLine(entry);
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
            ? draft.blocks.map(block => ({ ...block, id: block.id || makeId() }))
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

    document.getElementById('addTextBlockBtn').addEventListener('click', () => addBlock('text'));
    document.getElementById('addImageBlockBtn').addEventListener('click', () => addBlock('image'));
    document.getElementById('addAudioBlockBtn').addEventListener('click', () => addBlock('audio'));
    document.getElementById('addAlbumBlockBtn').addEventListener('click', () => addBlock('album'));
    document.getElementById('addVideoBlockBtn').addEventListener('click', () => addBlock('video'));

    document.getElementById('refreshPreviewBtn').addEventListener('click', updateAll);
    document.getElementById('copyHtmlBtn').addEventListener('click', async () => {
      await copyText(blockEls.htmlOutput.value);
      setStatus('copied html');
    });
    document.getElementById('copyPackageBtn').addEventListener('click', async () => {
      await copyText(buildEntryPackage(gatherEntry()));
      setStatus('copied entry package');
    });
    document.getElementById('downloadPackageBtn').addEventListener('click', downloadEntryPackage);
    document.getElementById('downloadHtmlBtn').addEventListener('click', downloadHtml);
    document.getElementById('saveHtmlBtn').addEventListener('click', () => {
      saveHtmlFile().catch(() => setStatus('could not save html'));
    });

    document.querySelectorAll('[data-copy-target]').forEach(button => {
      button.addEventListener('click', async () => {
        const target = document.getElementById(button.dataset.copyTarget);
        await copyText(target.value);
        setStatus('copied');
      });
    });

    blockEls.date.addEventListener('input', updateAll);

    loadDraft();
    renderEditorBlocks();
    updateAll();
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
    <mux-player id="activeMuxPlayer" style="width:0;height:0;position:absolute;left:-9999px;"></mux-player>
    <span class="song-title" id="songTitle">Track Title</span>
    <div class="bottom-bar-controls">
      <div class="volume-control" id="volumeControl">
        <div class="speaker-icon" id="speakerIcon">&#9834;</div>
        <div class="volume-fader" id="volumeFader">
          <div class="volume-track">
            <div class="volume-fill" id="volumeFill"></div>
          </div>
        </div>
      </div>
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

    entry.songs.forEach(song => {
      const row = document.createElement('div');
      row.className = 'mux-audio-container';

      const title = document.createElement('span');
      title.className = 'page-song-title';
      title.setAttribute('role', 'button');
      title.setAttribute('tabindex', '0');

      const name = document.createElement('span');
      name.className = 'audio-track-name';
      name.textContent = song.title || 'untitled song';

      const duration = document.createElement('span');
      duration.className = 'song-duration';
      duration.textContent = '--:--';

      title.appendChild(name);
      title.appendChild(duration);
      row.appendChild(title);
      songList.appendChild(row);
    });

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

  document.getElementById('refreshPreviewBtn').addEventListener('click', updateAll);
  document.getElementById('copyHtmlBtn').addEventListener('click', async () => {
    await copyText(els.htmlOutput.value);
    setStatus('copied html');
  });
  document.getElementById('downloadHtmlBtn').addEventListener('click', downloadHtml);
  document.getElementById('saveHtmlBtn').addEventListener('click', () => {
    saveHtmlFile().catch(() => setStatus('could not save html'));
  });

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
