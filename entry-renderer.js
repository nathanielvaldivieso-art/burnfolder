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

  function renderTextIntoElement(parent, value) {
    const text = String(value || '');
    if (!text.trim()) return;

    if (isEntryTextHtml(text)) {
      parent.innerHTML = sanitizeEntryTextHtml(text);
      return;
    }

    text.split('\n').forEach((line, index) => {
      if (index > 0) parent.appendChild(document.createElement('br'));
      parent.appendChild(document.createTextNode(line));
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
    slot.style.marginTop = block.type === 'album' ? '24px' : '48px';

    if (block.type === 'album' && block.title) {
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
      p.className = 'page-annotation';
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
  window.normalizeSpacingSize = normalizeSpacingSize;
  window.renderDataEntryPage = renderDataEntryPage;
  renderDataEntryPage();
})();
