(function () {
  'use strict';

  if (!document.body || !document.body.classList.contains('studio-page')) return;

  const SPA_PAGES = {
    'index.html': 'entry',
    'today.html': 'today',
    'stream.html': 'stream',
    'video.html': 'video',
    'journal.html': 'journal'
  };

  const STREAM_PAGE_SCRIPTS = [
    '../entries.js',
    '../songs.js',
    '../shared/song-versions.js',
    '../shared/studio-tap.js',
    'js/asset-cloud.js',
    '../shared/cover-art.js',
    '../shared/mux-display-name.js',
    'js/mux-naming.js',
    'js/mux-client.js',
    'js/studio-mux-lib.js',
    '../shared/playback-context.js',
    '../shared/version-picker.js',
    '../shared/now-playing-bar.js',
    'js/stream-shared.js',
    'js/upload-queue.js',
    'js/journal-day-store.js',
    'js/journal-contributions.js',
    'js/cloud-ui.js',
    'js/stream-player.js',
    'js/stream-now-playing.js',
    'js/studio-dnd.js',
    'js/share-links.js',
    '../shared/share-hub-ui.js',
    'js/stream-page.js'
  ];

  const PAGE_SCRIPTS = {
    stream: STREAM_PAGE_SCRIPTS,
    video: STREAM_PAGE_SCRIPTS,
    journal: [
      'js/journal-day-store.js',
      'js/journal-contributions.js',
      'js/mux-client.js',
      'js/asset-cloud.js',
      'js/upload-queue.js',
      'js/cloud-ui.js',
      'js/journal-page.js'
    ],
    today: ['js/today-page.js', 'js/studio-ai-panel.js'],
    entry: [
      'js/drafts.js',
      '../shared/studio-tap.js',
      'js/studio-hub.js',
      'js/studio-bridge.js',
      'js/studio-editor-loader.js',
      'js/editor-gate.js'
    ]
  };

  let contentRoot = null;
  let loading = false;
  let pendingNavigation = null;
  const loadedScripts = new Set();

  function shellReady() {
    return window.BurnfolderStudioPlaybackShell && window.BurnfolderStudioPlaybackShell.ensureShell;
  }

  function pathnameOf(url) {
    try {
      return new URL(url, window.location.href).pathname;
    } catch (e) {
      return String(url || '');
    }
  }

  function pageFileFromPath(pathname) {
    const parts = String(pathname || '').split('/');
    const file = parts[parts.length - 1] || 'index.html';
    return file.indexOf('.html') > -1 ? file : file + '.html';
  }

  const STUDIO_BASE = '/studio/';

  function studioPagePath(pageFile) {
    return STUDIO_BASE + pageFile;
  }

  function resolveStudioNavigation(input) {
    const resolved = new URL(input, window.location.href);
    const file = pageFileFromPath(resolved.pathname);
    const pageKey = SPA_PAGES[file];
    if (!pageKey) return null;
    return {
      pageKey: pageKey,
      file: file,
      fetchPath: studioPagePath(file),
      href: studioPagePath(file) + resolved.search
    };
  }

  function isSpaTarget(href) {
    return !!resolveStudioNavigation(href);
  }

  function versionQuery() {
    const v = window.BurnfolderStudioVersion || '20260626d';
    return '?v=' + v;
  }

  function markNav(pageKey) {
    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      const nav = link.getAttribute('data-nav');
      const active = nav === pageKey;
      link.classList.toggle('is-active', active);
      link.classList.toggle('page-nav', active);
    });
  }

  function restoreSessionBodyClasses() {
    const auth = window.BurnfolderStudioAuth;
    if (auth && typeof auth.isReady === 'function' && auth.isReady()) {
      document.body.classList.add('studio-ready');
      if (!document.getElementById('studioAuthGate')) {
        document.body.classList.remove('studio-locked');
      }
    }
  }

  function applyBodyFromPage(doc) {
    const runtimeClasses = [
      'studio-ready',
      'studio-locked',
      'studio-booting',
      'stream-playback-active',
      'studio-has-player'
    ];
    const preserved = runtimeClasses.filter(function (cls) {
      return document.body.classList.contains(cls);
    });

    if (doc.body.className) {
      document.body.className = doc.body.className;
    }

    preserved.forEach(function (cls) {
      document.body.classList.add(cls);
    });

    if (doc.body.dataset) {
      Object.keys(doc.body.dataset).forEach(function (key) {
        document.body.dataset[key] = doc.body.dataset[key];
      });
    }

    restoreSessionBodyClasses();
  }

  function stripEmbeddedPlayback(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.studio-preview-player').forEach(function (node) {
      node.remove();
    });
    root.querySelectorAll('#activeMuxPlayer, #bottomBar').forEach(function (node) {
      if (!node.closest('#studioGlobalPlayback')) node.remove();
    });
  }

  function clonePageContent(doc) {
    return Array.from(doc.body.children).filter(function (child) {
      if (child.id === 'studioGlobalPlayback') return false;
      if (child.id === 'bottomBar') return false;
      if (child.tagName === 'SCRIPT') return false;
      return true;
    }).map(function (child) {
      const clone = child.cloneNode(true);
      stripEmbeddedPlayback(clone);
      return clone;
    });
  }

  function ensureContentRoot() {
    if (contentRoot) return contentRoot;
    contentRoot = document.getElementById('studio-spa-content');
    if (contentRoot) return contentRoot;

    if (shellReady()) window.BurnfolderStudioPlaybackShell.ensureShell();

    contentRoot = document.createElement('div');
    contentRoot.id = 'studio-spa-content';

    const persist = document.getElementById('studioGlobalPlayback');
    const nodes = Array.from(document.body.children);
    nodes.forEach(function (node) {
      if (node === persist) return;
      if (node.tagName === 'SCRIPT') return;
      if (node.id === 'studioAuthGate') return;
      contentRoot.appendChild(node);
    });

    document.body.insertBefore(contentRoot, persist || null);
    return contentRoot;
  }

  function scriptSrcNeedsLoad(src) {
    const clean = src.split('?')[0];
    return !loadedScripts.has(clean);
  }

  function loadScript(src) {
    const clean = src.split('?')[0];
    if (loadedScripts.has(clean)) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = src.indexOf('?') > -1 ? src : src + versionQuery();
      script.onload = function () {
        loadedScripts.add(clean);
        resolve();
      };
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  function loadPageScripts(pageKey) {
    const list = PAGE_SCRIPTS[pageKey] || [];
    let chain = Promise.resolve();
    list.forEach(function (src) {
      if (!scriptSrcNeedsLoad(src)) return;
      chain = chain.then(function () {
        return loadScript(src);
      });
    });
    return chain;
  }

  function runPageInit(pageKey) {
    if ((pageKey === 'stream' || pageKey === 'video') && typeof window.studioInitStreamPage === 'function') {
      window.studioInitStreamPage();
    } else if (pageKey === 'journal' && typeof window.studioInitJournalPage === 'function') {
      window.studioInitJournalPage();
    } else if (pageKey === 'today' && typeof window.studioInitTodayPage === 'function') {
      window.studioInitTodayPage();
    } else if (pageKey === 'entry' && typeof window.studioInitEntryHub === 'function') {
      window.studioInitEntryHub();
    }
    if (pageKey === 'entry' && typeof window.studioInitEditorWorkspace === 'function') {
      window.studioInitEditorWorkspace();
    }
    markNav(pageKey);
  }

  function entryShellLive() {
    return document.getElementById('studioHome') && document.getElementById('studioEditorShell');
  }

  function finishEntryNavigation(target, push) {
    if (push !== false) {
      history.pushState(
        { studioSpa: true, pageKey: 'entry' },
        '',
        target.href
      );
    }

    runPageInit('entry');

    const draftId = new URL(target.href, window.location.href).searchParams.get('id');
    if (draftId && typeof window.studioEditorOpenDraft === 'function') {
      window.studioEditorOpenDraft(draftId);
    } else if (typeof window.studioEditorShowHome === 'function') {
      window.studioEditorShowHome();
    }

    window.scrollTo(0, 0);
  }

  async function loadPage(url, push) {
    if (loading) {
      pendingNavigation = { url: url, push: push };
      return;
    }
    loading = true;
    document.body.classList.add('studio-spa-loading');
    const banner = statusBanner();
    if (banner) {
      banner.hidden = false;
      banner.textContent = 'loading…';
    }

    try {
      const target = resolveStudioNavigation(url);
      if (!target) {
        window.location.href = url;
        return;
      }

      if (target.pageKey === 'entry' && entryShellLive()) {
        finishEntryNavigation(target, push);
        return;
      }

      if (push !== false) {
        history.pushState(
          { studioSpa: true, pageKey: target.pageKey },
          '',
          target.href
        );
      }

      const response = await fetch(target.fetchPath, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Page not found');

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nodes = clonePageContent(doc);
      if (!nodes.length) throw new Error('Empty page');

      const root = ensureContentRoot();
      root.replaceChildren();
      nodes.forEach(function (child) {
        root.appendChild(child.cloneNode(true));
      });

      document.title = doc.title;
      applyBodyFromPage(doc);

      if (shellReady()) {
        window.BurnfolderStudioPlaybackShell.ensureShell();
        window.BurnfolderStudioPlaybackShell.mountBar();
        if (window.BurnfolderStudioPlaybackShell.syncAfterNavigation) {
          window.BurnfolderStudioPlaybackShell.syncAfterNavigation();
        }
      }

      await loadPageScripts(target.pageKey);

      if (target.pageKey === 'entry' && window.__studioBlockEditorLoaded) {
        if (typeof window.studioInitEntryEditorDom === 'function') {
          window.studioInitEntryEditorDom();
        }
      }

      runPageInit(target.pageKey);
      restoreSessionBodyClasses();

      if (shellReady() && window.BurnfolderStudioPlaybackShell.syncAfterNavigation) {
        window.BurnfolderStudioPlaybackShell.syncAfterNavigation();
      }

      if (target.pageKey === 'entry') {
        const draftId = new URL(target.href, window.location.href).searchParams.get('id');
        if (draftId && typeof window.studioEditorOpenDraft === 'function') {
          window.studioEditorOpenDraft(draftId);
        } else if (typeof window.studioEditorShowHome === 'function') {
          window.studioEditorShowHome();
        }
      }

      window.scrollTo(0, 0);
    } catch (err) {
      console.error('studio spa navigation failed:', err);
      const fallback = resolveStudioNavigation(url);
      if (statusBanner()) {
        statusBanner().textContent = 'could not load page — retrying…';
      }
      window.setTimeout(function () {
        window.location.href = fallback ? fallback.href : url;
      }, 600);
    } finally {
      loading = false;
      document.body.classList.remove('studio-spa-loading');
      const banner = statusBanner();
      if (banner) banner.hidden = true;

      if (pendingNavigation) {
        const next = pendingNavigation;
        pendingNavigation = null;
        loadPage(next.url, next.push);
      }
    }
  }

  function statusBanner() {
    return document.getElementById('studioSpaStatus');
  }

  function onLinkClick(event) {
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (link.classList.contains('studio-draft-link')) return;
    const href = link.getAttribute('href');
    const target = resolveStudioNavigation(href);
    if (!target) return;

    if (target.file === 'index.html' && target.href.indexOf('?') > -1) {
      event.preventDefault();
      loadPage(target.href);
      return;
    }

    event.preventDefault();
    loadPage(target.href);
  }

  function init() {
    if (!document.getElementById('studioSpaStatus')) {
      const banner = document.createElement('p');
      banner.id = 'studioSpaStatus';
      banner.className = 'studio-spa-status';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.hidden = true;
      document.body.appendChild(banner);
    }

    document.querySelectorAll('script[src]').forEach(function (node) {
      if (node.src) loadedScripts.add(node.src.split('?')[0]);
    });

    if (shellReady()) window.BurnfolderStudioPlaybackShell.ensureShell();

    document.addEventListener('click', onLinkClick);
    window.addEventListener('popstate', function (event) {
      if (!event.state || !event.state.studioSpa) return;
      loadPage(window.location.pathname + window.location.search, false);
    });

    const currentKey = pageKeyFromPath(window.location.pathname);
    if (currentKey) markNav(currentKey);
    if (currentKey === 'entry' && typeof window.studioInitEntryHub === 'function') {
      window.studioInitEntryHub();
    }
  }

  function pageKeyFromPath(pathname) {
    const file = pageFileFromPath(pathname);
    return SPA_PAGES[file] || null;
  }

  window.studioSpaNavigate = function (url) {
    return loadPage(url);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
