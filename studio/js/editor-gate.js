(function () {
  'use strict';

  const LAST_DRAFT_KEY = 'burnfolderStudioLastDraftId';

  let gate = null;
  let home = null;
  let shell = null;
  let editorNav = null;

  function refreshDom() {
    gate = document.getElementById('studioEditorGate');
    home = document.getElementById('studioHome');
    shell = document.getElementById('studioEditorShell');
    editorNav = document.getElementById('studioEditorNav');
  }

  refreshDom();

  window.studioEditorSetStatus = function (message, kind) {
    const statusEl = document.getElementById('studioEditorStatus');
    if (window.BurnfolderStudioStatus) {
      window.BurnfolderStudioStatus.set(statusEl, message, kind);
      return;
    }
    if (statusEl) statusEl.textContent = message || '';
  };

  window.studioEditorRenderMeta = function (row) {
    const draftMeta = document.getElementById('studioDraftMeta');
    if (!row || !draftMeta) return;
    draftMeta.textContent = row.date_key + ' · ' + row.status;
    if (typeof window.studioRefreshDraftSelect === 'function') {
      window.studioRefreshDraftSelect(row.id);
    }
  };

  function showHome() {
    refreshDom();
    if (gate) {
      gate.hidden = true;
    }
    if (home) home.hidden = false;
    if (shell) shell.hidden = true;
    if (editorNav) editorNav.hidden = true;
    window.studioEditorReady = false;
    window.studioEditorDraftId = null;

    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      link.classList.toggle('is-active', link.getAttribute('data-nav') === 'entry');
    });
  }

  function mountEditor(draftId) {
    window.installBurnfolderStudioBridge({
      draftId: draftId,
      onStatus: window.studioEditorSetStatus,
      onDraftMeta: window.studioEditorRenderMeta
    });

    if (typeof window.studioInitEntryEditorDom === 'function') {
      window.studioInitEntryEditorDom();
    }

    if (typeof window.studioReloadEntryDraft === 'function') {
      window.studioReloadEntryDraft();
    }

    if (typeof window.studioInitEditorWorkspace === 'function') {
      window.studioInitEditorWorkspace();
    }

    if (typeof window.studioInitEditorPost === 'function') {
      window.studioInitEditorPost();
    }
  }

  function loadEditorBundle() {
    if (typeof window.studioLoadEditorBundle === 'function') {
      return window.studioLoadEditorBundle();
    }
    return Promise.resolve();
  }

  function openEditor(draftId) {
    refreshDom();
    const alreadyOpen =
      window.studioEditorReady &&
      window.studioEditorDraftId === draftId &&
      shell &&
      !shell.hidden;
    if (alreadyOpen) return;

    window.localStorage.setItem(LAST_DRAFT_KEY, draftId);
    if (gate) gate.hidden = true;
    if (home) home.hidden = true;
    if (shell) shell.hidden = false;
    if (editorNav) editorNav.hidden = false;
    window.studioEditorReady = true;
    window.studioEditorDraftId = draftId;

    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      link.classList.toggle('is-active', link.getAttribute('data-nav') === 'entry');
    });

    window.studioEditorSetStatus('loading editor…', 'working');

    loadEditorBundle()
      .then(function () {
        mountEditor(draftId);
      })
      .catch(function (err) {
        window.studioEditorSetStatus((err && err.message) || 'could not load editor', 'error');
      });
  }

  function boot() {
    const params = new URLSearchParams(window.location.search);
    const draftId = params.get('id');

    if (draftId) {
      openEditor(draftId);
      return;
    }

    showHome();
  }

  if (!window.__studioDraftSyncBound) {
    window.__studioDraftSyncBound = true;
    window.addEventListener('burnfolder-drafts-synced', function () {
      if (!window.studioEditorReady || !window.studioEditorDraftId) return;
      window.studioEditorSetStatus('drafts synced from cloud — reload if another device edited', 'warning');
    });
  }

  window.studioInitEditorGate = boot;
  window.studioEditorOpenDraft = openEditor;
  window.studioEditorShowHome = showHome;

  if (document.getElementById('studioHome')) {
    boot();
  }
})();
