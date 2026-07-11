(function () {
  'use strict';

  const store = window.BurnfolderPressPageStore;
  const renderApi = window.BurnfolderPressPageRender;

  if (!store || !renderApi) return;

  const pressPhotoEl = document.getElementById('pressDesignerPressPhoto');
  const pressPhotoFileEl = document.getElementById('pressDesignerPressPhotoFile');
  const pressPhotoPreviewEl = document.getElementById('pressDesignerPressPhotoPreview');
  const bioEl = document.getElementById('pressDesignerBio');
  const releaseLineEl = document.getElementById('pressDesignerReleaseLine');
  const pullQuoteEl = document.getElementById('pressDesignerPullQuote');
  const contactEmailEl = document.getElementById('pressDesignerContactEmail');
  const linksList = document.getElementById('pressDesignerLinksList');
  const assetsList = document.getElementById('pressDesignerAssetsList');
  const previewRoot = document.getElementById('pressDesignerPreviewRoot');
  const statusEl = document.getElementById('pressDesignerStatus');
  const pushBtn = document.getElementById('pressDesignerPushBtn');
  const addLinkBtn = document.getElementById('pressDesignerAddLinkBtn');
  const addAssetBtn = document.getElementById('pressDesignerAddAssetBtn');

  let currentPage = store.emptyPage();
  let saveTimer = null;
  let loadingPage = false;
  let pendingPreviewUrl = '';

  function setStatus(msg, kind) {
    if (window.BurnfolderStudioStatus) {
      window.BurnfolderStudioStatus.set(statusEl, msg, kind);
      return;
    }
    if (statusEl) statusEl.textContent = msg || '';
  }

  function readEditorState() {
    return {
      pressPhoto: pressPhotoEl ? pressPhotoEl.value : '',
      bio: bioEl ? bioEl.value : '',
      releaseLine: releaseLineEl ? releaseLineEl.value : '',
      pullQuote: pullQuoteEl ? pullQuoteEl.value : '',
      contactEmail: contactEmailEl ? contactEmailEl.value : '',
      links: (currentPage.links || []).slice(),
      assets: (currentPage.assets || []).slice()
    };
  }

  function updatePhotoPreview(src) {
    if (!pressPhotoPreviewEl) return;
    if (src) {
      pressPhotoPreviewEl.src = src;
      pressPhotoPreviewEl.hidden = false;
    } else {
      pressPhotoPreviewEl.removeAttribute('src');
      pressPhotoPreviewEl.hidden = true;
    }
  }

  function paintPreview() {
    if (!previewRoot) return;
    const state = readEditorState();
    if (pendingPreviewUrl) {
      state.pressPhoto = pendingPreviewUrl;
    }
    renderApi.apply(previewRoot, { page: state });
  }

  function scheduleSave() {
    if (loadingPage) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      store
        .savePage(readEditorState())
        .then(function (page) {
          currentPage = page;
          paintPreview();
          setStatus('saved');
        })
        .catch(function (err) {
          setStatus(err.message || 'save failed', 'error');
        });
    }, 500);
  }

  function bindTextInput(el) {
    if (!el) return;
    el.addEventListener('input', scheduleSave);
  }

  function renderRowList(listEl, rows, kind) {
    if (!listEl) return;
    listEl.innerHTML = '';
    const items = Array.isArray(rows) ? rows : [];

    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'studio-press-row-empty';
      empty.textContent = kind === 'asset' ? 'No assets yet.' : 'No links yet.';
      listEl.appendChild(empty);
      return;
    }

    items.forEach(function (row) {
      const li = document.createElement('li');
      li.className = 'studio-press-row';

      const head = document.createElement('div');
      head.className = 'studio-press-row-head';

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn studio-press-row-remove';
      remove.textContent = 'remove';
      remove.addEventListener('click', function () {
        if (kind === 'asset') {
          currentPage.assets = (currentPage.assets || []).filter(function (item) {
            return item.id !== row.id;
          });
        } else {
          currentPage.links = (currentPage.links || []).filter(function (item) {
            return item.id !== row.id;
          });
        }
        renderRowLists();
        scheduleSave();
      });
      head.appendChild(remove);
      li.appendChild(head);

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'studio-song-designer-input';
      labelInput.value = row.label || '';
      labelInput.placeholder = 'label';
      labelInput.addEventListener('input', function () {
        row.label = labelInput.value;
        scheduleSave();
      });
      li.appendChild(labelInput);

      const hrefInput = document.createElement('input');
      hrefInput.type = 'text';
      hrefInput.className = 'studio-song-designer-input';
      hrefInput.value = row.href || '';
      hrefInput.placeholder = kind === 'asset' ? 'path or url' : 'href';
      hrefInput.addEventListener('input', function () {
        row.href = hrefInput.value;
        scheduleSave();
      });
      li.appendChild(hrefInput);

      const flags = document.createElement('div');
      flags.className = 'studio-press-row-flags';

      const pendingLabel = document.createElement('label');
      pendingLabel.className = 'studio-press-row-flag';
      const pendingInput = document.createElement('input');
      pendingInput.type = 'checkbox';
      pendingInput.checked = !!row.pending;
      pendingInput.addEventListener('change', function () {
        row.pending = pendingInput.checked;
        scheduleSave();
      });
      pendingLabel.appendChild(pendingInput);
      pendingLabel.appendChild(document.createTextNode(' pending'));
      flags.appendChild(pendingLabel);

      if (kind === 'asset') {
        const downloadLabel = document.createElement('label');
        downloadLabel.className = 'studio-press-row-flag';
        const downloadInput = document.createElement('input');
        downloadInput.type = 'checkbox';
        downloadInput.checked = !!row.download;
        downloadInput.addEventListener('change', function () {
          row.download = downloadInput.checked;
          scheduleSave();
        });
        downloadLabel.appendChild(downloadInput);
        downloadLabel.appendChild(document.createTextNode(' download'));
        flags.appendChild(downloadLabel);
      }

      li.appendChild(flags);
      listEl.appendChild(li);
    });
  }

  function renderRowLists() {
    renderRowList(linksList, currentPage.links, 'link');
    renderRowList(assetsList, currentPage.assets, 'asset');
  }

  function fillEditor(page) {
    loadingPage = true;
    currentPage = store.normalizePage(page);
    if (pressPhotoEl) pressPhotoEl.value = currentPage.pressPhoto || '';
    if (bioEl) bioEl.value = currentPage.bio || '';
    if (releaseLineEl) releaseLineEl.value = currentPage.releaseLine || '';
    if (pullQuoteEl) pullQuoteEl.value = currentPage.pullQuote || '';
    if (contactEmailEl) contactEmailEl.value = currentPage.contactEmail || '';
    pendingPreviewUrl = '';
    updatePhotoPreview(currentPage.pressPhoto || '');
    renderRowLists();
    paintPreview();
    loadingPage = false;
  }

  function mergeWithPublished(page) {
    const pub = store.getPublishedPage();
    if (!pub || !store.hasContent(pub)) return page;
    const merged = store.normalizePage(page);
    if (!store.hasContent(merged)) return pub;
    return merged;
  }

  function loadPage() {
    setStatus('loading…');
    return store
      .resolvePage(true)
      .then(function (page) {
        fillEditor(mergeWithPublished(page));
        return store.getPendingPhoto();
      })
      .then(function (pending) {
        if (pending && pending.previewUrl) {
          pendingPreviewUrl = pending.previewUrl;
          if (pressPhotoEl && pending.path) pressPhotoEl.value = pending.path;
          updatePhotoPreview(pending.previewUrl);
          paintPreview();
        }
        setStatus('');
      })
      .catch(function (err) {
        setStatus(err.message || 'load failed', 'error');
      });
  }

  bindTextInput(pressPhotoEl);
  bindTextInput(bioEl);
  bindTextInput(releaseLineEl);
  bindTextInput(pullQuoteEl);
  bindTextInput(contactEmailEl);

  if (pressPhotoEl) {
    pressPhotoEl.addEventListener('input', function () {
      pendingPreviewUrl = '';
      updatePhotoPreview(pressPhotoEl.value.trim());
    });
  }

  if (pressPhotoFileEl) {
    pressPhotoFileEl.addEventListener('change', function () {
      const file = pressPhotoFileEl.files && pressPhotoFileEl.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        setStatus('photo must be an image', 'error');
        return;
      }
      if (file.size > 4 * 1024 * 1024) {
        setStatus('photo must be under 4MB', 'error');
        return;
      }

      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = 'IMAGES/PRESS-PHOTO.' + (ext || 'jpg');

      setStatus('reading photo…');
      store
        .fileToBase64(file)
        .then(function (base64) {
          const previewUrl = URL.createObjectURL(file);
          return store
            .setPendingPhoto({
              path: path,
              base64: base64,
              previewUrl: previewUrl,
              name: file.name
            })
            .then(function () {
              pendingPreviewUrl = previewUrl;
              if (pressPhotoEl) pressPhotoEl.value = path;
              updatePhotoPreview(previewUrl);
              scheduleSave();
              setStatus('photo ready — push to upload');
            });
        })
        .catch(function (err) {
          setStatus(err.message || 'photo read failed', 'error');
        });
    });
  }

  if (addLinkBtn) {
    addLinkBtn.addEventListener('click', function () {
      currentPage.links = (currentPage.links || []).concat([
        store.normalizeLinkRow({ label: 'new link', href: '', pending: true })
      ]);
      renderRowLists();
      scheduleSave();
    });
  }

  if (addAssetBtn) {
    addAssetBtn.addEventListener('click', function () {
      currentPage.assets = (currentPage.assets || []).concat([
        store.normalizeAssetRow({ label: 'new asset', href: '', pending: true })
      ]);
      renderRowLists();
      scheduleSave();
    });
  }

  if (pushBtn) {
    pushBtn.addEventListener('click', function () {
      if (!store.pushToSite) {
        setStatus('push not available', 'error');
        return;
      }

      function doPush() {
        const payload = store.getPublishedPayload();
        if (!payload) {
          setStatus('add content before pushing', 'error');
          return Promise.resolve();
        }

        if (
          !window.confirm(
            'Push press page to burnfolder.com?\n\nThis updates press-page.js (and press photo if you picked one).'
          )
        ) {
          return Promise.resolve();
        }

        pushBtn.disabled = true;
        pushBtn.textContent = 'pushing…';
        setStatus('pushing to site…');

        return store
          .pushToSite()
          .then(function (data) {
            pendingPreviewUrl = '';
            updatePhotoPreview((pressPhotoEl && pressPhotoEl.value) || '');
            paintPreview();
            setStatus((data && data.message) || 'pushed to site', 'success');
          })
          .catch(function (err) {
            setStatus(err.message || 'push failed', 'error');
          })
          .finally(function () {
            pushBtn.disabled = false;
            pushBtn.textContent = 'push to site';
          });
      }

      window.clearTimeout(saveTimer);
      store
        .savePage(readEditorState())
        .then(function (page) {
          currentPage = page;
          return doPush();
        })
        .catch(function (err) {
          setStatus(err.message || 'could not save before push', 'error');
        });
    });
  }

  loadPage();
})();
