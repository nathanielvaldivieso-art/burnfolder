(function() {
  'use strict';

  function isEntryTextHtml(value) {
    return /<(?:br|mark)\b/i.test(String(value || ''));
  }

  function sanitizeEntryTextHtml(html) {
    const root = document.createElement('div');
    const template = document.createElement('template');
    template.innerHTML = String(html || '');

    function copyChildren(source, target) {
      source.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          target.appendChild(child.cloneNode());
          return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) return;

        const tag = child.tagName;
        if (tag === 'BR') {
          target.appendChild(document.createElement('br'));
        } else if (tag === 'MARK') {
          const mark = document.createElement('mark');
          copyChildren(child, mark);
          if (mark.childNodes.length) target.appendChild(mark);
        } else if (tag === 'DIV' || tag === 'P') {
          if (target.childNodes.length) target.appendChild(document.createElement('br'));
          copyChildren(child, target);
        } else {
          copyChildren(child, target);
        }
      });
    }

    copyChildren(template.content, root);
    while (root.lastChild && root.lastChild.nodeName === 'BR') {
      root.removeChild(root.lastChild);
    }
    return root.innerHTML;
  }

  function textBlockHasRenderableContent(text) {
    const raw = String(text || '');
    return raw.length > 0 && (raw.trim().length > 0 || raw.includes('\n'));
  }

  function renderTextIntoElement(parent, value) {
    const text = String(value || '');
    if (!textBlockHasRenderableContent(text)) return;

    const trimmed = text.trim();
    if (trimmed && isEntryTextHtml(trimmed)) {
      parent.innerHTML = sanitizeEntryTextHtml(trimmed);
      return;
    }

    text.split('\n').forEach((line, index) => {
      if (index > 0) parent.appendChild(document.createElement('br'));
      if (line.length) parent.appendChild(document.createTextNode(line));
    });
  }

  function appendTextWithBreaks(parent, value) {
    renderTextIntoElement(parent, value);
  }

  function normalizeSpacingSize(size) {
    return size === 'sm' || size === 'lg' ? size : 'md';
  }

  function renderAudioSlot(parent, block) {
    const slot = document.createElement('div');
    slot.className = 'entry-audio-list';
    slot.style.marginTop = block.type === 'album' || block.type === 'playlist' ? '12px' : '20px';

    const playlistKey = block.playlistId || block.id;
    if (block.type === 'playlist' && playlistKey) {
      slot.dataset.playlist = playlistKey;
    } else if (block.type === 'album' && block.title) {
      slot.dataset.album = block.title;
    } else if (block.playbackId) {
      slot.dataset.playbackId = block.playbackId;
    }

    parent.appendChild(slot);
  }

  function renderBlock(block, entry, wrap) {
    if (block.type === 'spacing') {
      const spacer = document.createElement('div');
      spacer.className = `entry-spacing entry-spacing--${normalizeSpacingSize(block.size)}`;
      spacer.setAttribute('aria-hidden', 'true');
      wrap.appendChild(spacer);
      return;
    }

    if (block.type === 'text' && block.text) {
      const p = document.createElement('p');
      const size = block.textSize === 'sm' || block.textSize === 'lg' ? block.textSize : 'md';
      p.className = size === 'md' ? 'page-annotation' : `page-annotation entry-text--${size}`;
      renderTextIntoElement(p, block.text);
      wrap.appendChild(p);
    }

    if (block.type === 'image' && block.src) {
      const img = document.createElement('img');
      img.src = block.src;
      img.alt = block.alt || entry.date;
      img.className = 'page-img';
      wrap.appendChild(img);
    }

    if (block.type === 'audio' && block.playbackId) {
      renderAudioSlot(wrap, block);
    }

    if (block.type === 'album') {
      const album = document.createElement('div');
      album.className = 'entry-album';

      if (block.coverArt) {
        const cover = document.createElement('img');
        cover.src = block.coverArt;
        cover.alt = block.coverAlt || block.title || 'album cover';
        cover.className = 'entry-album-cover';
        album.appendChild(cover);
      }

      if (block.title) {
        const title = document.createElement('p');
        title.className = 'entry-album-title';
        title.textContent = block.title;
        album.appendChild(title);
      }

      renderAudioSlot(album, block);
      wrap.appendChild(album);
    }

    if (block.type === 'playlist' && Array.isArray(block.tracks) && block.tracks.length) {
      const hasTitle = !!(block.title && String(block.title).trim());
      const hasCover = !!(block.coverArt && String(block.coverArt).trim());
      const playlist = document.createElement('div');
      playlist.className = 'entry-playlist';
      if (hasCover) playlist.classList.add('entry-playlist--has-cover');
      if (hasTitle) playlist.classList.add('entry-playlist--has-title');
      if (!hasCover && !hasTitle) playlist.classList.add('entry-playlist--minimal');

      if (hasCover) {
        const cover = document.createElement('img');
        cover.src = String(block.coverArt).trim();
        cover.alt = (block.coverAlt && String(block.coverAlt).trim()) || (hasTitle ? block.title : 'cover art');
        cover.className = 'entry-playlist-cover';
        playlist.appendChild(cover);
      }

      if (hasTitle) {
        const title = document.createElement('p');
        title.className = 'entry-playlist-title';
        title.textContent = block.title;
        playlist.appendChild(title);
      }

      renderAudioSlot(playlist, block);
      wrap.appendChild(playlist);
    }

    if (block.type === 'video' && block.playbackId) {
      const player = document.createElement('mux-player');
      player.setAttribute('playback-id', block.playbackId);
      player.setAttribute('metadata-video-title', block.title || entry.date);
      player.setAttribute('playbackrates', '1 1.5 2');
      player.setAttribute('noairplay', '');
      player.className = 'page-inline-video';
      player.style.width = '100%';
      player.style.marginBottom = '24px';
      wrap.appendChild(player);
    }
  }

  function renderDataEntryPage(pageKey) {
    const key = pageKey || window.location.pathname.split('/').pop().replace('.html', '');
    const entry = window.entryDataByDate && window.entryDataByDate[key];
    if (!entry) return false;

    const wrap = document.querySelector('.page-wrap');
    if (!wrap) return false;

    document.title = entry.date;
    wrap.innerHTML = '';

    const id = document.createElement('p');
    id.className = 'page-id';
    id.textContent = entry.date;
    wrap.appendChild(id);

    (entry.blocks || []).forEach(block => renderBlock(block, entry, wrap));

    const watermark = document.querySelector('.page-watermark');
    if (watermark) watermark.textContent = entry.date;
    return true;
  }

  window.sanitizeEntryTextHtml = sanitizeEntryTextHtml;
  window.isEntryTextHtml = isEntryTextHtml;
  window.renderTextIntoElement = renderTextIntoElement;
  window.textBlockHasRenderableContent = textBlockHasRenderableContent;
  window.normalizeSpacingSize = normalizeSpacingSize;
  window.renderDataEntryPage = renderDataEntryPage;
  renderDataEntryPage();
})();
