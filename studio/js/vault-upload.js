/**
 * R2 vault uploads via studio-vault Netlify function (presigned PUT).
 * Sessions/stems/refs and image/press/epk auto-register into Blob manifests.
 */
(function () {
  'use strict';

  const PROJECT_KINDS = { session: 1, stem: 1, ref: 1 };
  const IMAGE_KINDS = { image: 1, press: 1, epk: 1 };

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

  function shouldAutoRegister(kind) {
    return !!(PROJECT_KINDS[kind] || IMAGE_KINDS[kind]);
  }

  function requestUploadUrl(options) {
    const opts = options || {};
    return whenReady().then(function () {
      return fetch(getApiBase() + '/studio-vault', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({
          action: 'upload-url',
          kind: opts.kind || 'master',
          fileName: opts.fileName,
          contentType: opts.contentType || 'application/octet-stream',
          trackKey: opts.trackKey,
          releaseKey: opts.releaseKey,
          songGroupKey: opts.songGroupKey,
          folderKey: opts.folderKey
        })
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.message) || 'vault upload-url failed');
          return data;
        });
      });
    });
  }

  function register(meta) {
    const opts = meta || {};
    return whenReady().then(function () {
      return fetch(getApiBase() + '/studio-vault', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({
          action: 'register',
          vaultKey: opts.vaultKey,
          kind: opts.kind,
          filename: opts.filename || opts.fileName,
          size: opts.size,
          contentType: opts.contentType,
          songGroupKey: opts.songGroupKey,
          folderKey: opts.folderKey,
          notes: opts.notes,
          publicPath: opts.publicPath
        })
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.message) || 'vault register failed');
          return data;
        });
      });
    });
  }

  function uploadFile(file, options) {
    if (!file) return Promise.reject(new Error('file required'));
    const opts = options || {};
    const kind = opts.kind || 'master';
    const contentType = file.type || opts.contentType || 'application/octet-stream';
    return requestUploadUrl({
      kind: kind,
      fileName: file.name,
      contentType: contentType,
      trackKey: opts.trackKey,
      releaseKey: opts.releaseKey,
      songGroupKey: opts.songGroupKey,
      folderKey: opts.folderKey
    }).then(function (signed) {
      return fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file
      }).then(function (res) {
        if (!res.ok) throw new Error('R2 upload failed (' + res.status + ')');
        const result = {
          vaultKey: signed.vaultKey,
          fileName: file.name,
          size: file.size,
          contentType: contentType,
          kind: kind,
          songGroupKey: opts.songGroupKey || '',
          folderKey: opts.folderKey || ''
        };
        if (!shouldAutoRegister(kind) || opts.register === false) {
          return result;
        }
        return register({
          vaultKey: result.vaultKey,
          kind: kind,
          filename: result.fileName,
          size: result.size,
          contentType: contentType,
          songGroupKey: opts.songGroupKey,
          folderKey: opts.folderKey,
          notes: opts.notes,
          publicPath: opts.publicPath
        }).then(function (registered) {
          return Object.assign({}, result, {
            registered: true,
            row: registered && registered.row ? registered.row : null,
            manifest: registered && registered.manifest ? registered.manifest : null
          });
        });
      });
    });
  }

  function list(options) {
    const opts = options || {};
    const params = new URLSearchParams();
    params.set('action', 'list');
    if (opts.kind) params.set('kind', opts.kind);
    if (opts.songGroupKey) params.set('songGroupKey', opts.songGroupKey);
    if (opts.folderKey) params.set('folderKey', opts.folderKey);
    if (opts.trackKey) params.set('trackKey', opts.trackKey);
    if (opts.releaseKey) params.set('releaseKey', opts.releaseKey);
    return whenReady().then(function () {
      return fetch(getApiBase() + '/studio-vault?' + params.toString(), {
        headers: authHeaders()
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.message) || 'vault list failed');
          return data;
        });
      });
    });
  }

  function deleteObject(vaultKey) {
    return whenReady().then(function () {
      return fetch(getApiBase() + '/studio-vault', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({ action: 'delete', vaultKey: vaultKey })
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.message) || 'vault delete failed');
          return data;
        });
      });
    });
  }

  function downloadUrl(vaultKey) {
    return whenReady().then(function () {
      return fetch(
        getApiBase() + '/studio-vault?action=download&vaultKey=' + encodeURIComponent(vaultKey),
        { headers: authHeaders() }
      ).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.message) || 'download url failed');
          return data;
        });
      });
    });
  }

  function status() {
    return whenReady().then(function () {
      return fetch(getApiBase() + '/studio-vault?action=status', { headers: authHeaders() }).then(
        function (res) {
          return res.json().then(function (data) {
            return Object.assign({ ok: res.ok }, data);
          });
        }
      );
    });
  }

  window.BurnfolderVaultUpload = {
    uploadFile: uploadFile,
    requestUploadUrl: requestUploadUrl,
    register: register,
    list: list,
    deleteObject: deleteObject,
    downloadUrl: downloadUrl,
    status: status
  };
})();
