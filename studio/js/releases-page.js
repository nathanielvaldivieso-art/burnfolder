(function () {
  'use strict';

  const statusEl = document.getElementById('releasesStatus');
  const tracksRoot = document.getElementById('releaseTracks');
  const checklistRoot = document.getElementById('releaseChecklist');
  const catalogRoot = document.getElementById('releaseCatalogList');
  const groupSelect = document.getElementById('releaseGroupSelect');

  let draftTracks = [];
  let artworkVaultKey = null;
  let artworkFileName = '';
  let prefs = null;
  let catalog = { releases: [] };
  let registry = { tracks: [] };
  let activeProviderReleaseId = null;
  let isOwner = true;
  let apiConfigured = false;

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.remove('studio-status--error', 'studio-status--success', 'studio-status--working');
    if (kind === 'error') statusEl.classList.add('studio-status--error');
    if (kind === 'success') statusEl.classList.add('studio-status--success');
    if (kind === 'working') statusEl.classList.add('studio-status--working');
  }

  function getApiBase() {
    const cfg = window.BurnfolderStudioConfig || {};
    if (cfg.muxApiBase) return String(cfg.muxApiBase).replace(/\/$/, '');
    const host = location.hostname;
    const isLocalDevServer =
      (host === 'localhost' || host === '127.0.0.1') && location.port && location.port !== '8888';
    if (isLocalDevServer) return 'http://localhost:8888/.netlify/functions';
    return '/.netlify/functions';
  }

  function authHeaders() {
    const auth = window.BurnfolderStudioAuth;
    return auth && auth.getAuthHeaders ? auth.getAuthHeaders() : {};
  }

  function whenReady() {
    if (window.BurnfolderStudioAuth && window.BurnfolderStudioAuth.whenReady) {
      return window.BurnfolderStudioAuth.whenReady();
    }
    return Promise.resolve();
  }

  function cloud() {
    return window.BurnfolderCloudState;
  }

  function shared() {
    return window.BurnfolderStreamShared;
  }

  function displayName(item) {
    if (!item) return 'untitled';
    if (item.title) return item.title;
    if (item.name) return item.name;
    if (item.displayName) return item.displayName;
    if (item.passthrough) return item.passthrough;
    return 'untitled';
  }

  function loadPrefsAndCatalog() {
    const cs = cloud();
    if (!cs || !cs.get) {
      return Promise.resolve();
    }
    return Promise.all([
      cs.get('distroPreferences').catch(function () { return null; }),
      cs.get('releaseCatalog').catch(function () { return null; }),
      cs.get('trackRegistry').catch(function () { return null; })
    ]).then(function (rows) {
      prefs = rows[0] && typeof rows[0] === 'object' ? rows[0] : {};
      catalog = rows[1] && Array.isArray(rows[1].releases) ? rows[1] : { releases: [] };
      registry = rows[2] && Array.isArray(rows[2].tracks) ? rows[2] : { tracks: [] };
      fillPrefsForm();
      renderCatalog();
    });
  }

  function fillPrefsForm() {
    const p = prefs || {};
    setVal('prefLabelId', p.labelId || '');
    setVal('prefArtistId', p.artistId || '');
    setVal('prefWriterId', p.writerId || '');
    setVal('prefGenreId', p.primaryGenreId || '');
    setVal('prefRightsName', p.rightsName || '');
    if (!document.getElementById('releaseRightsName').value) {
      setVal('releaseRightsName', p.rightsName || '');
    }
  }

  function setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value == null ? '' : value;
  }

  function getVal(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function registryForPlayback(playbackId) {
    const tracks = registry.tracks || [];
    return tracks.find(function (t) {
      return t && t.muxPlaybackId === playbackId;
    }) || null;
  }

  function fillGroups() {
    const groups = shared() && shared().loadGroups ? shared().loadGroups() : [];
    groupSelect.innerHTML = '';
    if (!groups.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'no music projects yet';
      groupSelect.appendChild(opt);
      return;
    }
    groups.forEach(function (group) {
      const opt = document.createElement('option');
      opt.value = group.id;
      const title = (group.meta && group.meta.title) || 'untitled project';
      opt.textContent = title + ' (' + (group.tracks || []).length + ')';
      groupSelect.appendChild(opt);
    });
    hydrateFromGroup();
  }

  function hydrateFromGroup() {
    const groups = shared() && shared().loadGroups ? shared().loadGroups() : [];
    const group = groups.find(function (g) {
      return g.id === groupSelect.value;
    });
    draftTracks = [];
    artworkVaultKey = null;
    artworkFileName = '';
    document.getElementById('artworkHint').textContent = '';
    document.getElementById('releaseArtworkFile').value = '';
    document.getElementById('releaseArtworkSizeOk').checked = false;

    if (!group) {
      renderTracks();
      refreshChecklist();
      return;
    }

    const meta = group.meta || {};
    setVal('releaseTitle', meta.title || '');
    (group.tracks || []).forEach(function (track, index) {
      const playbackId = track.playbackId || track.id || '';
      const reg = registryForPlayback(playbackId);
      draftTracks.push({
        id: reg && reg.id ? reg.id : 'tr_' + (playbackId || index),
        title: displayName(track),
        muxPlaybackId: playbackId || null,
        vaultKey: reg && reg.vaultKey ? reg.vaultKey : null,
        fileName: reg && reg.fileName ? reg.fileName : '',
        isrc: reg && reg.isrc ? reg.isrc : '',
        isrcLocked: !!(reg && reg.isrcLocked)
      });
    });
    renderTracks();
    refreshChecklist();
  }

  function renderTracks() {
    tracksRoot.innerHTML = '';
    if (!draftTracks.length) {
      tracksRoot.innerHTML = '<p class="studio-releases-hint">pick a music project to load tracks</p>';
      return;
    }
    draftTracks.forEach(function (track, index) {
      const row = document.createElement('div');
      row.className = 'studio-releases-track';
      row.dataset.index = String(index);

      const title = document.createElement('input');
      title.type = 'text';
      title.className = 'studio-releases-track-title';
      title.value = track.title || '';
      title.addEventListener('input', function () {
        draftTracks[index].title = title.value;
        refreshChecklist();
      });

      const isrc = document.createElement('input');
      isrc.type = 'text';
      isrc.className = 'studio-releases-track-isrc';
      isrc.placeholder = 'ISRC (blank until LabelGrid)';
      isrc.value = track.isrc || '';
      isrc.disabled = !!track.isrcLocked;
      isrc.addEventListener('change', function () {
        if (draftTracks[index].isrcLocked) return;
        draftTracks[index].isrc = isrc.value.trim();
        persistRegistryTrack(draftTracks[index]);
        refreshChecklist();
      });

      const masterMeta = document.createElement('p');
      masterMeta.className = 'studio-releases-hint';
      masterMeta.textContent = track.vaultKey
        ? 'master: ' + (track.fileName || track.vaultKey)
        : 'no master in vault';

      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'audio/wav,audio/flac,audio/aiff,audio/x-aiff,.wav,.flac,.aif,.aiff';
      file.addEventListener('change', function () {
        const f = file.files && file.files[0];
        if (!f) return;
        setStatus('uploading master…', 'working');
        window.BurnfolderVaultUpload.uploadFile(f, {
          kind: 'master',
          trackKey: track.id || 'temp_' + index
        })
          .then(function (result) {
            draftTracks[index].vaultKey = result.vaultKey;
            draftTracks[index].fileName = result.fileName;
            persistRegistryTrack(draftTracks[index]);
            renderTracks();
            refreshChecklist();
            setStatus('master uploaded', 'success');
          })
          .catch(function (err) {
            setStatus(err.message || 'master upload failed', 'error');
          });
      });

      row.appendChild(title);
      row.appendChild(isrc);
      row.appendChild(masterMeta);
      row.appendChild(file);
      tracksRoot.appendChild(row);
    });
  }

  function persistRegistryTrack(track) {
    const cs = cloud();
    if (!cs || !cs.put) return;
    const tracks = Array.isArray(registry.tracks) ? registry.tracks.slice() : [];
    const idx = tracks.findIndex(function (t) {
      return t && t.id === track.id;
    });
    const row = {
      id: track.id,
      title: track.title,
      vaultKey: track.vaultKey || null,
      fileName: track.fileName || '',
      muxPlaybackId: track.muxPlaybackId || null,
      providerTrackId: track.providerTrackId || null,
      isrc: track.isrc || null,
      isrcLocked: !!track.isrcLocked,
      status: track.status || 'metadata_ready'
    };
    if (track.isrcLocked && tracks[idx] && tracks[idx].isrc) {
      row.isrc = tracks[idx].isrc;
      row.isrcLocked = true;
    }
    if (idx > -1) tracks[idx] = Object.assign({}, tracks[idx], row);
    else tracks.push(row);
    registry = { tracks: tracks };
    cs.put('trackRegistry', registry);
  }

  function currentDraft() {
    return {
      id: 'rel_' + Date.now().toString(36),
      groupId: groupSelect.value || null,
      title: getVal('releaseTitle'),
      contentType: getVal('releaseContentType') || null,
      releaseDate: getVal('releaseDate')
        ? getVal('releaseDate') + 'T00:00:00'
        : null,
      explicit: getVal('releaseExplicit') || 'off',
      rightsName: getVal('releaseRightsName') || getVal('prefRightsName'),
      artworkVaultKey: artworkVaultKey,
      artworkFileName: artworkFileName,
      artworkSizeOk: document.getElementById('releaseArtworkSizeOk').checked,
      tracks: draftTracks.map(function (t) {
        return {
          id: t.id,
          title: t.title,
          vaultKey: t.vaultKey,
          fileName: t.fileName,
          isrc: t.isrcLocked ? t.isrc : t.isrc || null,
          muxPlaybackId: t.muxPlaybackId
        };
      })
    };
  }

  function refreshChecklist() {
    const result = window.BurnfolderReleaseChecklist.evaluate(currentDraft(), {
      rightsName: getVal('prefRightsName') || getVal('releaseRightsName')
    });
    window.BurnfolderReleaseChecklist.renderList(checklistRoot, result);
    const createBtn = document.getElementById('releaseCreateBtn');
    const submitBtn = document.getElementById('releaseSubmitBtn');
    const markReadyBtn = document.getElementById('releaseMarkReadyBtn');
    if (createBtn) createBtn.disabled = !result.ok;
    if (submitBtn) {
      submitBtn.disabled = !isOwner || !activeProviderReleaseId;
    }
    if (markReadyBtn) markReadyBtn.disabled = !isOwner || !result.ok;
  }

  function applyDistroMode() {
    const manualPanel = document.getElementById('distroManualPanel');
    const prefsForm = document.getElementById('distroPrefsForm');
    const apiActions = document.getElementById('releaseApiActions');
    const manualActions = document.getElementById('releaseManualActions');
    const lede = document.getElementById('releasesLede');

    if (manualPanel) manualPanel.hidden = apiConfigured;
    if (prefsForm) prefsForm.hidden = !apiConfigured || !isOwner;
    if (apiActions) apiActions.hidden = !apiConfigured;
    if (manualActions) manualActions.hidden = apiConfigured;

    if (lede) {
      lede.textContent = apiConfigured
        ? 'Build a LabelGrid draft from a music project, attach vault masters + cover, then submit (owner only).'
        : 'Prepare masters + checklist here, then submit in LabelGrid (Solo / dashboard).';
    }

    const hint = document.getElementById('releaseOwnerHint');
    if (hint) {
      if (!isOwner) {
        hint.textContent =
          'Collaborator: you can prepare masters + checklist; only the owner marks ready / submitted.';
      } else if (apiConfigured) {
        hint.textContent = 'You can submit to LabelGrid via API.';
      } else {
        hint.textContent =
          'Checklist green → mark ready → finish distribute in LabelGrid → mark submitted here.';
      }
    }
  }

  function upsertLocalCatalog(releaseRecord) {
    const next = [releaseRecord].concat(
      (catalog.releases || []).filter(function (row) {
        return row && row.id !== releaseRecord.id;
      })
    );
    catalog = { releases: next };
    const cs = cloud();
    if (cs && cs.put) cs.put('releaseCatalog', catalog);
    renderCatalog();
  }

  function markReadyManual() {
    if (!isOwner) {
      setStatus('owner role required to mark ready', 'error');
      return;
    }
    const draft = currentDraft();
    const check = window.BurnfolderReleaseChecklist.evaluate(draft, {
      rightsName: getVal('prefRightsName') || getVal('releaseRightsName')
    });
    if (!check.ok) {
      setStatus('checklist still has gaps', 'error');
      return;
    }
    const releaseRecord = {
      id: draft.id,
      title: draft.title,
      groupId: draft.groupId,
      contentType: draft.contentType,
      status: 'checklist_passed',
      provider: 'labelgrid',
      submitMode: 'manual',
      providerReleaseId: null,
      upc: null,
      artworkVaultKey: draft.artworkVaultKey || null,
      releaseDate: draft.releaseDate || null,
      tracks: draft.tracks,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    upsertLocalCatalog(releaseRecord);
    setStatus('ready — open LabelGrid and create/distribute this release', 'success');
  }

  function markSubmittedManual(releaseId) {
    if (!isOwner) {
      setStatus('owner role required', 'error');
      return;
    }
    const releases = (catalog.releases || []).slice();
    const idx = releases.findIndex(function (row) {
      return row && row.id === releaseId;
    });
    if (idx < 0) return;
    releases[idx] = Object.assign({}, releases[idx], {
      status: 'distro_submitted',
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      submitMode: 'manual'
    });
    catalog = { releases: releases };
    const cs = cloud();
    if (cs && cs.put) cs.put('releaseCatalog', catalog);
    renderCatalog();
    setStatus('marked submitted — DSP review is usually 3–14 days', 'success');
  }

  function renderCatalog() {
    catalogRoot.innerHTML = '';
    const releases = catalog.releases || [];
    if (!releases.length) {
      catalogRoot.innerHTML = '<li class="studio-releases-hint">no releases in catalog yet</li>';
      return;
    }
    releases.forEach(function (rel) {
      const li = document.createElement('li');
      li.className = 'studio-releases-catalog-item';
      const title = document.createElement('strong');
      title.textContent = rel.title || 'untitled';
      const meta = document.createElement('span');
      meta.className = 'studio-releases-hint';
      const mode = rel.submitMode === 'manual' || !apiConfigured ? 'manual' : 'api';
      meta.textContent =
        (rel.status || 'draft') +
        ' · ' +
        mode +
        (rel.providerReleaseId ? ' · lg #' + rel.providerReleaseId : '') +
        (rel.upc ? ' · upc ' + rel.upc : '');
      const actions = document.createElement('div');
      actions.className = 'studio-releases-actions';

      if (apiConfigured && rel.providerReleaseId) {
        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'icon-btn';
        useBtn.textContent = 'select for submit';
        useBtn.addEventListener('click', function () {
          activeProviderReleaseId = rel.providerReleaseId;
          document.getElementById('releaseSubmitBtn').disabled = !isOwner || !activeProviderReleaseId;
          setStatus('selected release #' + activeProviderReleaseId + ' for submit', 'success');
        });
        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'icon-btn';
        refreshBtn.textContent = 'refresh status';
        refreshBtn.addEventListener('click', function () {
          refreshReleaseStatus(rel.providerReleaseId);
        });
        actions.appendChild(useBtn);
        actions.appendChild(refreshBtn);
      } else if (
        isOwner &&
        rel.status !== 'distro_submitted' &&
        rel.status !== 'dsp_live'
      ) {
        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'icon-btn';
        doneBtn.textContent = 'mark submitted';
        doneBtn.addEventListener('click', function () {
          markSubmittedManual(rel.id);
        });
        actions.appendChild(doneBtn);
      }

      li.appendChild(title);
      li.appendChild(meta);
      if (actions.childNodes.length) li.appendChild(actions);
      catalogRoot.appendChild(li);
    });
  }

  function distroGet(action, extraQuery) {
    return whenReady().then(function () {
      let url = getApiBase() + '/studio-distro?action=' + encodeURIComponent(action);
      if (extraQuery) url += '&' + extraQuery;
      return fetch(url, { headers: authHeaders() }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.message) || 'distro get failed');
          return data;
        });
      });
    });
  }

  function distroPost(payload) {
    return whenReady().then(function () {
      return fetch(getApiBase() + '/studio-distro', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.message) || 'distro post failed');
          return data;
        });
      });
    });
  }

  function refreshDistroStatus() {
    const el = document.getElementById('distroStatus');
    return distroGet('status')
      .then(function (data) {
        apiConfigured = !!data.configured;
        if (apiConfigured) {
          el.textContent =
            'API key present · provider ' +
            (data.provider || 'labelgrid') +
            (data.sandbox ? ' · sandbox' : ' · production');
        } else {
          el.textContent =
            'Solo / manual mode · no API key · provider ' + (data.provider || 'labelgrid');
        }
        applyDistroMode();
        renderCatalog();
        refreshChecklist();
      })
      .catch(function (err) {
        apiConfigured = false;
        el.textContent = 'Solo / manual mode · ' + (err.message || 'distro status unavailable');
        applyDistroMode();
        renderCatalog();
        refreshChecklist();
      });
  }

  function savePrefs() {
    const next = {
      provider: 'labelgrid',
      labelId: getVal('prefLabelId') ? Number(getVal('prefLabelId')) : null,
      artistId: getVal('prefArtistId') ? Number(getVal('prefArtistId')) : null,
      writerId: getVal('prefWriterId') ? Number(getVal('prefWriterId')) : null,
      primaryGenreId: getVal('prefGenreId') ? Number(getVal('prefGenreId')) : null,
      rightsName: getVal('prefRightsName'),
      audioLanguage: 'en',
      artworkAiUsage: 'none',
      catalogPrefix: 'BF'
    };
    setStatus('saving prefs…', 'working');
    return distroPost({ action: 'save-prefs', prefs: next })
      .then(function (data) {
        prefs = data.prefs;
        const cs = cloud();
        if (cs && cs.put) cs.put('distroPreferences', prefs);
        setStatus('prefs saved', 'success');
        refreshChecklist();
      })
      .catch(function (err) {
        setStatus(err.message || 'save prefs failed', 'error');
      });
  }

  function createRelease() {
    const draft = currentDraft();
    const check = window.BurnfolderReleaseChecklist.evaluate(draft, {
      rightsName: getVal('prefRightsName')
    });
    if (!check.ok) {
      setStatus('checklist still has gaps', 'error');
      return;
    }
    setStatus('creating on LabelGrid (uploads masters from vault)…', 'working');
    distroPost({ action: 'create', release: draft })
      .then(function (data) {
        activeProviderReleaseId = data.release && data.release.providerReleaseId;
        catalog = {
          releases: [data.release].concat(
            (catalog.releases || []).filter(function (r) {
              return r.id !== data.release.id;
            })
          )
        };
        const cs = cloud();
        if (cs && cs.put) cs.put('releaseCatalog', catalog);
        return loadPrefsAndCatalog().then(function () {
          document.getElementById('releaseSubmitBtn').disabled = !isOwner || !activeProviderReleaseId;
          setStatus(
            'created LabelGrid release #' + activeProviderReleaseId + ' — review then submit',
            'success'
          );
        });
      })
      .catch(function (err) {
        setStatus(err.message || 'create failed', 'error');
      });
  }

  function submitRelease() {
    if (!isOwner) {
      setStatus('owner role required to submit', 'error');
      return;
    }
    if (!activeProviderReleaseId) {
      setStatus('select or create a release first', 'error');
      return;
    }
    if (!window.confirm('Submit release #' + activeProviderReleaseId + ' to LabelGrid / DSPs?')) {
      return;
    }
    setStatus('submitting…', 'working');
    distroPost({ action: 'submit', providerReleaseId: activeProviderReleaseId })
      .then(function () {
        return loadPrefsAndCatalog();
      })
      .then(function () {
        setStatus('submitted — DSP review is usually 3–14 days', 'success');
      })
      .catch(function (err) {
        setStatus(err.message || 'submit failed', 'error');
      });
  }

  function refreshReleaseStatus(providerReleaseId) {
    setStatus('refreshing…', 'working');
    distroPost({ action: 'refresh-status', providerReleaseId: providerReleaseId })
      .then(function () {
        return loadPrefsAndCatalog();
      })
      .then(function () {
        setStatus('status updated', 'success');
      })
      .catch(function (err) {
        setStatus(err.message || 'refresh failed', 'error');
      });
  }

  function bind() {
    groupSelect.addEventListener('change', hydrateFromGroup);
    [
      'releaseTitle',
      'releaseContentType',
      'releaseDate',
      'releaseExplicit',
      'releaseRightsName'
    ].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', refreshChecklist);
      if (el) el.addEventListener('change', refreshChecklist);
    });
    document.getElementById('releaseArtworkSizeOk').addEventListener('change', refreshChecklist);

    document.getElementById('releaseArtworkFile').addEventListener('change', function () {
      const f = this.files && this.files[0];
      if (!f) return;
      setStatus('uploading cover…', 'working');
      window.BurnfolderVaultUpload.uploadFile(f, {
        kind: 'artwork',
        releaseKey: getVal('releaseTitle') || 'draft'
      })
        .then(function (result) {
          artworkVaultKey = result.vaultKey;
          artworkFileName = result.fileName;
          document.getElementById('artworkHint').textContent = 'cover: ' + result.fileName;
          refreshChecklist();
          setStatus('cover uploaded', 'success');
        })
        .catch(function (err) {
          setStatus(err.message || 'cover upload failed', 'error');
        });
    });

    const savePrefsBtn = document.getElementById('distroSavePrefs');
    if (savePrefsBtn) savePrefsBtn.addEventListener('click', savePrefs);
    const pingBtn = document.getElementById('distroPing');
    if (pingBtn) {
      pingBtn.addEventListener('click', function () {
        setStatus('pinging LabelGrid…', 'working');
        distroGet('ping')
          .then(function (data) {
            setStatus(
              'LabelGrid ok — ' + ((data.user && data.user.email) || 'authenticated'),
              'success'
            );
          })
          .catch(function (err) {
            setStatus(err.message || 'ping failed', 'error');
          });
      });
    }
    const loadRefsBtn = document.getElementById('distroLoadRefs');
    if (loadRefsBtn) {
      loadRefsBtn.addEventListener('click', function () {
        const pre = document.getElementById('distroRefs');
        setStatus('loading LabelGrid refs…', 'working');
        distroGet('refs')
          .then(function (data) {
            pre.hidden = false;
            pre.textContent = JSON.stringify(
              {
                labels: (data.labels || []).slice(0, 20),
                artists: (data.artists || []).slice(0, 20),
                genres: (data.genres || []).slice(0, 40)
              },
              null,
              2
            );
            setStatus('refs loaded — copy ids into prefs', 'success');
          })
          .catch(function (err) {
            setStatus(err.message || 'refs failed', 'error');
          });
      });
    }

    const createBtn = document.getElementById('releaseCreateBtn');
    if (createBtn) createBtn.addEventListener('click', createRelease);
    const submitBtn = document.getElementById('releaseSubmitBtn');
    if (submitBtn) submitBtn.addEventListener('click', submitRelease);
    const markReadyBtn = document.getElementById('releaseMarkReadyBtn');
    if (markReadyBtn) markReadyBtn.addEventListener('click', markReadyManual);
  }

  function detectOwner() {
    const auth = window.BurnfolderStudioAuth;
    isOwner = !!(auth && auth.canPublish && auth.canPublish());
    applyDistroMode();
    const submitBtn = document.getElementById('releaseSubmitBtn');
    if (submitBtn) submitBtn.disabled = !isOwner || !activeProviderReleaseId;
  }

  function markNav() {
    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      const active = link.getAttribute('data-nav') === 'releases';
      link.classList.toggle('is-active', active);
      link.classList.toggle('page-nav', active);
    });
  }

  whenReady()
    .then(function () {
      markNav();
      detectOwner();
      bind();
      return Promise.all([
        shared() && shared().hydrateStackFromCloud ? shared().hydrateStackFromCloud() : Promise.resolve(),
        loadPrefsAndCatalog(),
        refreshDistroStatus(),
        window.BurnfolderVaultUpload.status().catch(function () {
          return { configured: false };
        })
      ]);
    })
    .then(function (results) {
      const vault = results[3] || {};
      if (!vault.configured) {
        setStatus('R2 vault not configured yet — add R2_* env vars (see TIER-2-SETUP.md)', 'error');
      }
      fillGroups();
      refreshChecklist();
    })
    .catch(function (err) {
      setStatus(err.message || 'releases page failed to load', 'error');
    });
})();
