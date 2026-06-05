(function () {
  'use strict';

  if (!document.body || !document.body.classList.contains('studio-page')) return;

  const SPA_PAGES = {
    'index.html': 'entry',
    'stream.html': 'stream',
    'video.html': 'video',
    'journal.html': 'journal'
  };

  const STREAM_PAGE_SCRIPTS = [
    '../entries.js',
    '../songs.js',
    '../shared/song-versions.js',
    'js/asset-cloud.js',
    '../shared/mux-display-name.js',
    'js/mux-naming.js',
    'js/mux-client.js',
    'js/studio-mux-lib.js',
    '../shared/playback-context.js',
    '../shared/version-picker.js',
    '../shared/now-playing-bar.js',
    'js/stream-shared.js',
    'js/upload-queue.js',
    'js/cloud-ui.js',
    'js/stream-player.js',
    'js/stream-now-playing.js',
    'js/stream-page.js'
  ];

  const PAGE_SCRIPTS = {
    stream: STREAM_PAGE_SCRIPTS,
    video: STREAM_PAGE_SCRIPTS,
    journal: ['js/journal-day-store.js', 'js/journal-page.js'],
    entry: ['js/drafts.js', 'js/studio-hub.js']
  };

  let contentRoot = null;
  let loading = false;
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

  function markNav(pageKey) {
    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      const nav = link.getAttribute('data-nav');
      link.classList.toggle('is-active', nav === pageKey);
      link.classList.toggle('page-nav', nav === pageKey);
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
      'stream-playback-active',
      'studio-has-player',
      'has-stream-stack'
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

  function clonePageContent(doc) {
    return Array.from(doc.body.children).filter(function (child) {
      if (child.id === 'studioGlobalPlayback') return false;
      if (child.id === 'bottomBar') return false;
      if (child.tagName === 'SCRIPT') return false;
      return true;
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
      script.src = src.indexOf('?') > -1 ? src : src + '?v=20260604z16';
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
    } else if (pageKey === 'entry' && typeof window.studioInitEntryHub === 'function') {
      window.studioInitEntryHub();
    }
    markNav(pageKey);
  }

  async function loadPage(url, push) {
    if (loading) return;
    loading = true;

    try {
      const target = resolveStudioNavigation(url);
      if (!target) {
        window.location.href = url;
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
      }

      await loadPageScripts(target.pageKey);
      runPageInit(target.pageKey);
      restoreSessionBodyClasses();
      window.scrollTo(0, 0);
    } catch (err) {
      console.error('studio spa navigation failed:', err);
      const fallback = resolveStudioNavigation(url);
      window.location.href = fallback ? fallback.href : url;
    } finally {
      loading = false;
    }
  }

  function onLinkClick(event) {
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const href = link.getAttribute('href');
    const target = resolveStudioNavigation(href);
    if (!target) return;

    if (target.file === 'index.html' && target.href.indexOf('?') > -1) {
      return;
    }

    event.preventDefault();
    loadPage(target.href);
  }

  function init() {
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
