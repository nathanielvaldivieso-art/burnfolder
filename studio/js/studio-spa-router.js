(function () {
  'use strict';

  if (!document.body || !document.body.classList.contains('studio-page')) return;

  const SPA_PAGES = {
    'index.html': 'entry',
    'dashboard.html': 'dashboard',
    'stream.html': 'stream',
    'video.html': 'video',
    'journal.html': 'journal',
    'ideas.html': 'ideas',
    'word-pull.html': 'word-pull',
    'releases.html': 'releases',
    // Song/album hubs must soft-nav so the live mux-player is never torn down.
    'stream-song.html': 'stream-song',
    'stream-album.html': 'stream-album'
  };

  const PLAYBACK_CORE = [
    '../shared/media-session.js',
    '../shared/playback-recall.js',
    '../shared/playback-prefetch.js',
    '../shared/mux-playback.js',
    '../shared/playback-context.js',
    '../shared/version-picker.js',
    '../shared/studio-tap.js',
    '../shared/now-playing-bar.js',
    'js/studio-playback-shell.js',
    'js/stream-player.js',
    'js/stream-now-playing.js'
  ];

  const STREAM_PAGE_SCRIPTS = PLAYBACK_CORE.concat([
    '../entries.js',
    '../songs.js',
    '../shared/song-versions.js',
    'js/asset-cloud.js',
    '../shared/cover-art.js',
    '../shared/mux-display-name.js',
    'js/mux-naming.js',
    'js/mux-client.js',
    'js/studio-mux-lib.js',
    'js/journal-day-store.js',
    'js/journal-contributions.js',
    '../shared/studio-tap.js',
    'js/cloud-state.js',
    'js/stream-shared.js',
    'js/upload-queue.js',
    'js/cloud-ui.js',
    'js/studio-dnd.js',
    'js/share-links.js',
    '../shared/share-hub-ui.js',
    'js/music-project-collab.js',
    'js/stream-page.js'
  ]);

  const PAGE_SCRIPTS = {
    stream: STREAM_PAGE_SCRIPTS,
    video: STREAM_PAGE_SCRIPTS,
    journal: PLAYBACK_CORE.concat([
      'js/journal-day-store.js',
      'js/journal-contributions.js',
      'js/mux-client.js',
      'js/asset-cloud.js',
      'js/upload-queue.js',
      'js/cloud-ui.js',
      'js/journal-page.js'
    ]),
    dashboard: PLAYBACK_CORE.concat(['js/dashboard-page.js', 'js/studio-ai-panel.js']),
    entry: PLAYBACK_CORE.concat([
      'js/drafts.js',
      '../shared/studio-tap.js',
      'js/studio-hub.js',
      'js/studio-bridge.js',
      'js/studio-editor-loader.js',
      'js/editor-gate.js'
    ]),
    // Always keep PLAYBACK_CORE so soft-nav into these pages never drops the shell.
    releases: PLAYBACK_CORE.concat([
      'js/cloud-state.js',
      'js/stream-shared.js',
      'js/vault-upload.js',
      'js/release-checklist.js',
      'js/releases-page.js'
    ]),
    ideas: PLAYBACK_CORE.concat(['js/ideas-page.js']),
    'word-pull': PLAYBACK_CORE.concat([
      'js/studio-dates.js',
      'js/cloud-state.js',
      'js/word-pull-bank.js',
      'js/word-pull-page.js'
    ]),
    'stream-song': PLAYBACK_CORE.concat([
      '../entries.js',
      '../songs.js',
      '../shared/song-versions.js',
      'js/asset-cloud.js',
      '../shared/cover-art.js',
      '../shared/mux-display-name.js',
      'js/mux-naming.js',
      'js/mux-client.js',
      'js/studio-mux-lib.js',
      'js/cloud-state.js',
      '../shared/song-page-render.js',
      'js/song-page-store.js',
      'js/stream-shared.js',
      'js/share-links.js',
      '../shared/share-hub-ui.js',
      'js/stream-song-page.js'
    ]),
    'stream-album': PLAYBACK_CORE.concat([
      '../entries.js',
      '../songs.js',
      '../shared/song-versions.js',
      'js/asset-cloud.js',
      '../shared/cover-art.js',
      '../shared/mux-display-name.js',
      'js/mux-naming.js',
      'js/mux-client.js',
      'js/studio-mux-lib.js',
      'js/cloud-state.js',
      '../shared/song-page-render.js',
      '../shared/album-page-render.js',
      'js/song-page-store.js',
      'js/album-page-store.js',
      'js/stream-shared.js',
      'js/share-links.js',
      '../shared/share-hub-ui.js',
      'js/stream-album-page.js'
    ])
  };

  let contentRoot = null;
  let loading = false;
  let pendingNavigation = null;
  const loadedScripts = new Set();
  const htmlCache = new Map();

  function cacheHtmlKey(fetchPath) {
    return fetchPath;
  }

  function fetchPageHtml(fetchPath) {
    const key = cacheHtmlKey(fetchPath);
    const cached = htmlCache.get(key);
    if (cached) return Promise.resolve(cached);

    return fetch(fetchPath, { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) throw new Error('Page not found');
      return response.text();
    }).then(function (html) {
      htmlCache.set(key, html);
      return html;
    });
  }

  function prefetchSpaPages() {
    Object.keys(SPA_PAGES).forEach(function (file) {
      const path = studioPagePath(file);
      if (htmlCache.has(cacheHtmlKey(path))) return;
      fetch(path, { credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) return null;
          return res.text();
        })
        .then(function (html) {
          if (html) htmlCache.set(cacheHtmlKey(path), html);
        })
        .catch(function () {});
    });
  }

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
    document.querySelectorAll('.studio-main-nav-link[data-nav]').forEach(function (link) {
      const nav = link.getAttribute('data-nav');
      const active = nav === pageKey;
      link.classList.toggle('is-active', active);
      link.classList.toggle('page-nav', active);
      link.classList.toggle('is-current', active);
    });
    if (window.BurnfolderStudioSiteMenu && typeof window.BurnfolderStudioSiteMenu.sync === 'function') {
      window.BurnfolderStudioSiteMenu.sync();
    }
  }

  function restoreSessionBodyClasses() {
    const auth = window.BurnfolderStudioAuth;
    if (auth && typeof auth.isReady === 'function' && auth.isReady()) {
      document.body.classList.add('studio-ready');
      document.body.classList.remove('studio-booting');
      if (!document.getElementById('studioAuthGate')) {
        document.body.classList.remove('studio-locked');
      }
    }
  }

  function applyBodyFromPage(doc) {
    const authed =
      window.BurnfolderStudioAuth &&
      typeof window.BurnfolderStudioAuth.isReady === 'function' &&
      window.BurnfolderStudioAuth.isReady();
    const runtimeClasses = [
      'studio-ready',
      'studio-locked',
      'studio-booting',
      'stream-playback-active',
      'studio-has-player'
    ];
    const preserved = runtimeClasses.filter(function (cls) {
      if (authed && cls === 'studio-booting') return false;
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
    const menuOn =
      document.body.classList.contains('studio-menu-on') &&
      !document.body.classList.contains('studio-menu-legacy');
    return Array.from(doc.body.children).filter(function (child) {
      if (child.id === 'studioGlobalPlayback') return false;
      if (child.id === 'bottomBar') return false;
      if (child.id === 'studioSiteMenu') return false;
      if (child.tagName === 'SCRIPT') return false;
      if (menuOn && child.classList && child.classList.contains('studio-header')) return false;
      return true;
    }).map(function (child) {
      const clone = child.cloneNode(true);
      stripEmbeddedPlayback(clone);
      if (menuOn && clone.querySelector) {
        clone.querySelectorAll('header.studio-header').forEach(function (header) {
          const editorNav = header.querySelector('#studioEditorNav');
          if (editorNav) {
            const host = document.createElement('div');
            host.id = 'studioEntryChrome';
            host.className = 'studio-entry-chrome';
            host.appendChild(editorNav.cloneNode(true));
            header.replaceWith(host);
          } else {
            header.remove();
          }
        });
      }
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
    const menu = document.getElementById('studioSiteMenu');
    const nodes = Array.from(document.body.children);
    nodes.forEach(function (node) {
      if (node === persist) return;
      if (node === menu) return;
      if (node.id === 'studioSiteMenu') return;
      if (node.tagName === 'SCRIPT') return;
      if (node.id === 'studioAuthGate') return;
      contentRoot.appendChild(node);
    });

    document.body.insertBefore(contentRoot, persist || null);
    if (menu) {
      document.body.insertBefore(menu, contentRoot);
    }
    return contentRoot;
  }

  /**
   * Canonical key for script dedupe. Static HTML tags expose absolute `script.src`,
   * while PAGE_SCRIPTS use relative paths — comparing either form raw caused the SPA
   * loader to re-inject mux/shell/player modules on the first soft nav, which rebuilt
   * the engine and restarted (or killed) the playing song.
   */
  function scriptKey(src) {
    try {
      return new URL(src, window.location.href).pathname;
    } catch (e) {
      return String(src || '').split('?')[0];
    }
  }

  function scriptSrcNeedsLoad(src) {
    return !loadedScripts.has(scriptKey(src));
  }

  function loadScript(src) {
    const key = scriptKey(src);
    if (loadedScripts.has(key)) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = src.indexOf('?') > -1 ? src : src + versionQuery();
      script.onload = function () {
        loadedScripts.add(key);
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
    } else if (pageKey === 'stream-song' && typeof window.studioInitStreamSongPage === 'function') {
      window.studioInitStreamSongPage();
    } else if (pageKey === 'stream-album' && typeof window.studioInitStreamAlbumPage === 'function') {
      window.studioInitStreamAlbumPage();
    } else if (pageKey === 'journal' && typeof window.studioInitJournalPage === 'function') {
      window.studioInitJournalPage();
    } else if (pageKey === 'ideas' && typeof window.studioInitIdeasPage === 'function') {
      window.studioInitIdeasPage();
    } else if (pageKey === 'word-pull' && typeof window.studioInitWordPullPage === 'function') {
      window.studioInitWordPullPage();
    } else if (pageKey === 'dashboard' && typeof window.studioInitDashboardPage === 'function') {
      window.studioInitDashboardPage();
    } else if (pageKey === 'entry' && typeof window.studioInitEntryHub === 'function') {
      window.studioInitEntryHub();
    }
    if (pageKey === 'entry' && typeof window.studioInitEditorWorkspace === 'function') {
      window.studioInitEditorWorkspace();
    }
    markNav(pageKey === 'stream-song' || pageKey === 'stream-album' ? 'stream' : pageKey);
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

    window.dispatchEvent(
      new CustomEvent('burnfolder-studio-navigated', { detail: { pageKey: 'entry' } })
    );

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
    const target = resolveStudioNavigation(url);
    const htmlCached = !!(target && htmlCache.has(cacheHtmlKey(target.fetchPath)));
    if (!htmlCached) {
      document.body.classList.add('studio-spa-loading');
      const banner = statusBanner();
      if (banner) {
        banner.hidden = false;
        banner.textContent = 'loading…';
      }
    }

    try {
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

      const response = await fetchPageHtml(target.fetchPath);
      const html = typeof response === 'string' ? response : await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nodes = clonePageContent(doc);
      if (!nodes.length) throw new Error('Empty page');

      if (typeof window.studioFlushJournalSave === 'function') {
        await window.studioFlushJournalSave();
      }
      if (typeof window.studioFlushIdeasSave === 'function') {
        await window.studioFlushIdeasSave();
      }
      if (typeof window.studioFlushWordPullLog === 'function') {
        await window.studioFlushWordPullLog();
      }

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

      window.dispatchEvent(
        new CustomEvent('burnfolder-studio-navigated', { detail: { pageKey: target.pageKey } })
      );

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
      if (node.src) loadedScripts.add(scriptKey(node.src));
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

    window.setTimeout(prefetchSpaPages, 400);
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
