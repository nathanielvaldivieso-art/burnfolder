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
 *   brand = constellation; section label = hub (clips drill-in / stream-song / …) →
 *   designer / stream-song / stream-album current=clips → hard refresh deep link
 */
(function () {
  'use strict';

  if (!document.body || !document.body.classList.contains('studio-page')) return;

  var NAV_ITEMS = [
    { id: 'dashboard', label: 'dashboard', href: '/studio/dashboard.html' },
    { id: 'entry', label: 'entry', href: '/studio/index.html' },
    { id: 'clips', label: 'clips', href: '/studio/clips.html' },
    { id: 'journal', label: 'journal', href: '/studio/journal.html' },
    { id: 'releases', label: 'releases', href: '/studio/releases.html' }
  ];

  var FILE_TO_NAV = {
    'dashboard.html': 'dashboard',
    'index.html': 'entry',
    'editor.html': 'entry',
    'clips.html': 'clips',
    'stream.html': 'clips',
    'video.html': 'clips',
    'stream-album.html': 'clips',
    'stream-song.html': 'clips',
    'stream-stack.html': 'clips',
    'song-designer.html': 'clips',
    'album-designer.html': 'clips',
    'press-designer.html': 'clips',
    'shop-designer.html': 'clips',
    'journal.html': 'journal',
    'ideas.html': 'clips',
    'word-pull.html': 'clips',
    'releases.html': 'releases'
  };

  var handlersBound = false;
  var MENU_ID = 'studioSiteMenu';
  var TOOLS_ID = 'studioMenuTools';
  var didHomeConstellationOpen = false;

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
    var parts = (window.location.pathname || '')
      .split('/')
      .filter(function (p) {
        return !!p;
      });
    var file = parts[parts.length - 1] || 'index.html';
    /* /studio (no trailing slash) otherwise becomes studio.html and breaks current=entry */
    if (file === 'studio') return 'index.html';
    if (file.indexOf('.html') < 0) file = file + '.html';
    return file;
  }

  function detectCurrentSection() {
    return FILE_TO_NAV[pageFile()] || null;
  }

  function fileFromHref(href) {
    try {
      var parts = new URL(href, window.location.href).pathname.split('/').filter(Boolean);
      var file = parts[parts.length - 1] || '';
      if (file === 'studio') return 'index.html';
      if (file && file.indexOf('.html') < 0) file = file + '.html';
      return file;
    } catch (e) {
      return '';
    }
  }

  /** True only when already on that item's hub page (not a section subpage). */
  function isOnExactHub(link) {
    if (!link) return false;
    var target = fileFromHref(link.getAttribute('href') || '');
    return !!target && target === pageFile();
  }

  function goToSectionHub() {
    var current = detectCurrentSection();
    var item = findNavItem(current);
    if (!item) return;

    setMenuOpen(false);

    /* Same-page drill-in: page-id crumb is hidden, so close via its button. */
    if (
      fileFromHref(item.href) === pageFile() &&
      (document.body.classList.contains('clips-collection-open') ||
        document.body.classList.contains('clips-folder-open'))
    ) {
      var back = document.getElementById('clipsCrumbBack') || document.getElementById('clipsFolderBack');
      if (back) {
        back.click();
        return;
      }
    }

    /* Already on that hub — stay. Brand is how constellation opens. */
    if (fileFromHref(item.href) === pageFile()) return;

    if (typeof window.studioSpaNavigate === 'function') {
      window.studioSpaNavigate(item.href);
      return;
    }
    window.location.href = item.href;
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
    var brand = document.getElementById('studioSiteMenuBrand');
    var panel = document.getElementById('studioSiteMenuPanel');
    if (!menu || !panel) return;
    panel.hidden = !open;
    menu.classList.toggle('is-open', open);
    document.body.classList.toggle('is-site-menu-open', open);
    document.body.classList.toggle('is-studio-menu-open', open);
    var expanded = open ? 'true' : 'false';
    if (toggle) toggle.setAttribute('aria-expanded', expanded);
    if (brand) brand.setAttribute('aria-expanded', expanded);
  }

  function bindHandlers() {
    if (handlersBound) return;
    handlersBound = true;

    // Capture phase so we win over SPA link hijacking.
    document.addEventListener(
      'click',
      function (e) {
        var menu = document.getElementById(MENU_ID);
        var panel = document.getElementById('studioSiteMenuPanel');
        if (!menu || !panel) return;

        // Brand always opens/closes the constellation.
        var brand = e.target.closest('#studioSiteMenuBrand, .site-menu__brand');
        if (brand && menu.contains(brand)) {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen(panel.hidden);
          return;
        }

        // Section label always goes to that section's hub (never opens constellation).
        var toggle = e.target.closest('#studioSiteMenuToggle');
        if (toggle && menu.contains(toggle)) {
          e.preventDefault();
          e.stopPropagation();
          goToSectionHub();
          return;
        }

        var link = e.target.closest('.site-menu__item');
        if (link && menu.contains(link)) {
          setMenuOpen(false);
          // Section highlight (e.g. clips while on word-pull) must still navigate
          // to the hub. Only skip nav when already on that exact page — unless an
          // in-page drill-in (clips collection) is open.
          if (
            link.getAttribute('data-nav') === 'clips' &&
            (document.body.classList.contains('clips-collection-open') ||
              document.body.classList.contains('clips-folder-open'))
          ) {
            e.preventDefault();
            e.stopPropagation();
            goToSectionHub();
            return;
          }
          if (isOnExactHub(link)) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }

        if (!panel.hidden && !e.target.closest('#' + MENU_ID)) {
          setMenuOpen(false);
        }
      },
      true
    );

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

    root.innerHTML = '';
    root.className = 'site-menu studio-site-menu';
    root.id = MENU_ID;

    var bar = document.createElement('div');
    bar.className = 'site-menu__bar';

    var brand = document.createElement('button');
    brand.type = 'button';
    brand.className = 'site-menu__brand';
    brand.id = 'studioSiteMenuBrand';
    brand.textContent = 'burnfolder studio';
    brand.setAttribute('aria-expanded', 'false');
    brand.setAttribute('aria-controls', 'studioSiteMenuPanel');
    brand.setAttribute('aria-label', 'Open studio menu');
    bar.appendChild(brand);

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'site-menu__toggle';
    toggle.id = 'studioSiteMenuToggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'studioSiteMenuPanel');
    toggle.setAttribute(
      'aria-label',
      currentItem ? 'Go to ' + currentItem.label : 'Open studio menu'
    );

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
    } else {
      toggle.textContent = 'menu';
    }

    bar.appendChild(toggle);
    root.appendChild(bar);

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
        if (fileFromHref(item.href) === pageFile()) {
          el.setAttribute('aria-current', 'page');
        }
      }
      panel.appendChild(el);
    });

    root.appendChild(panel);

    if (existingTools && toolsWasConnected) {
      root.appendChild(existingTools);
    } else {
      ensureToolsSlot(root);
    }
  }

  function openConstellationHomeOnce() {
    if (didHomeConstellationOpen) return;
    didHomeConstellationOpen = true;
    // Studio home = constellation, not the dashboard desk.
    if (pageFile() === 'dashboard.html') {
      setMenuOpen(true);
    }
  }

  function syncCurrent() {
    var root = document.getElementById(MENU_ID);
    if (!root || !root.classList.contains('studio-site-menu')) return;
    var current = detectCurrentSection();
    var currentItem = findNavItem(current);
    var here = pageFile();

    var toggle = document.getElementById('studioSiteMenuToggle');
    if (toggle) {
      toggle.innerHTML = '';
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
        toggle.setAttribute('aria-label', 'Go to ' + currentItem.label);
      } else {
        toggle.textContent = 'menu';
        toggle.setAttribute('aria-label', 'Open studio menu');
      }
    }

    root.querySelectorAll('.studio-main-nav-link[data-nav]').forEach(function (link) {
      var nav = link.getAttribute('data-nav');
      var active = nav === current;
      var exact = active && fileFromHref(link.getAttribute('href') || '') === here;
      link.classList.toggle('is-current', active);
      link.classList.toggle('is-active', active);
      link.classList.toggle('page-nav', active);
      if (exact) link.setAttribute('aria-current', 'page');
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
    openConstellationHomeOnce();
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
