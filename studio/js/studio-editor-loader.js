(function () {
  'use strict';

  var EDITOR_SCRIPTS = [
    '../entries.js',
    '../entry-renderer.js',
    '../songs.js',
    '../shared/song-versions.js',
    '../shared/mux-display-name.js',
    'js/asset-cloud.js',
    '../shared/cover-art.js',
    'js/mux-naming.js',
    'js/mux-client.js',
    'js/studio-mux-lib.js',
    'js/stream-shared.js',
    '../shared/playback-context.js',
    '../shared/version-picker.js',
    '../stripe-publishable.js',
    '../shared/playback-prefetch.js',
    '../shared/mux-playback.js',
    'js/studio-scripts-bridge.js',
    '../scripts.js',
    '../entry-editor.js',
    'js/publish-panel.js',
    'js/editor-post.js',
    'js/upload-queue.js',
    'js/cloud-ui.js',
    'js/editor-library-panel.js',
    'js/editor-workspace.js'
  ];

  var loadPromise = null;

  function versionQuery() {
    var v = window.BurnfolderStudioVersion || '20260626d';
    return '?v=' + v;
  }

  function scriptKey(src) {
    return src.split('?')[0];
  }

  function loadOne(src) {
    var clean = scriptKey(src);
    if (window.__studioEditorLoadedScripts && window.__studioEditorLoadedScripts[clean]) {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src.indexOf('?') > -1 ? src : src + versionQuery();
      script.onload = function () {
        if (!window.__studioEditorLoadedScripts) window.__studioEditorLoadedScripts = {};
        window.__studioEditorLoadedScripts[clean] = true;
        resolve();
      };
      script.onerror = function () {
        reject(new Error('failed to load ' + clean));
      };
      document.body.appendChild(script);
    });
  }

  window.studioLoadEditorBundle = function () {
    if (window.__studioEditorBundleLoaded) return Promise.resolve();
    if (loadPromise) return loadPromise;

    loadPromise = EDITOR_SCRIPTS.reduce(function (chain, src) {
      return chain.then(function () {
        return loadOne(src);
      });
    }, Promise.resolve()).then(function () {
      window.__studioEditorBundleLoaded = true;
      window.__studioBlockEditorLoaded = true;
    });

    return loadPromise;
  };
})();
