(function () {
  'use strict';

  const store = window.BurnfolderShopProductsStore;
  if (!store) return;

  const idEl = document.getElementById('shopDesignerId');
  const titleEl = document.getElementById('shopDesignerTitle');
  const subtitleEl = document.getElementById('shopDesignerSubtitle');
  const blurbEl = document.getElementById('shopDesignerBlurb');
  const coverPathEl = document.getElementById('shopDesignerCoverPath');
  const coverFileEl = document.getElementById('shopDesignerCoverFile');
  const coverPreviewEl = document.getElementById('shopDesignerCoverPreview');
  const downloadHrefEl = document.getElementById('shopDesignerDownloadHref');
  const minEl = document.getElementById('shopDesignerMin');
  const maxEl = document.getElementById('shopDesignerMax');
  const amountsEl = document.getElementById('shopDesignerAmounts');
  const activeEl = document.getElementById('shopDesignerActive');
  const statusEl = document.getElementById('shopDesignerStatus');
  const pushBtn = document.getElementById('shopDesignerPushBtn');
  const previewRoot = document.getElementById('shopDesignerPreviewRoot');

  let currentProduct = store.emptyProduct();
  let saveTimer = null;
  let loading = false;

  function setStatus(msg, kind) {
    if (window.BurnfolderStudioStatus) {
      window.BurnfolderStudioStatus.set(statusEl, msg, kind);
      return;
    }
    if (statusEl) statusEl.textContent = msg || '';
  }

  function parseAmounts(raw) {
    return String(raw || '')
      .split(/[,\s]+/)
      .map(function (part) {
        return Number(part);
      })
      .filter(function (n) {
        return Number.isFinite(n) && n >= 1;
      });
  }

  function readEditorState() {
    return {
      id: idEl ? idEl.value : currentProduct.id,
      title: titleEl ? titleEl.value : '',
      subtitle: subtitleEl ? subtitleEl.value : '',
      blurb: blurbEl ? blurbEl.value : '',
      coverArt: coverPathEl ? coverPathEl.value : '',
      downloadHref: downloadHrefEl ? downloadHrefEl.value : '',
      minAmount: minEl ? Number(minEl.value) : 1,
      maxAmount: maxEl ? Number(maxEl.value) : 500,
      suggestedAmounts: amountsEl ? parseAmounts(amountsEl.value) : [5, 10, 15],
      active: activeEl ? activeEl.checked : true
    };
  }

  function paintPreview() {
    if (!previewRoot) return;
    const product = store.normalizeProduct(readEditorState());
    previewRoot.innerHTML = '';
    if (window.BurnfolderShopProductsRender && window.BurnfolderShopProductsRender.renderProductCard) {
      previewRoot.appendChild(
        window.BurnfolderShopProductsRender.renderProductCard(product, {
          onBuy: function () {},
          onCustom: function () {}
        })
      );
    }
  }

  function updateCoverPreview(src) {
    if (!coverPreviewEl) return;
    if (src) {
      coverPreviewEl.src = src;
      coverPreviewEl.hidden = false;
    } else {
      coverPreviewEl.removeAttribute('src');
      coverPreviewEl.hidden = true;
    }
  }

  function scheduleSave() {
    if (loading) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      const next = store.normalizeProduct(readEditorState());
      store
        .saveProduct(next)
        .then(function (product) {
          currentProduct = product;
          paintPreview();
          setStatus('saved');
        })
        .catch(function (err) {
          setStatus(err.message || 'save failed', 'error');
        });
    }, 400);
  }

  function fillEditor(product) {
    loading = true;
    currentProduct = store.normalizeProduct(product);
    if (idEl) idEl.value = currentProduct.id || '';
    if (titleEl) titleEl.value = currentProduct.title || '';
    if (subtitleEl) subtitleEl.value = currentProduct.subtitle || '';
    if (blurbEl) blurbEl.value = currentProduct.blurb || '';
    if (coverPathEl) coverPathEl.value = currentProduct.coverArt || '';
    if (downloadHrefEl) downloadHrefEl.value = currentProduct.downloadHref || '';
    if (minEl) minEl.value = String(currentProduct.minAmount || 1);
    if (maxEl) maxEl.value = String(currentProduct.maxAmount || 500);
    if (amountsEl) amountsEl.value = (currentProduct.suggestedAmounts || []).join(', ');
    if (activeEl) activeEl.checked = currentProduct.active !== false;
    updateCoverPreview(currentProduct.coverArt || '');
    paintPreview();
    loading = false;
  }

  function loadPage() {
    setStatus('loading…');
    return store
      .resolveCatalog(true)
      .then(function (catalog) {
        const product = (catalog.products && catalog.products[0]) || store.emptyProduct();
        fillEditor(product);
        return store.getPendingCover();
      })
      .then(function (pending) {
        if (pending && pending.previewUrl) updateCoverPreview(pending.previewUrl);
        else if (pending && pending.path) updateCoverPreview(pending.path);
        setStatus('');
      })
      .catch(function (err) {
        setStatus(err.message || 'load failed', 'error');
      });
  }

  [idEl, titleEl, subtitleEl, blurbEl, coverPathEl, downloadHrefEl, minEl, maxEl, amountsEl].forEach(
    function (el) {
      if (!el) return;
      el.addEventListener('input', scheduleSave);
    }
  );
  if (activeEl) activeEl.addEventListener('change', scheduleSave);

  if (coverFileEl) {
    coverFileEl.addEventListener('change', function () {
      const file = coverFileEl.files && coverFileEl.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) {
        setStatus('cover must be an image', 'error');
        return;
      }
      if (file.size > 4 * 1024 * 1024) {
        setStatus('cover must be under 4MB', 'error');
        return;
      }

      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
      const productId = store.sanitizeId((idEl && idEl.value) || currentProduct.id) || 'product';
      const path = 'IMAGES/SHOP-' + productId.toUpperCase() + '-COVER.' + (ext || 'png');

      setStatus('reading cover…');
      store
        .fileToBase64(file)
        .then(function (base64) {
          const previewUrl = URL.createObjectURL(file);
          return store
            .setPendingCover({
              path: path,
              base64: base64,
              previewUrl: previewUrl,
              name: file.name
            })
            .then(function () {
              if (coverPathEl) coverPathEl.value = path;
              updateCoverPreview(previewUrl);
              scheduleSave();
              setStatus('cover ready — push to upload');
            });
        })
        .catch(function (err) {
          setStatus(err.message || 'cover read failed', 'error');
        });
    });
  }

  if (pushBtn) {
    pushBtn.addEventListener('click', function () {
      function doPush() {
        setStatus('pushing…');
        pushBtn.disabled = true;
        store
          .saveProduct(readEditorState())
          .then(function () {
            return store.pushToSite();
          })
          .then(function (data) {
            setStatus((data && data.message) || 'pushed', 'ok');
          })
          .catch(function (err) {
            setStatus(err.message || 'push failed', 'error');
          })
          .then(function () {
            pushBtn.disabled = false;
          });
      }

      if (
        window.confirm(
          'Push shop product to burnfolder.com?\n\nThis updates shop-products.js (and cover image if you picked one).'
        )
      ) {
        doPush();
      }
    });
  }

  loadPage();
})();
