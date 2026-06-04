(function () {
  'use strict';

  const DB_NAME = 'burnfolderStudioCloud';
  const DB_VERSION = 2;
  const STORE = 'assets';

  function openDb() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = function () { reject(req.error); };
      req.onupgradeneeded = function (event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('name', 'name');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
    });
  }

  function makeId() {
    return 'asset-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
  }

  function sanitizeFilename(name) {
    const cleaned = String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return cleaned || 'file';
  }

  function suggestPublicPath(name) {
    return 'IMAGES/' + sanitizeFilename(name);
  }

  function defaultDisplayTitle(fileName) {
    const safe = String(fileName || 'untitled');
    const dot = safe.lastIndexOf('.');
    return dot > 0 ? safe.slice(0, dot) : safe;
  }

  function detectKind(file) {
    const name = String(file.name || '').toLowerCase();
    const mime = String(file.type || '').toLowerCase();

    if (mime.indexOf('audio/') === 0 || /\.(wav|mp3|flac|aiff|aif|m4a|ogg)$/.test(name)) return 'audio';
    if (mime.indexOf('video/') === 0 || /\.(mp4|mov|webm|mkv)$/.test(name)) return 'video';
    if (mime.indexOf('image/') === 0 || /\.(jpg|jpeg|png|gif|webp)$/.test(name)) return 'image';
    if (/session|stem|logicx|band|ptx|als|flp|zip|rar/.test(name)) return 'session';
    return 'other';
  }

  function isMuxableFile(file) {
    const kind = detectKind(file);
    return kind === 'audio' || kind === 'video';
  }

  function isMuxableAsset(asset) {
    return asset && (asset.kind === 'audio' || asset.kind === 'video');
  }

  function mapAssetRow(row) {
    return {
      id: row.id,
      name: row.name,
      mime: row.mime,
      size: row.size,
      createdAt: row.createdAt,
      publicPath: row.publicPath,
      kind: row.kind || 'other',
      displayTitle: row.displayTitle || defaultDisplayTitle(row.name),
      notes: row.notes || '',
      muxPassthrough: row.muxPassthrough || null,
      muxPlaybackId: row.muxPlaybackId || null,
      muxAssetId: row.muxAssetId || null,
      hasCover: Boolean(row.coverBlob)
    };
  }

  function emitAssetsChanged(detail) {
    try {
      window.dispatchEvent(
        new CustomEvent('burnfolder-assets-changed', { detail: detail || {} })
      );
    } catch (e) {
      /* CustomEvent unsupported */
    }
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function putRecord(db, record) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = function () { resolve(record); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function muxProgressToPhase(pct, message) {
    const m = String(message || '').toLowerCase();
    if (m.indexOf('ready') >= 0 || pct >= 100) return 'ready';
    if (m.indexOf('upload') >= 0) return 'uploading';
    if (m.indexOf('process') >= 0) return 'processing';
    return 'processing';
  }

  function uploadToMuxAndRegister(db, file, onProgress) {
    if (!isMuxableFile(file)) {
      return Promise.reject(
        new Error('only audio and video upload to mux (not images or project files)')
      );
    }

    if (!window.BurnfolderMux || !window.BurnfolderMux.uploadFileToMux) {
      return Promise.reject(new Error('mux unavailable — run netlify dev from the repo root'));
    }

    const record = {
      id: makeId(),
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      createdAt: new Date().toISOString(),
      publicPath: suggestPublicPath(file.name),
      kind: detectKind(file),
      displayTitle: defaultDisplayTitle(file.name),
      notes: ''
    };

    if (onProgress) onProgress(5, 'starting');

    return window.BurnfolderMux
      .uploadFileToMux(file, {
        fileName: file.name,
        onProgress: function (patch) {
          if (!onProgress) return;
          onProgress(patch.percent || 0, muxProgressToPhase(patch.percent, patch.message));
        }
      })
      .then(function (result) {
        record.muxPlaybackId = result.playbackId;
        record.muxPassthrough = result.passthrough;
        record.muxAssetId = result.assetId;
        record.muxUploadId = result.uploadId;

        if (onProgress) onProgress(100, 'done');

        return putRecord(db, record).then(function (saved) {
          const mapped = mapAssetRow(saved);
          emitAssetsChanged({ type: 'add', asset: mapped });
          return mapped;
        });
      });
  }

  function addFiles(fileList, callbacks) {
    const files = Array.from(fileList || []);
    const cbs = callbacks || {};
    if (!files.length) return Promise.resolve([]);

    return openDb().then(function (db) {
      const results = [];
      let chain = Promise.resolve();

      files.forEach(function (file, index) {
        chain = chain.then(function () {
          if (cbs.onFileStart) cbs.onFileStart(file, index, files.length);

          return uploadToMuxAndRegister(db, file, function (pct, phase) {
            if (cbs.onProgress) cbs.onProgress(file, pct, phase, index, files.length);
          })
            .then(function (saved) {
              results.push(saved);
              if (cbs.onFileSuccess) cbs.onFileSuccess(saved, index, files.length);
              return saved;
            })
            .catch(function (err) {
              if (cbs.onFileError) cbs.onFileError(file, err, index, files.length);
              return null;
            });
        });
      });

      return chain.then(function () {
        db.close();
        return results.filter(Boolean);
      });
    });
  }

  function listAssets() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () {
          db.close();
          const rows = (req.result || [])
            .filter(function (row) {
              return row.muxPlaybackId;
            })
            .map(mapAssetRow);
          rows.sort(function (a, b) {
            return new Date(b.createdAt) - new Date(a.createdAt);
          });
          resolve(rows);
        };
        req.onerror = function () {
          db.close();
          reject(req.error);
        };
      });
    });
  }

  function getAsset(id) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = function () {
          db.close();
          resolve(req.result || null);
        };
        req.onerror = function () {
          db.close();
          reject(req.error);
        };
      });
    });
  }

  function getBlobUrl(id) {
    const assetId = String(id || '').trim();
    if (!assetId) return Promise.resolve(null);

    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(assetId);
        req.onsuccess = function () {
          db.close();
          const row = req.result;
          if (!row || !row.blob) {
            resolve(null);
            return;
          }
          resolve(URL.createObjectURL(row.blob));
        };
        req.onerror = function () {
          db.close();
          reject(req.error);
        };
      });
    });
  }

  function registerImageFile(file) {
    if (!file || detectKind(file) !== 'image') {
      return Promise.reject(new Error('choose an image file (jpg, png, webp, gif)'));
    }

    return openDb().then(function (db) {
      const record = {
        id: makeId(),
        name: file.name,
        mime: file.type || 'image/jpeg',
        size: file.size,
        createdAt: new Date().toISOString(),
        publicPath: suggestPublicPath(file.name),
        kind: 'image',
        displayTitle: defaultDisplayTitle(file.name),
        notes: '',
        blob: file
      };

      return putRecord(db, record).then(function (saved) {
        db.close();
        const mapped = mapAssetRow(saved);
        mapped.blob = saved.blob;
        emitAssetsChanged({ type: 'add', asset: mapped });
        return mapped;
      });
    });
  }

  function getCoverBlobUrl(id) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = function () {
          db.close();
          const row = req.result;
          if (!row || !row.coverBlob) {
            resolve(null);
            return;
          }
          resolve(URL.createObjectURL(row.coverBlob));
        };
        req.onerror = function () {
          db.close();
          reject(req.error);
        };
      });
    });
  }

  function listStreamable() {
    return listAssets();
  }

  function updateAsset(id, patch) {
    return getAsset(id).then(function (row) {
      if (!row) throw new Error('file not found');
      const next = Object.assign({}, row, patch || {}, { id: row.id });
      delete next.blob;
      return openDb().then(function (db) {
        return putRecord(db, next).then(function (saved) {
          db.close();
          emitAssetsChanged({ type: 'update', asset: mapAssetRow(saved) });
          return saved;
        });
      });
    });
  }

  function deleteByMuxAssetId(muxAssetId) {
    const target = String(muxAssetId || '').trim();
    if (!target) return Promise.resolve(0);

    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () {
          db.close();
          const rows = req.result || [];
          const matches = rows.filter(function (row) {
            return row.muxAssetId === target || row.muxPlaybackId === target;
          });
          let chain = Promise.resolve();
          matches.forEach(function (row) {
            chain = chain.then(function () {
              return deleteAsset(row.id);
            });
          });
          chain.then(function () {
            resolve(matches.length);
          }).catch(reject);
        };
        req.onerror = function () {
          db.close();
          reject(req.error);
        };
      });
    });
  }

  function deleteAsset(id) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () {
          db.close();
          emitAssetsChanged({ type: 'delete', assetId: id });
          resolve();
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
      });
    });
  }

  function downloadAsset(id) {
    return getAsset(id).then(function (row) {
      if (!row) throw new Error('file not found');
      if (row.muxPlaybackId) {
        window.open('https://stream.mux.com/' + row.muxPlaybackId + '.m3u8', '_blank');
        return row;
      }
      throw new Error('file is on mux only — no local download');
    });
  }

  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value);
    }
    const temp = document.createElement('textarea');
    temp.value = value;
    temp.style.position = 'fixed';
    temp.style.left = '-9999px';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();
    document.execCommand('copy');
    temp.remove();
    return Promise.resolve();
  }

  window.BurnfolderAssetCloud = {
    addFiles: addFiles,
    registerImageFile: registerImageFile,
    listAssets: listAssets,
    getAsset: getAsset,
    updateAsset: updateAsset,
    getBlobUrl: getBlobUrl,
    getCoverBlobUrl: getCoverBlobUrl,
    listStreamable: listStreamable,
    detectKind: detectKind,
    isMuxableFile: isMuxableFile,
    isMuxableAsset: isMuxableAsset,
    defaultDisplayTitle: defaultDisplayTitle,
    deleteAsset: deleteAsset,
    deleteByMuxAssetId: deleteByMuxAssetId,
    downloadAsset: downloadAsset,
    copyText: copyText,
    suggestPublicPath: suggestPublicPath,
    formatBytes: formatBytes,
    emitAssetsChanged: emitAssetsChanged
  };
})();
