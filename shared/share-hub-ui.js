/**
 * Collapsible share panel for song hub / album hub (studio).
 */
(function (root) {
  'use strict';

  const api = root.BurnfolderShareLinks;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatPlays(count) {
    const n = typeof count === 'number' ? count : 0;
    return n + ' play' + (n === 1 ? '' : 's');
  }

  function scopeLabel(scope) {
    if (scope === 'version') return 'one version';
    if (scope === 'album') return 'album';
    return 'all versions';
  }

  function buildCreateOptions(opts) {
    const options = opts || {};
    const versions = typeof options.getVersions === 'function' ? options.getVersions() : [];
    const tracks = typeof options.getAlbumTracks === 'function' ? options.getAlbumTracks() : [];
    const rows = [];

    if (options.context === 'album' && tracks.length) {
      rows.push({ scope: 'album', label: 'Full album (' + tracks.length + ' tracks)', tracks: tracks });
      return rows;
    }

    if (versions.length) {
      rows.push({
        scope: 'song',
        label: 'All versions (' + versions.length + ')',
        tracks: versions.map(function (song) {
          return { title: song.title, playbackId: song.playbackId };
        })
      });
      versions.forEach(function (song) {
        const label =
          root.BurnfolderSongVersions && root.BurnfolderSongVersions.displayTitleForSong
            ? root.BurnfolderSongVersions.displayTitleForSong(song)
            : song.title;
        rows.push({
          scope: 'version',
          label: label,
          playbackId: song.playbackId,
          tracks: [{ title: song.title, playbackId: song.playbackId }]
        });
      });
    }

    return rows;
  }

  function mount(container, opts) {
    if (!container || !api) return { refresh: function () {}, destroy: function () {} };

    const options = opts || {};
    const embedded = !!options.embedded;
    let open = embedded;
    let shares = [];
    let busy = false;

    container.innerHTML = '';
    container.className = 'hub-share-panel' + (embedded ? ' hub-share-panel--embedded' : '');

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'hub-share-toggle';
    toggleBtn.setAttribute('aria-expanded', embedded ? 'true' : 'false');
    if (embedded) toggleBtn.hidden = true;

    const body = document.createElement('div');
    body.className = 'hub-share-body';
    body.hidden = !embedded;

    const createRow = document.createElement('div');
    createRow.className = 'hub-share-create';

    const createSelect = document.createElement('select');
    createSelect.className = 'hub-share-select';
    createSelect.setAttribute('aria-label', 'What to share');

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'icon-btn hub-share-create-btn';
    createBtn.textContent = 'create link';

    const listEl = document.createElement('div');
    listEl.className = 'hub-share-list';

    const statusEl = document.createElement('p');
    statusEl.className = 'hub-share-status';
    statusEl.setAttribute('aria-live', 'polite');

    createRow.appendChild(createSelect);
    createRow.appendChild(createBtn);
    body.appendChild(createRow);
    body.appendChild(listEl);
    body.appendChild(statusEl);
    container.appendChild(toggleBtn);
    container.appendChild(body);

    function setStatus(msg, kind) {
      statusEl.textContent = msg || '';
      statusEl.classList.toggle('is-error', kind === 'error');
      statusEl.classList.toggle('is-success', kind === 'success');
    }

    function paintToggle() {
      const count = shares.length;
      toggleBtn.textContent = count ? 'share · ' + count + ' link' + (count === 1 ? '' : 's') : 'share';
    }

    function paintCreateOptions() {
      const rows = buildCreateOptions(options);
      createSelect.innerHTML = '';
      rows.forEach(function (row, idx) {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = row.label;
        createSelect.appendChild(opt);
      });
      createRow.hidden = !rows.length;
    }

    function paintList() {
      listEl.innerHTML = '';
      if (!shares.length) {
        const empty = document.createElement('p');
        empty.className = 'hub-share-empty';
        empty.textContent = 'No links yet — create one to send a private listen page.';
        listEl.appendChild(empty);
        return;
      }

      shares.forEach(function (share) {
        const row = document.createElement('article');
        row.className = 'hub-share-item';

        const meta = document.createElement('div');
        meta.className = 'hub-share-item-meta';

        const title = document.createElement('p');
        title.className = 'hub-share-item-title';
        title.textContent = scopeLabel(share.scope);
        if (share.subtitle) title.textContent += ' · ' + share.subtitle;

        const stats = document.createElement('p');
        stats.className = 'hub-share-item-stats';
        stats.textContent = formatPlays(share.playCount);

        meta.appendChild(title);
        meta.appendChild(stats);

        const actions = document.createElement('div');
        actions.className = 'hub-share-item-actions';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'icon-btn';
        copyBtn.textContent = 'copy';
        copyBtn.addEventListener('click', function () {
          const url = api.listenPageUrl(share.token) || share.url;
          api
            .copyText(url)
            .then(function () {
              setStatus('copied', 'success');
            })
            .catch(function () {
              setStatus('could not copy', 'error');
            });
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'icon-btn hub-share-revoke-btn';
        deleteBtn.textContent = 'delete';
        deleteBtn.addEventListener('click', function () {
          if (!window.confirm('Delete this link? Anyone with it will lose access.')) return;
          busy = true;
          api
            .revokeShare(share.token)
            .then(function () {
              setStatus('link deleted', 'success');
              return refresh();
            })
            .catch(function (err) {
              setStatus(err.message || 'delete failed', 'error');
            })
            .finally(function () {
              busy = false;
            });
        });

        actions.appendChild(copyBtn);
        actions.appendChild(deleteBtn);
        row.appendChild(meta);
        row.appendChild(actions);
        listEl.appendChild(row);
      });
    }

    function refresh() {
      const filters = {};
      if (options.groupKey) filters.groupKey = options.groupKey;
      if (options.albumId) filters.albumId = options.albumId;
      return api
        .listShares(filters)
        .then(function (rows) {
          shares = rows;
          paintToggle();
          paintCreateOptions();
          paintList();
        })
        .catch(function (err) {
          setStatus(err.message || 'could not load links', 'error');
        });
    }

    toggleBtn.addEventListener('click', function () {
      open = !open;
      body.hidden = !open;
      toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) refresh();
    });

    createBtn.addEventListener('click', function () {
      if (busy) return;
      const rows = buildCreateOptions(options);
      const idx = parseInt(createSelect.value, 10);
      const pick = rows[idx];
      if (!pick || !pick.tracks || !pick.tracks.length) return;

      busy = true;
      createBtn.disabled = true;
      setStatus('creating…');

      const title =
        typeof options.getTitle === 'function' ? options.getTitle() : pick.tracks[0].title;
      const payload = {
        scope: pick.scope,
        groupKey: options.groupKey || '',
        albumId: options.albumId || '',
        playbackId: pick.playbackId || '',
        title: title,
        subtitle: pick.scope === 'version' ? pick.label : '',
        coverArt: typeof options.getCoverArt === 'function' ? options.getCoverArt() : '',
        tracks: pick.tracks
      };

      api
        .createShare(payload)
        .then(function (data) {
          const url =
            api.listenPageUrl(data.share.token) ||
            (data.share && data.share.url) ||
            '';
          return api.copyText(url).then(function () {
            setStatus('link created and copied', 'success');
            open = true;
            body.hidden = false;
            toggleBtn.setAttribute('aria-expanded', 'true');
            return refresh();
          });
        })
        .catch(function (err) {
          setStatus(err.message || 'create failed', 'error');
        })
        .finally(function () {
          busy = false;
          createBtn.disabled = false;
        });
    });

    paintToggle();
    paintCreateOptions();
    paintList();
    if (embedded) refresh();

    return {
      refresh: refresh,
      destroy: function () {
        container.innerHTML = '';
      }
    };
  }

  root.BurnfolderShareHubUI = { mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : window);
