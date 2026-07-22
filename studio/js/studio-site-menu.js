/**
 * Burnfolder Studio constellation menu (mirrors public shared/site-menu.js).
 *
 * Phase 0 inventory (freeze reference)
 * ------------------------------------
 * HTML shells with duplicated headers:
 *   dashboard, index, stream, video, journal, ideas, releases, word-pull,
 *   stream-album, stream-song, song-designer, album-designer, press-designer,
 *   shop-designer
 * (invite / today / files / editor / stream-stack have no studio-header)
 *
 * JS selectors that depended on the legacy bar:
 *   .studio-main-nav, .studio-main-nav-link[data-nav], .studio-nav-tools,
 *   .studio-header, #studioEditorNav (entry only), markNav() in spa + pages
 * Injectors: studio-auth.js (lock + music-project gating), cloud-state.js (sync)
 *
 * Modes (rollback-safe):
 *   on     — constellation only (default after cutover)
 *   dual   — constellation + legacy header visible
 *   legacy — no constellation; rebuild horizontal header if HTML stripped
 * Override: ?studioMenu=on|dual|legacy  or  localStorage burnfolder-studio-menu
 *
 * Smoke checklist:
 *   unlock → soft-nav every SPA area → lock → music-project gating →
 *   entry draft picker → playback during nav → mobile open/close →
 *   designer / stream-song / stream-album current=music → hard refresh deep link
 */
(function () {
  'use strict';

  if (!document.body || !document.body.classList.contains('studio-page')) return;

  var NAV_ITEMS = [
    { id: 'dashboard', label: 'dashboard', href: '/studio/dashboard.html' },
    { id: 'entry', label: 'entry', href: '/studio/index.html' },
    { id: 'stream', label: 'music', href: '/studio/stream.html' },
    { id: 'video', label: 'video', href: '/studio/video.html' },
    { id: 'journal', label: 'journal', href: '/studio/journal.html' },
    { id: 'ideas', label: 'ideas', href: '/studio/ideas.html' },
    { id: 'releases', label: 'releases', href: '/studio/releases.html' }
  ];

  var FILE_TO_NAV = {
    'dashboard.html': 'dashboard',
    'index.html': 'entry',
    'editor.html': 'entry',
    'stream.html': 'stream',
    'video.html': 'video',
    'stream-album.html': 'stream',
    'stream-song.html': 'stream',
    'stream-stack.html': 'stream',
    'song-designer.html': 'stream',
    'album-designer.html': 'stream',
    'press-designer.html': 'stream',
    'shop-designer.html': 'stream',
    'journal.html': 'journal',
    'ideas.html': 'ideas',
    'word-pull.html': 'ideas',
    'releases.html': 'releases'
  };

  var handlersBound = false;
  var MENU_ID = 'studioSiteMenu';
  var TOOLS_ID = 'studioMenuTools';

  function readMode() {
    try {
      var params = new URLSearchParams(window.location.search);
      var q = (params.get('studioMenu') || '').toLowerCase();
      if (q === '0' || q === 'off' || q === 'legacy') return 'legacy';
      if (q === 'dual' || q === '1' || q === 'flag') return 'dual';
      if (q === 'on' || q === 'new') return 'on';
    } catch (e) {}
    try {
      var ls = (localStorage.getItem('burnfolder-studio-menu') || '').toLowerCase();
      if (ls === 'legacy' || ls === 'dual' || ls === 'on') return ls;
    } catch (e2) {}
    return 'on';
  }

  function pageFile() {
    var parts = window.location.pathname.split('/');
    var file = parts[parts.length - 1] || 'index.html';
    if (file.indexOf('.html') < 0) file = file ? file + '.html' : 'index.html';
    return file;
  }

  function detectCurrentSection() {
    return FILE_TO_NAV[pageFile()] || null;
  }

  function findNavItem(id) {
    var found = null;
    NAV_ITEMS.some(function (item) {
      if (item.id === id) {
        found = item;
        return true;
      }
      return false;
    });
    return found;
  }

  function placeOutsideSpa(node) {
    if (!node) return;
    var spa = document.getElementById('studio-spa-content');
    var persist = document.getElementById('studioGlobalPlayback');
    if (spa && node.parentElement === spa) {
      document.body.insertBefore(node, spa);
    }
    if (!node.isConnected) {
      document.body.insertBefore(node, persist || document.body.firstChild);
    } else if (persist && node.nextSibling !== persist && node.parentElement === document.body) {
      /* keep menu above playback shell when possible */
    }
  }

  function ensureMenuRoot() {
    var root = document.getElementById(MENU_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = MENU_ID;
    }
    placeOutsideSpa(root);
    if (!root.isConnected) {
      var persist = document.getElementById('studioGlobalPlayback');
      document.body.insertBefore(root, persist || document.body.firstChild);
    }
    return root;
  }

  function setMenuOpen(open) {
    var menu = document.getElementById(MENU_ID);
    var toggle = document.getElementById('studioSiteMenuToggle');
    var panel = document.getElementById('studioSiteMenuPanel');
    if (!menu || !toggle || !panel) return;
    panel.hidden = !open;
    menu.classList.toggle('is-open', open);
    document.body.classList.toggle('is-site-menu-open', open);
    document.body.classList.toggle('is-studio-menu-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function bindHandlers() {
    if (handlersBound) return;
    handlersBound = true;

    document.addEventListener('click', function (e) {
      var menu = document.getElementById(MENU_ID);
      var panel = document.getElementById('studioSiteMenuPanel');
      if (!menu || !panel) return;

      if (e.target.closest('.site-menu__brand') && menu.contains(e.target.closest('.site-menu__brand'))) {
        setMenuOpen(false);
        return;
      }

      if (e.target.closest('#studioSiteMenuToggle')) {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(panel.hidden);
        return;
      }

      var link = e.target.closest('.site-menu__item');
      if (link && menu.contains(link)) {
        setMenuOpen(false);
        return;
      }

      if (!panel.hidden && !e.target.closest('#' + MENU_ID)) {
        setMenuOpen(false);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setMenuOpen(false);
    });
  }

  function ensureToolsSlot(root) {
    var tools = document.getElementById(TOOLS_ID);
    if (!tools) {
      tools = document.createElement('span');
      tools.id = TOOLS_ID;
      tools.className = 'studio-nav-tools studio-site-menu-tools';
    }
    if (!root.contains(tools)) root.appendChild(tools);
    return tools;
  }

  function renderConstellation(root) {
    var current = detectCurrentSection();
    var currentItem = findNavItem(current);

    var existingTools = document.getElementById(TOOLS_ID);
    var toolsWasConnected = existingTools && existingTools.isConnected;
    var toolsParent = toolsWasConnected ? existingTools.parentElement : null;

    root.innerHTML = '';
    root.className = 'site-menu studio-site-menu';
    root.id = MENU_ID;

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'site-menu__toggle';
    toggle.id = 'studioSiteMenuToggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'studioSiteMenuPanel');

    var brand = document.createElement('a');
    brand.className = 'site-menu__brand';
    brand.href = '/studio/dashboard.html';
    brand.textContent = 'burnfolder studio';
    toggle.appendChild(brand);

    if (currentItem) {
      var sep = document.createElement('span');
      sep.className = 'site-menu__sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '—';
      toggle.appendChild(sep);

      var currentEl = document.createElement('span');
      currentEl.className = 'site-menu__current';
      currentEl.textContent = currentItem.label;
      toggle.appendChild(currentEl);
    }

    var panel = document.createElement('nav');
    panel.className = 'site-menu__panel';
    panel.id = 'studioSiteMenuPanel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Studio');

    NAV_ITEMS.forEach(function (item) {
      var el = document.createElement('a');
      el.className =
        'site-menu__item site-menu__item--' +
        item.id +
        ' studio-main-nav-link';
      el.href = item.href;
      el.textContent = item.label;
      el.setAttribute('data-nav', item.id);
      if (item.id === current) {
        el.classList.add('is-current', 'is-active', 'page-nav');
        el.setAttribute('aria-current', 'page');
      }
      panel.appendChild(el);
    });

    root.appendChild(toggle);
    root.appendChild(panel);

    if (existingTools && toolsWasConnected) {
      root.appendChild(existingTools);
    } else {
      ensureToolsSlot(root);
    }

    void toolsParent;
  }

  function syncCurrent() {
    var root = document.getElementById(MENU_ID);
    if (!root || !root.classList.contains('studio-site-menu')) return;
    var current = detectCurrentSection();
    var currentItem = findNavItem(current);

    var toggle = document.getElementById('studioSiteMenuToggle');
    if (toggle) {
      var brand = toggle.querySelector('.site-menu__brand');
      Array.prototype.slice.call(toggle.querySelectorAll('.site-menu__sep, .site-menu__current')).forEach(function (n) {
        n.remove();
      });
      if (currentItem && brand) {
        var sep = document.createElement('span');
        sep.className = 'site-menu__sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '—';
        toggle.appendChild(sep);
        var currentEl = document.createElement('span');
        currentEl.className = 'site-menu__current';
        currentEl.textContent = currentItem.label;
        toggle.appendChild(currentEl);
      }
    }

    root.querySelectorAll('.studio-main-nav-link[data-nav]').forEach(function (link) {
      var nav = link.getAttribute('data-nav');
      var active = nav === current;
      link.classList.toggle('is-current', active);
      link.classList.toggle('is-active', active);
      link.classList.toggle('page-nav', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    setMenuOpen(false);
  }

  function hideLegacyHeaders() {
    document.querySelectorAll('header.studio-header').forEach(function (el) {
      el.hidden = true;
      el.setAttribute('data-studio-menu-hidden', '1');
      el.style.display = 'none';
    });
  }

  function showLegacyHeaders() {
    document.querySelectorAll('header.studio-header').forEach(function (el) {
      el.hidden = false;
      el.removeAttribute('data-studio-menu-hidden');
      el.style.display = '';
    });
  }

  function stripLegacyHeadersFromDom() {
    document.querySelectorAll('header.studio-header').forEach(function (el) {
      /* Preserve entry editor chrome if it was nested — move it out first. */
      var editorNav = el.querySelector('#studioEditorNav');
      if (editorNav) {
        var host = document.getElementById('studioEntryChrome');
        if (!host) {
          host = document.createElement('div');
          host.id = 'studioEntryChrome';
          host.className = 'studio-entry-chrome';
          var spa = document.getElementById('studio-spa-content');
          if (spa) spa.insertBefore(host, spa.firstChild);
          else document.body.insertBefore(host, el);
        }
        if (!host.contains(editorNav)) host.appendChild(editorNav);
      }
      el.remove();
    });
  }

  function renderLegacyHeader(opts) {
    opts = opts || {};
    if (document.querySelector('header.studio-header')) {
      showLegacyHeaders();
      return;
    }
    var header = document.createElement('header');
    header.className = 'site-header studio-header';
    var brand = document.createElement('a');
    brand.className = 'site-brand';
    brand.href = '/studio/dashboard.html';
    brand.textContent = 'burnfolder studio';
    header.appendChild(brand);

    var nav = document.createElement('nav');
    nav.className = 'site-nav studio-header-nav studio-main-nav';
    nav.setAttribute('aria-label', 'Studio');
    var current = detectCurrentSection();
    NAV_ITEMS.forEach(function (item) {
      var a = document.createElement('a');
      a.href = item.href;
      a.className = 'studio-main-nav-link';
      a.setAttribute('data-nav', item.id);
      a.textContent = item.label;
      if (item.id === current) a.classList.add('is-active', 'page-nav');
      nav.appendChild(a);
    });
    var tools = document.createElement('span');
    tools.className = 'studio-nav-tools';
    /* Only own the tools id when constellation is not the tools host. */
    if (!opts.dualCompare && !document.getElementById(TOOLS_ID)) {
      tools.id = TOOLS_ID;
    }
    nav.appendChild(tools);
    header.appendChild(nav);

    var spa = document.getElementById('studio-spa-content');
    if (spa) spa.insertBefore(header, spa.firstChild);
    else document.body.insertBefore(header, document.body.firstChild);
  }

  function remountTools() {
    var auth = window.BurnfolderStudioAuth;
    if (auth && typeof auth.remountChrome === 'function') {
      auth.remountChrome();
    }
    var cloud = window.BurnfolderCloudState;
    if (cloud && typeof cloud.remountChrome === 'function') {
      cloud.remountChrome();
    }
  }

  function applyBodyMode(mode) {
    document.body.classList.toggle('studio-menu-on', mode === 'on' || mode === 'dual');
    document.body.classList.toggle('studio-menu-dual', mode === 'dual');
    document.body.classList.toggle('studio-menu-legacy', mode === 'legacy');
  }

  function mountStudioSiteMenu() {
    var mode = readMode();
    applyBodyMode(mode);

    if (mode === 'legacy') {
      var existing = document.getElementById(MENU_ID);
      if (existing) existing.remove();
      document.body.classList.remove('is-site-menu-open', 'is-studio-menu-open');
      renderLegacyHeader();
      remountTools();
      return;
    }

    var root = ensureMenuRoot();
    renderConstellation(root);
    bindHandlers();

    if (mode === 'on') {
      hideLegacyHeaders();
      stripLegacyHeadersFromDom();
    } else if (mode === 'dual') {
      /* Dual: constellation + a generated legacy bar for visual comparison / rollback testing. */
      if (!document.querySelector('header.studio-header')) {
        renderLegacyHeader({ dualCompare: true });
      }
      showLegacyHeaders();
    } else {
      showLegacyHeaders();
    }

    remountTools();
  }

  function onNavigated() {
    var mode = readMode();
    applyBodyMode(mode);
    if (mode === 'legacy') {
      renderLegacyHeader();
      remountTools();
      return;
    }
    if (!document.getElementById(MENU_ID)) {
      mountStudioSiteMenu();
      return;
    }
    placeOutsideSpa(document.getElementById(MENU_ID));
    syncCurrent();
    if (mode === 'on') {
      hideLegacyHeaders();
      stripLegacyHeadersFromDom();
    }
    remountTools();
  }

  window.BurnfolderStudioSiteMenu = {
    mount: mountStudioSiteMenu,
    sync: syncCurrent,
    onNavigated: onNavigated,
    detectCurrentSection: detectCurrentSection,
    setOpen: setMenuOpen,
    getMode: readMode,
    navItems: NAV_ITEMS
  };

  /* Mount as soon as body exists so SPA markNav on DOMContentLoaded sees the menu. */
  if (document.body) {
    mountStudioSiteMenu();
  } else {
    document.addEventListener('DOMContentLoaded', mountStudioSiteMenu);
  }

  window.addEventListener('burnfolder-studio-navigated', onNavigated);
})();
