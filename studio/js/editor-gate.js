(function () {
  'use strict';

  const LAST_DRAFT_KEY = 'burnfolderStudioLastDraftId';

  const gate = document.getElementById('studioEditorGate');
  const home = document.getElementById('studioHome');
  const shell = document.getElementById('studioEditorShell');
  const editorNav = document.getElementById('studioEditorNav');
  const statusEl = document.getElementById('studioEditorStatus');
  const draftMeta = document.getElementById('studioDraftMeta');

  window.studioEditorSetStatus = function (message, kind) {
    if (window.BurnfolderStudioStatus) {
      window.BurnfolderStudioStatus.set(statusEl, message, kind);
      return;
    }
    if (statusEl) statusEl.textContent = message || '';
  };

  window.studioEditorRenderMeta = function (row) {
    if (!row || !draftMeta) return;
    draftMeta.textContent = row.date_key + ' · ' + row.status;
    if (typeof window.studioRefreshDraftSelect === 'function') {
      window.studioRefreshDraftSelect(row.id);
    }
  };

  function todayKey() {
    const now = new Date();
    return now.getMonth() + 1 + '.' + now.getDate() + '.' + String(now.getFullYear()).slice(-2);
  }

  function showHome() {
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

  function openEditor(draftId) {
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

    window.installBurnfolderStudioBridge({
      draftId: draftId,
      onStatus: window.studioEditorSetStatus,
      onDraftMeta: window.studioEditorRenderMeta
    });

    if (typeof window.studioInitEditorWorkspace === 'function') {
      window.studioInitEditorWorkspace();
    }
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

  window.studioEditorOpenDraft = openEditor;
  window.studioEditorShowHome = showHome;

  boot();
})();
