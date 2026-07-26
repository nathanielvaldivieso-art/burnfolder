/**
 * High-level Studio cloud files API — sessions/stems/refs + pictures (image/press/epk).
 * Depends on BurnfolderVaultUpload (studio-vault + R2).
 */
(function () {
  'use strict';

  function vault() {
    const api = window.BurnfolderVaultUpload;
    if (!api) return Promise.reject(new Error('BurnfolderVaultUpload unavailable'));
    return Promise.resolve(api);
  }

  function uploadSession(file, options) {
    const opts = options || {};
    const kind = opts.kind || 'session';
    if (kind !== 'session' && kind !== 'stem' && kind !== 'ref') {
      return Promise.reject(new Error('session kind must be session, stem, or ref'));
    }
    if (!opts.songGroupKey) {
      return Promise.reject(new Error('songGroupKey required'));
    }
    return vault().then(function (api) {
      return api.uploadFile(file, {
        kind: kind,
        songGroupKey: opts.songGroupKey,
        notes: opts.notes
      });
    });
  }

  function uploadImage(file, options) {
    const opts = options || {};
    const kind = opts.kind || 'image';
    if (kind !== 'image' && kind !== 'press' && kind !== 'epk') {
      return Promise.reject(new Error('image kind must be image, press, or epk'));
    }
    return vault().then(function (api) {
      return api.uploadFile(file, {
        kind: kind,
        folderKey: opts.folderKey || 'general',
        notes: opts.notes,
        publicPath: opts.publicPath
      });
    });
  }

  function listSessions(songGroupKey, options) {
    const opts = options || {};
    return vault().then(function (api) {
      return api.list({
        kind: opts.kind || '',
        songGroupKey: songGroupKey || ''
      }).then(function (data) {
        const items = (data && data.items) || [];
        return items.filter(function (row) {
          return row && (row.kind === 'session' || row.kind === 'stem' || row.kind === 'ref');
        });
      });
    });
  }

  function listImages(options) {
    const opts = options || {};
    return vault().then(function (api) {
      return api.list({
        kind: opts.kind || '',
        folderKey: opts.folderKey || ''
      }).then(function (data) {
        const items = (data && data.items) || [];
        return items.filter(function (row) {
          return row && (row.kind === 'image' || row.kind === 'press' || row.kind === 'epk');
        });
      });
    });
  }

  function download(vaultKey) {
    return vault().then(function (api) {
      return api.downloadUrl(vaultKey);
    });
  }

  function remove(vaultKey) {
    return vault().then(function (api) {
      return api.deleteObject(vaultKey);
    });
  }

  function status() {
    return vault().then(function (api) {
      return api.status();
    });
  }

  window.BurnfolderCloudFiles = {
    uploadSession: uploadSession,
    uploadImage: uploadImage,
    listSessions: listSessions,
    listImages: listImages,
    download: download,
    remove: remove,
    status: status
  };
})();
