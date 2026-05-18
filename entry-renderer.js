(function() {
  'use strict';

  function appendTextWithBreaks(parent, value) {
    String(value || '').split('\n').forEach((line, index) => {
      if (index > 0) parent.appendChild(document.createElement('br'));
      parent.appendChild(document.createTextNode(line));
    });
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
    if (block.type === 'text' && block.text) {
      const p = document.createElement('p');
      p.className = 'page-annotation';
      appendTextWithBreaks(p, block.text);
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

  window.renderDataEntryPage = renderDataEntryPage;
  renderDataEntryPage();
})();
