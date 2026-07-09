(function (root) {
  'use strict';

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

  function findLibraryItem(library, playbackId) {
    if (!playbackId || !Array.isArray(library)) return null;
    return (
      library.find(function (item) {
        return item && item.playbackId === playbackId;
      }) || null
    );
  }

  function pageNotes(page) {
    if (!page) return '';
    if (typeof page.notes === 'string' && page.notes.trim()) return page.notes.trim();
    if (typeof page.backstory === 'string' && page.backstory.trim()) return page.backstory.trim();
    return '';
  }

  function versionLyrics(page, playbackId) {
    if (!page || !playbackId) return '';
    const versions = page.versions && typeof page.versions === 'object' ? page.versions : {};
    const entry = versions[playbackId] || {};
    return String(entry.lyrics || '').trim();
  }

  function versionNotes(page, playbackId) {
    if (!page || !playbackId) return '';
    const versions = page.versions && typeof page.versions === 'object' ? page.versions : {};
    const entry = versions[playbackId] || {};
    return String(entry.notes || '').trim();
  }

  function versionHasLyrics(page, playbackId) {
    return !!versionLyrics(page, playbackId);
  }

  function versionHasContent(page, playbackId) {
    return !!(versionLyrics(page, playbackId) || versionNotes(page, playbackId));
  }

  function defaultVersionId(page, catalogVersions) {
    const list = Array.isArray(catalogVersions) ? catalogVersions : [];
    for (let i = 0; i < list.length; i += 1) {
      const song = list[i];
      if (song && song.playbackId && versionHasContent(page, song.playbackId)) {
        return song.playbackId;
      }
    }
    return list[0] && list[0].playbackId ? list[0].playbackId : '';
  }

  function versionLabel(song, versionsApi) {
    if (!song) return 'Version';
    if (versionsApi && versionsApi.displayTitleForSong) {
      return versionsApi.displayTitleForSong(song);
    }
    return String(song.title || song.displayTitle || 'Version').trim();
  }

  function mountHeroVideo(page, mountEl, library, shared) {
    if (!mountEl || !page || !page.heroVideoPlaybackId) {
      if (mountEl) {
        if (shared && shared.clearStreamVideo) shared.clearStreamVideo(mountEl);
        else mountEl.innerHTML = '';
        mountEl.hidden = true;
      }
      return;
    }
    const item =
      findLibraryItem(library, page.heroVideoPlaybackId) ||
      { playbackId: page.heroVideoPlaybackId, kind: 'video', hasVideoTrack: true };
    if (shared && shared.mountStreamVideo) {
      if (shared.canPlayAsVideo && !shared.canPlayAsVideo(item)) {
        mountEl.hidden = true;
        return;
      }
      shared.mountStreamVideo(item, mountEl, { autoplay: false });
      mountEl.hidden = false;
      return;
    }
    mountEl.innerHTML = '';
    const player = document.createElement('mux-player');
    player.setAttribute('playback-id', page.heroVideoPlaybackId);
    player.setAttribute('stream-type', 'on-demand');
    player.setAttribute('playsinline', '');
    mountEl.appendChild(player);
    mountEl.hidden = false;
  }

  function renderMediaCard(item, opts) {
    const options = opts || {};
    const card = document.createElement('article');
    card.className = 'song-hub-content-card';

    const title = document.createElement('h3');
    title.textContent = item.title || 'Untitled';
    card.appendChild(title);

    if (item.kind === 'video' && item.playbackId) {
      const wrap = document.createElement('div');
      wrap.className = 'song-hub-media-video';
      if (options.shared && options.shared.createMuxVideoPlayer) {
        const playerItem = findLibraryItem(options.library, item.playbackId) || {
          playbackId: item.playbackId,
          kind: 'video',
          hasVideoTrack: true
        };
        const player = options.shared.createMuxVideoPlayer(playerItem);
        wrap.appendChild(player);
      } else {
        const player = document.createElement('mux-player');
        player.setAttribute('playback-id', item.playbackId);
        player.setAttribute('stream-type', 'on-demand');
        player.setAttribute('playsinline', '');
        wrap.appendChild(player);
      }
      card.appendChild(wrap);
    } else if (item.kind === 'image' && item.imageData) {
      const img = document.createElement('img');
      img.className = 'song-hub-media-image';
      img.src = item.imageData;
      img.alt = item.title || 'Image';
      card.appendChild(img);
    } else if (item.kind === 'link' && item.href) {
      const link = document.createElement('a');
      link.className = 'song-hub-media-link';
      link.href = item.href;
      link.textContent = item.title || item.href;
      card.appendChild(link);
    } else if (item.text) {
      const body = document.createElement('p');
      body.innerHTML = textToHtml(item.text);
      card.appendChild(body);
    } else if (item.playbackId) {
      const meta = document.createElement('p');
      meta.textContent = 'Playback: ' + item.playbackId.slice(0, 12) + '…';
      card.appendChild(meta);
    }

    return card;
  }

  // Render the lyrics + version-notes for the selected version. Both follow the version
  // chosen/played above. On the public site empty panels are hidden entirely; in the studio
  // editor preview (showVersionPicker) we show a placeholder so the author sees the slot.
  function renderVersionLyrics(rootEl, page, playbackId, opts) {
    const options = opts || {};
    const editing = !!options.showVersionPicker;

    const lyricsPanel = rootEl.querySelector('[data-song-panel="lyrics"]');
    const lyricsBody = rootEl.querySelector('[data-song-field="version-lyrics"]');
    const vNotesPanel = rootEl.querySelector('[data-song-panel="version-notes"]');
    const vNotesBody = rootEl.querySelector('[data-song-field="version-notes"]');

    const lyrics = versionLyrics(page, playbackId);
    const notes = versionNotes(page, playbackId);

    if (lyrics && lyricsBody) {
      lyricsBody.innerHTML = textToHtml(lyrics);
      panelVisible(lyricsPanel);
    } else if (editing && lyricsBody) {
      lyricsBody.innerHTML = '<p class="song-hub-lyrics-empty">No lyrics for this version.</p>';
      panelVisible(lyricsPanel);
    } else {
      if (lyricsBody) lyricsBody.innerHTML = '';
      panelHidden(lyricsPanel);
    }

    if (notes && vNotesBody) {
      vNotesBody.innerHTML = textToHtml(notes);
      panelVisible(vNotesPanel);
    } else if (editing && vNotesBody) {
      vNotesBody.innerHTML = '<p class="song-hub-lyrics-empty">No notes for this version.</p>';
      panelVisible(vNotesPanel);
    } else {
      if (vNotesBody) vNotesBody.innerHTML = '';
      panelHidden(vNotesPanel);
    }

    rootEl.dataset.songVersionSelected = playbackId || '';

    const picker = rootEl.querySelector('[data-song-field="version-picker"]');
    if (picker) {
      picker.querySelectorAll('.song-hub-version-chip').forEach(function (chip) {
        const active = chip.dataset.playbackId === playbackId;
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    if (options.userInitiated && typeof options.onVersionSelect === 'function') {
      options.onVersionSelect(playbackId);
    }
  }

  function buildVersionPicker(rootEl, page, catalogVersions, opts) {
    const picker = rootEl.querySelector('[data-song-field="version-picker"]');
    const lyricsPanel = rootEl.querySelector('[data-song-panel="lyrics"]');
    if (!picker) return defaultVersionId(page, catalogVersions);

    const versionsApi = root.BurnfolderSongVersions;
    const list = Array.isArray(catalogVersions) ? catalogVersions.filter(function (s) {
      return s && s.playbackId;
    }) : [];

    picker.innerHTML = '';
    if (!list.length) {
      panelHidden(lyricsPanel);
      return '';
    }

    const selected =
      rootEl.dataset.songVersionSelected ||
      defaultVersionId(page, list) ||
      list[0].playbackId;

    list.forEach(function (song) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'song-hub-version-chip';
      chip.dataset.playbackId = song.playbackId;
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', song.playbackId === selected ? 'true' : 'false');

      const label = document.createElement('span');
      label.className = 'song-hub-version-chip-label';
      label.textContent = versionLabel(song, versionsApi);
      chip.appendChild(label);

      if (versionHasLyrics(page, song.playbackId)) {
        const dot = document.createElement('span');
        dot.className = 'song-hub-version-chip-dot';
        dot.setAttribute('aria-hidden', 'true');
        chip.appendChild(dot);
      }

      chip.addEventListener('click', function () {
        renderVersionLyrics(
          rootEl,
          page,
          song.playbackId,
          Object.assign({}, opts, { userInitiated: true })
        );
      });

      picker.appendChild(chip);
    });

    return selected;
  }

  function apply(rootEl, options) {
    const opts = options || {};
    const page = opts.page;
    const shared = opts.shared || root.BurnfolderStreamShared;
    const library = opts.library || [];
    const catalogVersions = opts.catalogVersions || [];

    if (!rootEl) return;

    rootEl.dataset.songHasVersions = catalogVersions.length > 0 ? 'true' : 'false';

    const coverEl = rootEl.querySelector('[data-song-field="cover"]');
    const videoHero = rootEl.querySelector('[data-song-field="video-hero"]');
    const clipsPanel =
      rootEl.querySelector('[data-song-panel="clips"]') ||
      rootEl.querySelector('[data-song-panel="related"]');
    const clipsGrid =
      rootEl.querySelector('[data-song-field="clips-grid"]') ||
      rootEl.querySelector('[data-song-field="related-grid"]');
    const notesPanel = rootEl.querySelector('[data-song-panel="notes"]');
    const notesBody = rootEl.querySelector('[data-song-field="notes"]');
    const lyricsPanel = rootEl.querySelector('[data-song-panel="lyrics"]');

    [rootEl.querySelector('[data-song-panel="backstory"]')].forEach(panelHidden);
    [rootEl.querySelector('[data-song-panel="version-detail"]')].forEach(panelHidden);
    [rootEl.querySelector('[data-song-panel="version-notes"]')].forEach(panelHidden);

    if (!page) {
      [clipsPanel, videoHero, coverEl, notesPanel].forEach(panelHidden);
      if (clipsGrid) clipsGrid.innerHTML = '';
      rootEl.dataset.songHasVersions = catalogVersions.length > 0 ? 'true' : 'false';
      if (catalogVersions.length) {
        const selectedId = buildVersionPicker(rootEl, null, catalogVersions, opts);
        if (selectedId) {
          renderVersionLyrics(rootEl, null, selectedId, opts);
        } else {
          panelHidden(lyricsPanel);
        }
      } else {
        panelHidden(lyricsPanel);
        const picker = rootEl.querySelector('[data-song-field="version-picker"]');
        if (picker) picker.innerHTML = '';
      }
      return;
    }

    if (page.coverArt && coverEl) {
      const coverApi = root.BurnfolderCoverArt;
      const showCover = function (src) {
        if (!src) {
          panelHidden(coverEl.closest('[data-song-panel="cover"]') || coverEl);
          return;
        }
        coverEl.src = src;
        coverEl.alt = opts.baseTitle ? opts.baseTitle + ' cover' : 'Cover art';
        panelVisible(coverEl.closest('[data-song-panel="cover"]') || coverEl);
      };
      if (coverApi && coverApi.resolveCoverPreviewUrl) {
        coverApi.resolveCoverPreviewUrl(page).then(showCover);
      } else {
        showCover(page.coverArt);
      }
    } else if (coverEl) {
      panelHidden(coverEl.closest('[data-song-panel="cover"]'));
    }

    if (videoHero) {
      if (page.heroVideoPlaybackId) {
        mountHeroVideo(page, videoHero, library, shared);
        panelVisible(videoHero.closest('[data-song-panel="video"]') || videoHero);
      } else {
        if (shared && shared.clearStreamVideo) shared.clearStreamVideo(videoHero);
        else videoHero.innerHTML = '';
        panelHidden(videoHero.closest('[data-song-panel="video"]'));
      }
    }

    const media = Array.isArray(page.media)
      ? page.media.filter(function (item) {
          return item && (item.title || item.playbackId || item.href || item.text || item.imageData);
        })
      : [];

    if (clipsGrid) clipsGrid.innerHTML = '';
    if (media.length && clipsGrid) {
      media.forEach(function (item) {
        clipsGrid.appendChild(
          renderMediaCard(item, {
            shared: shared,
            library: library
          })
        );
      });
      panelVisible(clipsPanel);
    } else {
      panelHidden(clipsPanel);
    }

    const notes = pageNotes(page);
    if (notes && notesBody) {
      notesBody.innerHTML = textToHtml(notes);
      panelVisible(notesPanel);
    } else {
      panelHidden(notesPanel);
    }

    const selectedId = buildVersionPicker(rootEl, page, catalogVersions, opts);
    if (selectedId) {
      renderVersionLyrics(rootEl, page, selectedId, opts);
    } else if (!catalogVersions.length) {
      panelHidden(lyricsPanel);
    }
  }

  root.BurnfolderSongPageRender = {
    apply: apply,
    textToHtml: textToHtml,
    pageNotes: pageNotes,
    renderMediaCard: renderMediaCard,
    versionLyrics: versionLyrics,
    versionNotes: versionNotes,
    versionContent: function (page, playbackId) {
      return { lyrics: versionLyrics(page, playbackId), notes: versionNotes(page, playbackId) };
    },
    selectVersion: function (rootEl, page, playbackId, options) {
      if (!rootEl || !page || !playbackId) return;
      renderVersionLyrics(rootEl, page, playbackId, options || {});
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
