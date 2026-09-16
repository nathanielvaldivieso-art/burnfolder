(function (root) {
  'use strict';

  const songRender = root.BurnfolderSongPageRender;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function textToHtml(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function pageNotes(page) {
    if (!page) return '';
    if (songRender && songRender.pageNotes) return songRender.pageNotes(page);
    if (typeof page.notes === 'string' && page.notes.trim()) return page.notes.trim();
    return '';
  }

  function versionLyrics(page, playbackId) {
    if (!page || !playbackId) return '';
    if (songRender && songRender.versionLyrics) return songRender.versionLyrics(page, playbackId);
    const versions = page.versions && typeof page.versions === 'object' ? page.versions : {};
    const entry = versions[playbackId] || {};
    return String(entry.lyrics || '').trim();
  }

  function defaultVersionId(page, catalogVersions) {
    const list = Array.isArray(catalogVersions) ? catalogVersions : [];
    for (let i = 0; i < list.length; i += 1) {
      const song = list[i];
      if (song && song.playbackId && versionLyrics(page, song.playbackId)) {
        return song.playbackId;
      }
    }
    return list[0] && list[0].playbackId ? list[0].playbackId : '';
  }

  function compileTrackRows(opts) {
    const options = opts || {};
    const tracks = Array.isArray(options.tracks) ? options.tracks : [];
    const songPages = options.songPages || {};
    const songCatalog = options.songCatalog || [];
    const versionsApi = options.versionsApi || root.BurnfolderSongVersions;

    return tracks.map(function (item, index) {
      const title = item.title || 'untitled';
      const groupKey =
        versionsApi && versionsApi.getTrackGroupKey
          ? versionsApi.getTrackGroupKey(title)
          : '';
      const page = songPages[groupKey] || null;
      const versions =
        versionsApi && groupKey
          ? versionsApi.collectVersionsByGroupKey(songCatalog, groupKey)
          : [];
      const playbackId = defaultVersionId(page, versions) || item.playbackId || '';
      const lyrics = versionLyrics(page, playbackId);
      const notes = pageNotes(page);
      const media = page && Array.isArray(page.media) ? page.media : [];
      const songHref =
        typeof options.songPageUrl === 'function'
          ? options.songPageUrl(item)
          : '';

      return {
        index: index,
        title: title,
        groupKey: groupKey,
        playbackId: item.playbackId,
        item: item,
        page: page,
        versions: versions,
        lyrics: lyrics,
        notes: notes,
        media: media,
        songHref: songHref
      };
    });
  }

  function createElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function renderMediaCard(item) {
    if (songRender && typeof songRender.renderMediaCard === 'function') {
      return songRender.renderMediaCard(item, {});
    }
    const card = document.createElement('article');
    card.className = 'album-hub__media-card';
    const title = document.createElement('h4');
    title.textContent = (item && item.title) || 'Untitled';
    card.appendChild(title);
    return card;
  }

  function renderPanel(row) {
    const panel = createElement('section', 'album-hub__panel');
    panel.setAttribute('aria-label', row.title + ' details');

    const header = createElement('div', 'album-hub__panel-header');
    header.appendChild(createElement('h2', 'album-hub__panel-title', row.title));

    const closeBtn = createElement('button', 'icon-btn album-hub__panel-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close details');
    closeBtn.addEventListener('click', function () {
      panel.hidden = true;
    });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    if (row.songHref) {
      const link = createElement('a', 'icon-btn album-hub__panel-link', 'song page');
      link.href = row.songHref;
      link.setAttribute('aria-label', 'Open ' + row.title + ' song page');
      panel.appendChild(link);
    }

    if (row.notes) {
      const notesWrap = createElement('div', 'album-hub__panel-section');
      notesWrap.appendChild(createElement('h3', 'album-hub__panel-label', 'notes'));
      const body = createElement('div', 'album-hub__panel-body');
      body.innerHTML = textToHtml(row.notes);
      notesWrap.appendChild(body);
      panel.appendChild(notesWrap);
    }

    if (row.lyrics) {
      const lyricsWrap = createElement('div', 'album-hub__panel-section');
      lyricsWrap.appendChild(createElement('h3', 'album-hub__panel-label', 'lyrics'));
      const body = createElement('div', 'album-hub__panel-body');
      body.innerHTML = textToHtml(row.lyrics);
      lyricsWrap.appendChild(body);
      panel.appendChild(lyricsWrap);
    }

    const media = row.media || [];
    if (media.length) {
      const mediaWrap = createElement('div', 'album-hub__panel-section');
      mediaWrap.appendChild(createElement('h3', 'album-hub__panel-label', 'media'));
      const grid = createElement('div', 'album-hub__media-grid');
      media.forEach(function (item) {
        grid.appendChild(renderMediaCard(item));
      });
      mediaWrap.appendChild(grid);
      panel.appendChild(mediaWrap);
    }

    if (!row.notes && !row.lyrics && !media.length) {
      const empty = createElement('p', 'album-hub__panel-empty', 'no more info yet.');
      panel.appendChild(empty);
    }

    return panel;
  }

  function apply(rootEl, options) {
    const opts = options || {};
    const albumPage = opts.albumPage || {};
    const tracks = Array.isArray(opts.tracks) ? opts.tracks : [];
    const title = albumPage.title || 'Album';
    const coverArt = albumPage.coverArt || '';
    const rows = compileTrackRows(opts);

    if (!rootEl) return;
    rootEl.innerHTML = '';
    rootEl.className = 'album-hub';

    const header = createElement('header', 'album-hub__site');
    header.innerHTML =
      '<span class="album-hub__site-name">burnfolder</span>' +
      '<span class="album-hub__site-sep" aria-hidden="true">—</span>' +
      '<span class="album-hub__site-title">' + escapeHtml(title) + '</span>';
    rootEl.appendChild(header);

    const chrome = createElement('div', 'album-hub__chrome');

    const cover = createElement('button', 'album-hub__cover' + (coverArt ? '' : ' is-empty'));
    cover.type = 'button';
    cover.setAttribute('aria-label', title + ' cover');
    if (coverArt) {
      const img = createElement('img', 'album-hub__cover-img');
      img.src = coverArt;
      img.alt = title + ' cover';
      cover.appendChild(img);
    } else {
      cover.textContent = 'cover';
    }
    chrome.appendChild(cover);

    const meta = createElement('div', 'album-hub__meta');
    const titleEl = createElement('h1', 'album-hub__title', title);
    meta.appendChild(titleEl);

    if (albumPage.credits) {
      meta.appendChild(createElement('p', 'album-hub__credits', albumPage.credits));
    }

    const actions = createElement('div', 'album-hub__actions');
    const playBtn = createElement('button', 'icon-btn album-hub__play', '▶');
    playBtn.type = 'button';
    playBtn.setAttribute('aria-label', 'Play ' + title);
    playBtn.addEventListener('click', function () {
      if (typeof root.playTrack === 'function') {
        root.playTrack(0);
      } else if (typeof root.playTrackQueue === 'function') {
        root.playTrackQueue(tracks, 0);
      } else if (typeof root.playTrackBySong === 'function' && tracks[0]) {
        root.playTrackBySong(tracks[0]);
      }
    });
    actions.appendChild(playBtn);
    meta.appendChild(actions);
    chrome.appendChild(meta);
    rootEl.appendChild(chrome);

    const grid = createElement('div', 'album-hub__grid');
    grid.setAttribute('role', 'list');
    grid.setAttribute('aria-label', 'Tracks');

    const panelMount = createElement('div', 'album-hub__panel-mount');

    rows.forEach(function (row) {
      const tile = createElement('button', 'album-hub__tile');
      tile.type = 'button';
      tile.setAttribute('role', 'listitem');
      tile.setAttribute('aria-label', row.title);

      const tileTitle = createElement('span', 'album-hub__tile-title', row.title);
      tile.appendChild(tileTitle);

      tile.addEventListener('click', function () {
        panelMount.innerHTML = '';
        const panel = renderPanel(row);
        panelMount.appendChild(panel);
      });

      grid.appendChild(tile);
    });

    rootEl.appendChild(grid);
    rootEl.appendChild(panelMount);
  }

  root.BurnfolderAlbumHubRender = {
    apply: apply,
    compileTrackRows: compileTrackRows
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
