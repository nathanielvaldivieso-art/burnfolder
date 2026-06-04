(function () {
  'use strict';

  const naming = window.BurnfolderMuxNaming;

  function getMuxApiBase() {
    const cfg = window.BurnfolderStudioConfig || {};
    if (cfg.muxApiBase) return String(cfg.muxApiBase).replace(/\/$/, '');

    if (location.port === '8888' || location.hostname.endsWith('.netlify.app')) {
      return '/.netlify/functions';
    }

    return 'http://localhost:8888/.netlify/functions';
  }

  function parseJson(res) {
    return res.json().catch(function () {
      return {};
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function reservedPassthroughsFromCloud(excludeAssetId) {
    const cloud = window.BurnfolderAssetCloud;
    if (!cloud) return Promise.resolve([]);
    return cloud.listAssets().then(function (assets) {
      return assets
        .filter(function (a) {
          return !excludeAssetId || a.id !== excludeAssetId;
        })
        .map(function (a) {
          if (a.muxPassthrough) return a.muxPassthrough;
          return naming ? naming.sanitizeFileName(a.name) : a.name;
        })
        .filter(Boolean);
    });
  }

  function reportProgress(options, patch) {
    if (options.onProgress) options.onProgress(patch);
  }

  function xhrPutFile(url, file, options, phaseLabel) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

      xhr.upload.onprogress = function (event) {
        if (!event.lengthComputable) return;
        const pct = 15 + Math.round((event.loaded / event.total) * 55);
        reportProgress(options, {
          percent: pct,
          status: 'working',
          phase: phaseLabel,
          message: phaseLabel + ' ' + pct + '%'
        });
      };

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        reject(new Error('mux file upload failed (' + xhr.status + ')'));
      };

      xhr.onerror = function () {
        reject(new Error('mux file upload failed'));
      };

      xhr.send(file);
    });
  }

  function uploadFileToMux(file, opts) {
    const options = opts || {};
    const onStatus = options.onStatus || function () {};
    const base = getMuxApiBase();
    const fileName = options.fileName || file.name || 'file';

    onStatus('requesting mux upload…');
    reportProgress(options, {
      percent: 5,
      status: 'working',
      message: 'starting mux upload…'
    });

    return reservedPassthroughsFromCloud(options.excludeAssetId)
      .then(function (reserved) {
        return fetch(base + '/mux-create-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            corsOrigin: window.location.origin,
            fileName: fileName,
            reservedPassthroughs: reserved
          })
        });
      })
      .then(function (res) {
        return parseJson(res).then(function (data) {
          if (!res.ok) throw new Error(data.message || 'could not start mux upload');
          return data;
        });
      })
      .then(function (created) {
        onStatus('uploading to mux as ' + (created.passthrough || fileName) + '…');
        return xhrPutFile(created.uploadUrl, file, options, 'uploading').then(function () {
          return {
            uploadId: created.uploadId,
            passthrough: created.passthrough || fileName
          };
        });
      })
      .then(function (started) {
        onStatus('processing on mux…');
        reportProgress(options, {
          percent: 75,
          status: 'working',
          message: 'processing on mux…'
        });

        const maxAttempts = 120;
        let attempt = 0;

        function pollDelayMs(n) {
          if (n <= 5) return 350;
          if (n <= 15) return 600;
          return 1200;
        }

        function poll() {
          attempt += 1;
          const pct = 75 + Math.min(24, Math.round((attempt / maxAttempts) * 24));
          reportProgress(options, {
            percent: pct,
            status: 'working',
            message: 'processing…'
          });

          return fetch(base + '/mux-upload-status?uploadId=' + encodeURIComponent(started.uploadId))
            .then(function (res) {
              return parseJson(res).then(function (data) {
                if (!res.ok) throw new Error(data.message || 'mux status failed');
                return data;
              });
            })
            .then(function (data) {
              if (data.error) throw new Error(data.error.message || 'mux processing error');
              if (data.playbackId) {
                onStatus('mux ready: ' + started.passthrough);
                reportProgress(options, {
                  percent: 100,
                  status: 'success',
                  message: 'mux ready'
                });
                return {
                  uploadId: started.uploadId,
                  assetId: data.assetId,
                  playbackId: data.playbackId,
                  passthrough: started.passthrough,
                  muxLabel: started.passthrough
                };
              }
              if (data.status === 'errored' || data.status === 'cancelled') {
                throw new Error('mux upload ' + data.status);
              }
              if (attempt >= maxAttempts) throw new Error('mux processing timed out');
              return delay(pollDelayMs(attempt)).then(poll);
            });
        }

        return poll();
      })
      .catch(function (err) {
        reportProgress(options, {
          percent: 100,
          status: 'error',
          message: err.message || 'mux failed'
        });
        throw err;
      });
  }

  function fillMuxIntoBlock(card, playbackId, muxLabel) {
    if (!card) return false;

    const inputs = card.querySelectorAll('.entry-block-fields .entry-editor-field input');
    if (!inputs.length) return false;

    const type = card.dataset.blockType || '';
    const trackTitle = naming ? naming.titleFromMuxFileName(muxLabel) : muxLabel;

    if (type === 'video') {
      if (inputs[0]) {
        inputs[0].value = playbackId;
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (inputs[1]) {
        inputs[1].value = trackTitle;
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      if (inputs[0]) {
        inputs[0].value = trackTitle;
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (inputs[1]) {
        inputs[1].value = playbackId;
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    return true;
  }

  function insertMuxIntoEditor(playbackId, muxLabel, lastFocusedInput) {
    if (lastFocusedInput) {
      const card = lastFocusedInput.closest('.entry-block-card');
      if (card && fillMuxIntoBlock(card, playbackId, muxLabel)) return true;
    }

    const blocks = document.querySelectorAll('#entryBlocks .entry-block-card');
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const type = blocks[i].dataset.blockType;
      if (type === 'audio' || type === 'video') {
        if (fillMuxIntoBlock(blocks[i], playbackId, muxLabel)) return true;
      }
    }

    return false;
  }

  function listMuxAssets() {
    const base = getMuxApiBase();
    return fetch(base + '/mux-list-assets')
      .then(function (res) {
        return parseJson(res).then(function (data) {
          if (!res.ok) throw new Error(data.message || 'could not list mux files');
          return Array.isArray(data.assets) ? data.assets : [];
        });
      });
  }

  function deleteMuxAsset(muxAssetId) {
    const base = getMuxApiBase();
    return fetch(base + '/mux-delete-asset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: muxAssetId })
    }).then(function (res) {
      return parseJson(res).then(function (data) {
        if (!res.ok) throw new Error(data.message || 'could not delete mux file');
        return data;
      });
    });
  }

  window.BurnfolderMux = {
    getMuxApiBase: getMuxApiBase,
    uploadFileToMux: uploadFileToMux,
    listMuxAssets: listMuxAssets,
    deleteMuxAsset: deleteMuxAsset,
    insertMuxIntoEditor: insertMuxIntoEditor
  };
})();
