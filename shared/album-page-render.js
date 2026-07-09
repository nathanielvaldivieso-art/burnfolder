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

  function panelVisible(el) {
    if (!el) return;
    el.hidden = false;
    el.classList.remove('is-empty');
  }

  function panelHidden(el) {
    if (!el) return;
    el.hidden = true;
    el.classList.add('is-empty');
  }

  function formatDuration(seconds) {
    const pf = root.BurnfolderPlaybackPrefetch;
    if (pf && pf.formatDuration) return pf.formatDuration(seconds);
    const shared = root.BurnfolderStreamShared;
    if (shared && shared.formatDuration) return shared.formatDuration(seconds);
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return '';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function attachTrackDuration(durEl, playbackId, knownSeconds) {
    const pf = root.BurnfolderPlaybackPrefetch;
    if (pf && pf.requestDuration) {
      pf.requestDuration(durEl, playbackId, knownSeconds);
      return;
    }
    if (durEl) durEl.textContent = formatDuration(knownSeconds) || '--:--';
  }

  function sumRowDurations(rows) {
    const pf = root.BurnfolderPlaybackPrefetch;
    let total = 0;
    let complete = (rows || []).length > 0;
    (rows || []).forEach(function (row) {
      const known = Number(row.item && row.item.duration);
      let sec = Number.isFinite(known) && known > 0 ? known : 0;
      if (!sec && pf && pf.getCachedDuration) {
        sec = pf.getCachedDuration(row.playbackId) || 0;
      }
      if (sec > 0) total += sec;
      else complete = false;
    });
    return { total: total, complete: complete };
  }

  function refreshAlbumSubtitle(subtitleEl, rows) {
    if (!subtitleEl) return;
    const shared = root.BurnfolderStreamShared;
    const items = (rows || []).map(function (row) {
      return {
        playbackId: row.playbackId,
        duration: row.item && row.item.duration
      };
    });
    if (shared && shared.sumTrackDurations && shared.albumTrackCountMeta) {
      const sum = shared.sumTrackDurations(items);
      subtitleEl.textContent = shared.albumTrackCountMeta(
        items.length,
        sum.complete ? sum.total : 0
      );
      return;
    }
    const summary = sumRowDurations(rows);
    const base = items.length + ' track' + (items.length === 1 ? '' : 's');
    if (!summary.complete || !summary.total) {
      subtitleEl.textContent = base;
      return;
    }
    const dur = formatDuration(summary.total);
    subtitleEl.textContent = dur ? base + ' · ' + dur : base;
  }

  function bindAlbumSubtitleDurationSync(rootEl) {
    if (!rootEl || rootEl._albumDurationSyncBound) return;
    rootEl._albumDurationSyncBound = true;
    root.addEventListener('burnfolder-duration-ready', function (event) {
      const detail = event.detail || {};
      const rows = rootEl._albumHubRows || [];
      if (
        !rows.some(function (row) {
          return row.playbackId === detail.playbackId;
        })
      ) {
        return;
      }
      refreshAlbumSubtitle(rootEl.querySelector('[data-album-field="subtitle"]'), rows);
    });
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
      const title = options.itemLabel ? options.itemLabel(item) : item.title || 'untitled';
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
        options.songPageUrl && item
          ? options.songPageUrl(item)
          : versionsApi && versions[0]
            ? versionsApi.getStreamSongHref(versions[0], item.playbackId)
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

  function renderMediaCard(item, opts) {
    if (songRender && typeof songRender.renderMediaCard === 'function') {
      return songRender.renderMediaCard(item, opts || {});
    }
    const card = document.createElement('article');
    card.className = 'song-hub-content-card';
    const title = document.createElement('h3');
    title.textContent = (item && item.title) || 'Untitled';
    card.appendChild(title);
    return card;
  }

  function renderTracklist(rootEl, rows, opts) {
    const listEl = rootEl.querySelector('[data-album-field="tracklist"]');
    if (!listEl) return;
    const options = opts || {};
    listEl.innerHTML = '';

    if (!rows.length) {
      listEl.innerHTML = '<p class="song-hub-empty">No tracks in this album yet.</p>';
      return;
    }

    const ol = document.createElement('ol');
    ol.className = 'music-tracklist entry-audio-list album-hub-tracklist';

    rows.forEach(function (row) {
      const li = document.createElement('li');
      li.className = 'music-tracklist-item album-hub-track-item';
      li.dataset.playbackId = row.playbackId || '';

      const num = document.createElement('span');
      num.className = 'music-track-num';
      num.textContent = String(row.index + 1);

      const rowBtn = document.createElement('button');
      rowBtn.type = 'button';
      rowBtn.className = 'music-track-row';
      rowBtn.dataset.playbackId = row.playbackId || '';

      const name = document.createElement('span');
      name.className = 'music-track-title';
      name.textContent = row.title;
      rowBtn.appendChild(name);

      if (row.songHref && options.showSongLinks !== false) {
        const link = document.createElement('a');
        link.className = 'album-hub-track-song-link icon-btn';
        link.href = row.songHref;
        link.textContent = 'song';
        link.addEventListener('click', function (event) {
          event.stopPropagation();
        });
        rowBtn.appendChild(link);
      }

      const dur = document.createElement('span');
      dur.className = 'music-track-duration';
      dur.setAttribute('aria-hidden', 'true');
      const knownDuration = row.item && row.item.duration;
      dur.textContent = formatDuration(knownDuration) || '--:--';
      if (!formatDuration(knownDuration) && row.playbackId) {
        attachTrackDuration(dur, row.playbackId, knownDuration);
      }
      rowBtn.appendChild(dur);

      const pf = root.BurnfolderPlaybackPrefetch;
      if (pf && pf.attachRow && row.playbackId) {
        pf.attachRow(rowBtn, function () {
          return row.playbackId;
        });
      }

      if (typeof options.onTrackSelect === 'function') {
        const onSelect = function () {
          options.onTrackSelect(row);
        };
        const rowTap = root.BurnfolderTouchTap || root.BurnfolderStudioTap;
        if (rowTap && rowTap.bind) {
          rowTap.bind(rowBtn, onSelect);
        } else {
          rowBtn.addEventListener('click', onSelect);
        }
      }

      li.appendChild(num);
      li.appendChild(rowBtn);
      ol.appendChild(li);
    });

    listEl.appendChild(ol);
  }

  function renderCompiledLyrics(rootEl, rows) {
    const panel = rootEl.querySelector('[data-album-panel="compiled-lyrics"]');
    const mount = rootEl.querySelector('[data-album-field="compiled-lyrics"]');
    if (!mount) return;

    mount.innerHTML = '';
    const withLyrics = rows.filter(function (row) {
      return !!row.lyrics;
    });

    if (!withLyrics.length) {
      panelHidden(panel);
      return;
    }

    withLyrics.forEach(function (row) {
      const block = document.createElement('article');
      block.className = 'album-hub-compiled-block';

      const head = document.createElement('h3');
      head.className = 'album-hub-compiled-title';
      head.textContent = row.title;
      block.appendChild(head);

      const body = document.createElement('div');
      body.className = 'album-hub-compiled-body song-hub-lyrics';
      body.innerHTML = textToHtml(row.lyrics);
      block.appendChild(body);

      mount.appendChild(block);
    });

    panelVisible(panel);
  }

  function renderCompiledNotes(rootEl, rows) {
    const panel = rootEl.querySelector('[data-album-panel="compiled-notes"]');
    const mount = rootEl.querySelector('[data-album-field="compiled-notes"]');
    if (!mount) return;

    mount.innerHTML = '';
    const trackNotes = rows.filter(function (row) {
      return !!row.notes;
    });

    if (!trackNotes.length) {
      panelHidden(panel);
      return;
    }

    trackNotes.forEach(function (row) {
      const block = document.createElement('article');
      block.className = 'album-hub-compiled-block';

      const head = document.createElement('h3');
      head.className = 'album-hub-compiled-title';
      head.textContent = row.title;
      block.appendChild(head);

      const body = document.createElement('div');
      body.className = 'album-hub-compiled-body song-hub-notes';
      body.innerHTML = textToHtml(row.notes);
      block.appendChild(body);

      mount.appendChild(block);
    });

    panelVisible(panel);
  }

  function renderVisuals(rootEl, albumPage, rows, opts) {
    const panel = rootEl.querySelector('[data-album-panel="visuals"]');
    const grid = rootEl.querySelector('[data-album-field="visuals-grid"]');
    if (!grid) return;

    grid.innerHTML = '';
    const options = opts || {};
    const cards = [];

    const albumMedia = albumPage && Array.isArray(albumPage.media) ? albumPage.media : [];
    albumMedia.forEach(function (item) {
      cards.push({ item: item, caption: 'Album' });
    });

    rows.forEach(function (row) {
      (row.media || []).forEach(function (item) {
        cards.push({ item: item, caption: row.title });
      });
      if (row.page && row.page.heroVideoPlaybackId) {
        cards.push({
          item: {
            kind: 'video',
            title: row.title + ' — video',
            playbackId: row.page.heroVideoPlaybackId
          },
          caption: row.title
        });
      }
      if (row.page && row.page.coverArt) {
        cards.push({
          item: {
            kind: 'image',
            title: row.title + ' — cover',
            imageData: row.page.coverArt
          },
          caption: row.title
        });
      }
    });

    const filtered = cards.filter(function (row) {
      const item = row.item;
      return item && (item.title || item.playbackId || item.href || item.text || item.imageData);
    });

    if (!filtered.length) {
      panelHidden(panel);
      return;
    }

    filtered.forEach(function (row) {
      const wrap = document.createElement('div');
      wrap.className = 'album-hub-visual-card-wrap';
      if (row.caption) {
        const cap = document.createElement('p');
        cap.className = 'album-hub-visual-caption';
        cap.textContent = row.caption;
        wrap.appendChild(cap);
      }
      wrap.appendChild(
        renderMediaCard(row.item, {
          shared: options.shared,
          library: options.library
        })
      );
      grid.appendChild(wrap);
    });

    panelVisible(panel);
  }

  function mountHeroVideo(albumPage, mountEl, library, shared) {
    if (!mountEl) return;
    if (!albumPage || !albumPage.heroVideoPlaybackId) {
      if (shared && shared.clearStreamVideo) shared.clearStreamVideo(mountEl);
      else mountEl.innerHTML = '';
      mountEl.hidden = true;
      return;
    }
    const item =
      (library || []).find(function (row) {
        return row && row.playbackId === albumPage.heroVideoPlaybackId;
      }) ||
      { playbackId: albumPage.heroVideoPlaybackId, kind: 'video', hasVideoTrack: true };
    if (shared && shared.mountStreamVideo) {
      shared.mountStreamVideo(item, mountEl, { autoplay: false });
      mountEl.hidden = false;
      return;
    }
    mountEl.innerHTML = '';
    const player = document.createElement('mux-player');
    player.setAttribute('playback-id', albumPage.heroVideoPlaybackId);
    player.setAttribute('stream-type', 'on-demand');
    player.setAttribute('playsinline', '');
    mountEl.appendChild(player);
    mountEl.hidden = false;
  }

  function apply(rootEl, options) {
    const opts = options || {};
    const albumPage = opts.albumPage;
    const meta = opts.meta || {};
    const shared = opts.shared || root.BurnfolderStreamShared;
    const library = opts.library || [];
    const tracks = Array.isArray(opts.tracks) ? opts.tracks : [];

    if (!rootEl) return;

    const rows = compileTrackRows({
      tracks: tracks,
      songPages: opts.songPages || {},
      songCatalog: opts.songCatalog || [],
      versionsApi: opts.versionsApi,
      itemLabel: opts.itemLabel,
      songPageUrl: opts.songPageUrl
    });

    const titleEl = rootEl.querySelector('[data-album-field="title"]');
    const subtitleEl = rootEl.querySelector('[data-album-field="subtitle"]');
    const coverEl = rootEl.querySelector('[data-album-field="cover"]');
    const videoHero = rootEl.querySelector('[data-album-field="video-hero"]');
    const thoughtsPanel = rootEl.querySelector('[data-album-panel="thoughts"]');
    const thoughtsBody = rootEl.querySelector('[data-album-field="thoughts"]');

    const albumTitle = meta.title || 'Album';
    if (titleEl) titleEl.textContent = albumTitle;
    if (subtitleEl) {
      rootEl._albumHubRows = rows;
      bindAlbumSubtitleDurationSync(rootEl);
      refreshAlbumSubtitle(subtitleEl, rows);
      const pf = root.BurnfolderPlaybackPrefetch;
      if (pf && pf.prefetchList) {
        pf.prefetchList(
          rows
            .map(function (row) {
              return row.playbackId;
            })
            .filter(Boolean),
          rows.length
        );
      }
    }

    if (meta.coverArt && coverEl) {
      const coverApi = root.BurnfolderCoverArt;
      const showCover = function (src) {
        if (!src) {
          panelHidden(coverEl.closest('[data-album-panel="cover"]') || coverEl);
          return;
        }
        coverEl.src = src;
        coverEl.alt = albumTitle + ' cover';
        panelVisible(coverEl.closest('[data-album-panel="cover"]') || coverEl);
      };
      if (coverApi && coverApi.resolveCoverPreviewUrl) {
        coverApi.resolveCoverPreviewUrl(meta).then(showCover);
      } else {
        showCover(meta.coverArt);
      }
    } else if (coverEl) {
      panelHidden(coverEl.closest('[data-album-panel="cover"]'));
    }

    if (videoHero) {
      if (albumPage && albumPage.heroVideoPlaybackId) {
        mountHeroVideo(albumPage, videoHero, library, shared);
        panelVisible(videoHero.closest('[data-album-panel="video"]') || videoHero);
      } else {
        if (shared && shared.clearStreamVideo) shared.clearStreamVideo(videoHero);
        panelHidden(videoHero.closest('[data-album-panel="video"]'));
      }
    }

    renderTracklist(rootEl, rows, {
      onTrackSelect: opts.onTrackSelect,
      showSongLinks: opts.showSongLinks,
      songPageUrl: opts.songPageUrl
    });

    renderCompiledLyrics(rootEl, rows);
    renderCompiledNotes(rootEl, rows);
    renderVisuals(rootEl, albumPage, rows, { shared: shared, library: library });

    const albumOnlyNotes = pageNotes(albumPage);
    if (albumOnlyNotes && thoughtsBody && thoughtsPanel) {
      thoughtsBody.innerHTML = textToHtml(albumOnlyNotes);
      panelVisible(thoughtsPanel);
    } else if (thoughtsPanel) {
      panelHidden(thoughtsPanel);
    }

    if (typeof opts.onRendered === 'function') {
      opts.onRendered(rows);
    }

    return rows;
  }

  root.BurnfolderAlbumPageRender = {
    apply: apply,
    compileTrackRows: compileTrackRows,
    textToHtml: textToHtml,
    pageNotes: pageNotes,
    renderMediaCard: renderMediaCard
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
