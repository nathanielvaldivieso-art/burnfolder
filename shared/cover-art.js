(function (root) {
  'use strict';

  function extensionFromFile(file) {
    const name = String((file && file.name) || '').toLowerCase();
    const dot = name.lastIndexOf('.');
    if (dot > 0 && dot < name.length - 1) {
      const ext = name.slice(dot + 1);
      if (/^(jpe?g|png|gif|webp|avif)$/.test(ext)) return ext === 'jpeg' ? 'jpg' : ext;
    }
    const mime = String((file && file.type) || '').toLowerCase();
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    return 'jpg';
  }

  function coverSlug(label) {
    return (
      String(label || 'untitled')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toUpperCase() || 'UNTITLED'
    );
  }

  function suggestCoverPublicPath(label, file) {
    const ext = extensionFromFile(file || {});
    return 'IMAGES/' + coverSlug(label) + '-COVER.' + ext;
  }

  function isSiteCoverPath(value) {
    return /^IMAGES\//i.test(String(value || '').trim());
  }

  function resolveCoverPreviewUrl(meta) {
    const path = String((meta && meta.coverArt) || '').trim();
    const assetId = String((meta && meta.coverAssetId) || '').trim();
    const cloud = root.BurnfolderAssetCloud;

    if (assetId && cloud && cloud.getBlobUrl) {
      return cloud.getBlobUrl(assetId).then(function (url) {
        if (url) return url;
        if (path.indexOf('data:') === 0) return path;
        return path || '';
      });
    }

    return Promise.resolve(path || '');
  }

  function applyCoverPreview(coverBtn, meta) {
    if (!coverBtn) return;
    coverBtn.innerHTML = '';
    const path = String((meta && meta.coverArt) || '').trim();
    if (!path) {
      coverBtn.classList.add('is-empty');
      coverBtn.setAttribute('aria-label', 'Add cover art');
      return;
    }

    coverBtn.classList.remove('is-empty');
    const img = document.createElement('img');
    img.alt = (meta && (meta.coverAlt || meta.title)) || 'cover art';
    coverBtn.appendChild(img);
    resolveCoverPreviewUrl(meta).then(function (src) {
      if (src) img.src = src;
    });
    coverBtn.setAttribute('aria-label', 'Change cover art');
  }

  function applyCoverImage(imgEl, meta) {
    if (!imgEl) return Promise.resolve();
    const path = String((meta && meta.coverArt) || '').trim();

    const prevUrl = imgEl.dataset.blobUrl;
    if (prevUrl) {
      URL.revokeObjectURL(prevUrl);
      delete imgEl.dataset.blobUrl;
    }

    if (!path) {
      imgEl.removeAttribute('src');
      imgEl.hidden = true;
      return Promise.resolve();
    }

    imgEl.hidden = false;
    return resolveCoverPreviewUrl(meta).then(function (src) {
      if (!src) {
        imgEl.hidden = true;
        imgEl.removeAttribute('src');
        return;
      }
      if (src.indexOf('blob:') === 0) imgEl.dataset.blobUrl = src;
      imgEl.src = src;
    });
  }

  function downloadCoverAsset(assetId, publicPath) {
    const cloud = root.BurnfolderAssetCloud;
    if (!cloud || !cloud.getAsset || !assetId) return Promise.resolve();

    const fileName = String(publicPath || '')
      .split('/')
      .pop() || 'cover.jpg';

    return cloud.getAsset(assetId).then(function (row) {
      if (!row || !row.blob) return;
      const url = URL.createObjectURL(row.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
    });
  }

  function registerCoverFromFile(file, label, options) {
    const cloud = root.BurnfolderAssetCloud;
    if (!cloud || !cloud.registerImageFile) {
      return Promise.reject(new Error('image storage unavailable'));
    }

    const opts = options || {};
    const publicPath = suggestCoverPublicPath(label, file);
    const coverLabel = String(label || '').trim() || 'cover';

    return cloud
      .registerImageFile(file, {
        publicPath: publicPath,
        displayTitle: coverLabel + ' cover'
      })
      .then(function (asset) {
        const result = {
          id: asset.id,
          publicPath: asset.publicPath || publicPath,
          coverArt: asset.publicPath || publicPath,
          coverAssetId: asset.id,
          coverAlt: coverLabel
        };
        if (opts.download === false) return result;
        return downloadCoverAsset(result.coverAssetId, result.coverArt).then(function () {
          return result;
        });
      });
  }

  function patchFromCoverResult(meta, result) {
    const m = meta || {};
    if (!result) return clearCoverMeta(m);
    m.coverArt = result.coverArt || result.publicPath || '';
    m.coverAssetId = result.coverAssetId || result.id || '';
    m.coverAlt = result.coverAlt || m.title || 'cover art';
    return m;
  }

  function clearCoverMeta(meta) {
    const m = meta || {};
    m.coverArt = '';
    m.coverAssetId = '';
    return m;
  }

  root.BurnfolderCoverArt = {
    coverSlug: coverSlug,
    suggestCoverPublicPath: suggestCoverPublicPath,
    isSiteCoverPath: isSiteCoverPath,
    resolveCoverPreviewUrl: resolveCoverPreviewUrl,
    applyCoverPreview: applyCoverPreview,
    applyCoverImage: applyCoverImage,
    registerCoverFromFile: registerCoverFromFile,
    downloadCoverAsset: downloadCoverAsset,
    patchFromCoverResult: patchFromCoverResult,
    clearCoverMeta: clearCoverMeta
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
