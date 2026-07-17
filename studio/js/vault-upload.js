/**
 * R2 master vault uploads via studio-vault Netlify function (presigned PUT).
 */
(function () {
  'use strict';

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
          songGroupKey: opts.songGroupKey
        })
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.message) || 'vault upload-url failed');
          return data;
        });
      });
    });
  }

  function uploadFile(file, options) {
    if (!file) return Promise.reject(new Error('file required'));
    const opts = options || {};
    const contentType = file.type || opts.contentType || 'application/octet-stream';
    return requestUploadUrl({
      kind: opts.kind || 'master',
      fileName: file.name,
      contentType: contentType,
      trackKey: opts.trackKey,
      releaseKey: opts.releaseKey,
      songGroupKey: opts.songGroupKey
    }).then(function (signed) {
      return fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file
      }).then(function (res) {
        if (!res.ok) throw new Error('R2 upload failed (' + res.status + ')');
        return {
          vaultKey: signed.vaultKey,
          fileName: file.name,
          size: file.size,
          contentType: contentType,
          kind: opts.kind || 'master'
        };
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
    downloadUrl: downloadUrl,
    status: status
  };
})();
