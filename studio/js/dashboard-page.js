(function () {
  'use strict';

  function whenReady() {
    if (window.BurnfolderStudioAuth && window.BurnfolderStudioAuth.whenReady) {
      return window.BurnfolderStudioAuth.whenReady();
    }
    return Promise.resolve();
  }

  function apiBase() {
    const auth = window.BurnfolderStudioAuth;
    return auth && auth.getApiBase ? auth.getApiBase() : '/.netlify/functions';
  }

  function bindOwnerMeta() {
    const auth = window.BurnfolderStudioAuth;
    if (!auth || auth.getAuthMode() !== 'supabase') return;

    const meta = document.getElementById('dashboardWorkspaceMeta');
    const session = auth.getSession();
    if (meta && session && session.accessMode === 'owner') {
      meta.textContent = (session.name || session.slug || 'workspace') + ' · owner';
      meta.hidden = false;
    }

    const ownerTools = document.getElementById('ownerToolsSection');
    if (ownerTools && auth.canPublish()) {
      ownerTools.hidden = false;
    }
  }

  function bindExport() {
    const btn = document.getElementById('workspaceExportBtn');
    if (!btn || btn.dataset.exportBound === '1') return;
    btn.dataset.exportBound = '1';
    btn.addEventListener('click', function () {
      const auth = window.BurnfolderStudioAuth;
      if (!auth || !auth.canPublish()) return;
      fetch(apiBase() + '/studio-export', { headers: auth.getAuthHeaders() })
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'burnfolder-workspace-export.json';
          link.click();
          URL.revokeObjectURL(url);
        });
    });
  }

  function initDashboardPage() {
    const auth = window.BurnfolderStudioAuth;
    if (auth && auth.isMusicProjectOnly && auth.isMusicProjectOnly()) {
      window.location.replace('/studio/stream.html');
      return;
    }
    bindOwnerMeta();
    bindExport();
    if (window.studioInitStudioAiPanel) window.studioInitStudioAiPanel();
  }

  window.studioInitDashboardPage = function () {
    whenReady().then(initDashboardPage);
  };

  window.studioInitDashboardPage();
})();
