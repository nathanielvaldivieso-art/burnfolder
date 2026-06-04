(function () {
  'use strict';

  const statusEl = document.getElementById('filesStatus');
  const uploadRoot = document.getElementById('cloudUploadZone');
  const listRoot = document.getElementById('cloudAssetList');

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || '';
  }

  function refreshList() {
    return window.BurnfolderCloudUI.renderAssetList(listRoot, {
      onStatus: setStatus
    });
  }

  window.BurnfolderCloudUI.mountUploadZone(uploadRoot, {
    onStatus: setStatus,
    onUploaded: function () {
      refreshList();
    }
  });

  window.addEventListener('burnfolder-assets-changed', function () {
    refreshList();
  });

  refreshList();
})();
