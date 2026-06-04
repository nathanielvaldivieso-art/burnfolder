(function () {
  'use strict';

  if (!window.studioEditorReady) return;

  const panel = document.getElementById('studioEditorCloud');
  const uploadRoot = document.getElementById('editorCloudUpload');
  const listRoot = document.getElementById('editorCloudList');
  if (!panel || !uploadRoot || !listRoot) return;

  let lastFocusedInput = null;

  document.addEventListener(
    'focusin',
    function (event) {
      const target = event.target;
      if (target && target.matches && target.matches('.entry-editor-field input, .entry-editor-field textarea')) {
        lastFocusedInput = target;
      }
    },
    true
  );

  function setStatus(msg) {
    if (window.studioEditorSetStatus) window.studioEditorSetStatus(msg);
  }

  function insertIntoFocused(value, label) {
    if (lastFocusedInput) {
      lastFocusedInput.value = value;
      lastFocusedInput.dispatchEvent(new Event('input', { bubbles: true }));
      setStatus('inserted ' + label);
      return true;
    }
    return false;
  }

  function insertPath(publicPath) {
    if (insertIntoFocused(publicPath, publicPath)) return;
    window.BurnfolderAssetCloud.copyText(publicPath).then(function () {
      setStatus('copied ' + publicPath + ' (focus a field to insert)');
    });
  }

  function insertPlaybackId(playbackId, asset) {
    const muxLabel = (asset && asset.muxPassthrough) || (asset && asset.name) || '';

    if (window.BurnfolderMux && window.BurnfolderMux.insertMuxIntoEditor) {
      if (window.BurnfolderMux.insertMuxIntoEditor(playbackId, muxLabel, lastFocusedInput)) {
        setStatus('inserted ' + muxLabel + ' into entry');
        return;
      }
    }

    if (insertIntoFocused(playbackId, 'playback id')) return;
    window.BurnfolderAssetCloud.copyText(playbackId).then(function () {
      setStatus('copied playback id (focus audio/video block to insert)');
    });
  }

  function refreshList() {
    return window.BurnfolderCloudUI.renderAssetList(listRoot, {
      compact: true,
      onStatus: setStatus,
      onSelectPath: insertPath,
      onInsertPlaybackId: insertPlaybackId
    });
  }

  window.BurnfolderCloudUI.mountUploadZone(uploadRoot, {
    onStatus: setStatus,
    onFileSuccess: function () {
      refreshList();
    },
    onUploaded: function () {
      refreshList();
    }
  });

  refreshList();
})();
