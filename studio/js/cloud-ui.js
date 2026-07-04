(function () {
  'use strict';

  const cloud = window.BurnfolderAssetCloud;

  const MUX_ACCEPT =
    'audio/*,video/*,.wav,.mp3,.flac,.aiff,.aif,.m4a,.ogg,.mp4,.mov,.webm,.mkv';

  window.BurnfolderCloudUI = {
    mountUploadZone: function (root, opts) {
      if (!root || !cloud) return;
      if (root.dataset.uploadZoneBound === '1') return;
      root.dataset.uploadZoneBound = '1';

      const options = opts || {};
      const onStatus = options.onStatus || function () {};
      const onUploaded = options.onUploaded || function () {};

      root.classList.add('studio-cloud-drop');

      const queueHost =
        document.getElementById('studioUploadQueue') ||
        document.getElementById('editorUploadQueue') ||
        (function () {
          const el = document.createElement('div');
          el.className = 'studio-upload-queue-host';
          root.insertAdjacentElement('afterend', el);
          return el;
        })();

      const queue = window.BurnfolderUploadQueue
        ? window.BurnfolderUploadQueue.attach(queueHost)
        : { add: function () { return ''; }, update: function () {}, remove: function () {} };

      const rowIds = new Map();

      root.innerHTML =
        '<span class="studio-cloud-drop-mark" aria-hidden="true">+</span>' +
        '<p class="studio-cloud-drop-label">drop files or choose</p>' +
        '<button type="button" class="studio-cloud-choose">choose files</button>' +
        '<p class="studio-cloud-drop-hint">audio &amp; video · mp3, wav, m4a, mp4, mov…<br>uploads publish straight to your mux library</p>' +
        '<input type="file" class="studio-cloud-file-input" multiple accept="' +
        MUX_ACCEPT +
        '">';

      const input = root.querySelector('.studio-cloud-file-input');
      const chooseBtn = root.querySelector('.studio-cloud-choose');
      if (chooseBtn) {
        chooseBtn.addEventListener('click', function (event) {
          event.stopPropagation();
          input.click();
        });
      }

      function handleFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;

        function runUpload() {
          const total = files.length;
          let ok = 0;
          let fail = 0;
          const addedAssets = [];

          function addedSoFar(latest) {
            if (latest) addedAssets.push(latest);
            return addedAssets.slice();
          }

          function progressStatus() {
            const done = ok + fail;
            if (done >= total) return;
            onStatus('uploading ' + (done + 1) + ' of ' + total + '…');
          }

          onStatus(
            total === 1 ? 'uploading 1 file…' : 'uploading ' + total + ' files…'
          );

          files.forEach(function (file) {
            rowIds.set(file, queue.add(file));
          });

          cloud
            .addFiles(files, {
              fileMeta: function () {
                const keyFn = options.getContributionDateKey;
                const key = typeof keyFn === 'function' ? keyFn() : '';
                return key ? { contributionDateKey: key } : null;
              },
              onProgress: function (file, pct, phase) {
                const id = rowIds.get(file);
                queue.update(id, {
                  percent: pct,
                  status: 'working',
                  phase: phase,
                  message: phase + ' ' + pct + '%'
                });
              },
              onFileSuccess: function (asset, index) {
                ok += 1;
                const id = rowIds.get(files[index]);
                queue.update(id, {
                  percent: 100,
                  status: 'success',
                  message: 'ready ✓'
                });
                queue.remove(id, 1400);
                if (options.onFileSuccess) options.onFileSuccess(asset);
                onUploaded(addedSoFar(asset));
                progressStatus();
              },
              onFileError: function (file, err) {
                fail += 1;
                const id = rowIds.get(file);
                queue.update(id, {
                  percent: 100,
                  status: 'error',
                  message: err.message || 'failed'
                });
                queue.remove(id, 8000);
                progressStatus();
              }
            })
            .then(function (added) {
              onStatus(
                fail
                  ? ok + ' added, ' + fail + ' failed'
                  : total === 1
                    ? 'added to library'
                    : ok + ' added to library'
              );
              onUploaded(added);
              if (cloud.emitAssetsChanged) {
                cloud.emitAssetsChanged({ type: 'batch', count: added.length });
              }
            })
            .catch(function (err) {
              onStatus(err.message || 'upload failed');
            });
        }

        if (window.BurnfolderStudioAuth && window.BurnfolderStudioAuth.whenReady) {
          window.BurnfolderStudioAuth.whenReady().then(runUpload);
          return;
        }
        runUpload();
      }

      root.addEventListener('click', function (event) {
        if (event.target.closest('button')) return;
        input.click();
      });

      input.addEventListener('change', function () {
        handleFiles(input.files);
        input.value = '';
      });

      root.addEventListener('dragover', function (event) {
        event.preventDefault();
        root.classList.add('is-dragover');
      });

      root.addEventListener('dragleave', function () {
        root.classList.remove('is-dragover');
      });

      root.addEventListener('drop', function (event) {
        event.preventDefault();
        root.classList.remove('is-dragover');
        handleFiles(event.dataTransfer.files);
      });
    }
  };
})();
