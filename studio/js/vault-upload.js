/**
 * R2 vault uploads via studio-vault Netlify function.
 * File bytes are proxied through the function (single put or multipart) so the
 * browser never PUTs to R2 directly — that path needs bucket CORS and Safari
 * reports it as "Load failed".
 * Sessions/stems/refs and image/press/epk auto-register into Blob manifests.
 */
(function () {
  'use strict';

  const PROJECT_KINDS = { session: 1, stem: 1, ref: 1 };
  const IMAGE_KINDS = { image: 1, press: 1, epk: 1 };
  /** Under Netlify ~6MB body limit; also S3 multipart non-final part minimum. */
  const PROXY_PART_BYTES = 5 * 1024 * 1024;

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

  function vaultPostJson(body) {
    return whenReady().then(function () {
      return fetch(getApiBase() + '/studio-vault', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.message) || 'vault request failed');
          return data;
        });
      });
    });
  }

  function vaultPostBinary(query, blob, contentType, onProgress) {
    const params = new URLSearchParams();
    Object.keys(query || {}).forEach(function (key) {
      const value = query[key];
      if (value == null || value === '') return;
      params.set(key, String(value));
    });
    return whenReady().then(function () {
      return new Promise(function (resolve, reject) {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', getApiBase() + '/studio-vault?' + params.toString());
        const headers = Object.assign(
          { 'Content-Type': contentType || 'application/octet-stream' },
          authHeaders()
        );
        Object.keys(headers).forEach(function (key) {
          xhr.setRequestHeader(key, headers[key]);
        });
        xhr.upload.onprogress = function (event) {
          if (!onProgress || !event.lengthComputable || !event.total) return;
          onProgress(Math.round((event.loaded / event.total) * 100), 'uploading');
        };
        xhr.onload = function () {
          let data = {};
          try {
            data = JSON.parse(xhr.responseText || '{}');
          } catch (err) {
            data = {};
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
            return;
          }
          reject(new Error((data && data.message) || 'vault request failed'));
        };
        xhr.onerror = function () {
          reject(new Error('vault request failed'));
        };
        xhr.send(blob);
      });
    });
  }

  function requestUploadUrl(options) {
    const opts = options || {};
    return vaultPostJson({
      action: 'upload-url',
      kind: opts.kind || 'master',
      fileName: opts.fileName,
      contentType: opts.contentType || 'application/octet-stream',
      trackKey: opts.trackKey,
      releaseKey: opts.releaseKey,
      songGroupKey: opts.songGroupKey,
      folderKey: opts.folderKey
    });
  }

  function register(meta) {
    const opts = meta || {};
    return vaultPostJson({
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
    });
  }

  function reportProgress(opts, pct, phase) {
    if (opts && typeof opts.onProgress === 'function') {
      opts.onProgress(pct, phase);
    }
  }

  function proxyPutFile(file, opts, contentType) {
    reportProgress(opts, 5, 'starting');
    return vaultPostBinary(
      {
        action: 'put',
        kind: opts.kind || 'master',
        fileName: file.name,
        contentType: contentType,
        trackKey: opts.trackKey,
        releaseKey: opts.releaseKey,
        songGroupKey: opts.songGroupKey,
        folderKey: opts.folderKey
      },
      file,
      contentType,
      function (pct) {
        reportProgress(opts, Math.max(5, Math.min(95, pct)), 'uploading');
      }
    ).then(function (data) {
      reportProgress(opts, 100, 'done');
      return data;
    });
  }

  function proxyMultipartFile(file, opts, contentType) {
    let uploadId = '';
    let vaultKey = '';
    const parts = [];
    const totalParts = Math.max(1, Math.ceil(file.size / PROXY_PART_BYTES));
    reportProgress(opts, 3, 'starting');
    return vaultPostJson({
      action: 'multipart-init',
      kind: opts.kind || 'master',
      fileName: file.name,
      contentType: contentType,
      trackKey: opts.trackKey,
      releaseKey: opts.releaseKey,
      songGroupKey: opts.songGroupKey,
      folderKey: opts.folderKey
    })
      .then(function (init) {
        uploadId = init.uploadId;
        vaultKey = init.vaultKey;
        let offset = 0;
        let partNumber = 1;
        let chain = Promise.resolve();
        while (offset < file.size) {
          (function (start, end, num) {
            chain = chain.then(function () {
              const basePct = Math.round(((num - 1) / totalParts) * 90) + 5;
              reportProgress(opts, basePct, 'uploading');
              return vaultPostBinary(
                {
                  action: 'multipart-part',
                  vaultKey: vaultKey,
                  uploadId: uploadId,
                  partNumber: num
                },
                file.slice(start, end),
                'application/octet-stream',
                function (partPct) {
                  const span = 90 / totalParts;
                  reportProgress(
                    opts,
                    Math.round(basePct + (partPct / 100) * span),
                    'uploading'
                  );
                }
              ).then(function (part) {
                parts.push({ partNumber: num, etag: part.etag });
                reportProgress(opts, Math.round((num / totalParts) * 90) + 5, 'uploading');
              });
            });
          })(offset, Math.min(offset + PROXY_PART_BYTES, file.size), partNumber);
          offset += PROXY_PART_BYTES;
          partNumber += 1;
        }
        return chain;
      })
      .then(function () {
        reportProgress(opts, 96, 'finishing');
        return vaultPostJson({
          action: 'multipart-complete',
          vaultKey: vaultKey,
          uploadId: uploadId,
          parts: parts
        });
      })
      .then(function () {
        reportProgress(opts, 100, 'done');
        return { vaultKey: vaultKey, contentType: contentType, size: file.size };
      })
      .catch(function (err) {
        if (uploadId && vaultKey) {
          return vaultPostJson({
            action: 'multipart-abort',
            vaultKey: vaultKey,
            uploadId: uploadId
          })
            .catch(function () {
              /* best-effort abort */
            })
            .then(function () {
              throw err;
            });
        }
        throw err;
      });
  }

  function uploadViaPresignedPut(file, opts, contentType) {
    return requestUploadUrl({
      kind: opts.kind || 'master',
      fileName: file.name,
      contentType: contentType,
      trackKey: opts.trackKey,
      releaseKey: opts.releaseKey,
      songGroupKey: opts.songGroupKey,
      folderKey: opts.folderKey
    }).then(function (signed) {
      if (!signed || !signed.uploadUrl) {
        return Promise.reject(new Error('vault upload-url missing uploadUrl'));
      }
      return fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file
      })
        .then(function (res) {
          if (!res.ok) throw new Error('R2 upload failed (' + res.status + ')');
          return {
            vaultKey: signed.vaultKey,
            contentType: contentType,
            size: file.size
          };
        })
        .catch(function (err) {
          const msg = (err && err.message) || '';
          if (
            err &&
            err.name === 'TypeError' &&
            (/load failed/i.test(msg) || /failed to fetch/i.test(msg) || /networkerror/i.test(msg))
          ) {
            throw new Error(
              'R2 upload blocked (CORS/network). Set bucket CORS in Cloudflare R2, or omit directPut to use the proxy upload.'
            );
          }
          throw err;
        });
    });
  }

  /**
   * Prefer Netlify-proxied upload (no R2 CORS). Pass options.directPut === true
   * to use a browser PUT to a presigned R2 URL instead.
   */
  function uploadFile(file, options) {
    if (!file) return Promise.reject(new Error('file required'));
    const opts = options || {};
    const kind = opts.kind || 'master';
    const contentType = file.type || opts.contentType || 'application/octet-stream';

    const uploadPromise =
      opts.directPut === true
        ? uploadViaPresignedPut(file, opts, contentType)
        : file.size <= PROXY_PART_BYTES
          ? proxyPutFile(file, opts, contentType)
          : proxyMultipartFile(file, opts, contentType);

    return uploadPromise.then(function (signed) {
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
    return vaultPostJson({ action: 'delete', vaultKey: vaultKey });
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
