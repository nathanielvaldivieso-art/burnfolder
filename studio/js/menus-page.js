/**
 * Menu version archive — simple backup / revert for the site menu design.
 *
 * Each public section (home, audio, archive, video, shop, about, contact) can
 * have any number of saved versions. One version per section may be active. The
 * UI is intentionally minimal: simple blobs, preview, and an active indicator.
 *
 * Cloud key: siteMenuDesigns
 * Data model (agent-readable):
 * {
 *   sections: {
 *     home: [Version, ...],
 *     audio: [Version, ...],
 *     ...
 *   },
 *   active: {
 *     home: versionId|null,
 *     audio: versionId|null,
 *     ...
 *   },
 *   updatedAt: ISO-8601 string
 * }
 *
 * Version object:
 * {
 *   id: string,
 *   name: string,        // e.g. "home version 1"
 *   section: string,
 *   data: {
 *     notes: string,
 *     cssOverrides: string,
 *     config: object
 *   },
 *   createdAt: ISO-8601,
 *   updatedAt: ISO-8601
 * }
 */
(function () {
  'use strict';

  var CLOUD_KEY = 'siteMenuDesigns';
  var SECTIONS = [
    { id: 'home', label: 'home' },
    { id: 'audio', label: 'audio' },
    { id: 'archive', label: 'archive' },
    { id: 'video', label: 'video' },
    { id: 'shop', label: 'shop' },
    { id: 'about', label: 'about' },
    { id: 'contact', label: 'contact' }
  ];

  var SECTION_URLS = {
    home: 'index.html',
    audio: 'audio.html',
    archive: 'archive.html',
    video: 'content.html',
    shop: 'shop.html',
    about: 'about.html',
    contact: 'contact.html'
  };

  var state = null;
  var currentSection = 'home';
  var statusTimer = null;
  var initDone = false;
  var loadPromise = null;

  function el(id) {
    return document.getElementById(id);
  }

  function makeId() {
    return 'md-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function setStatus(msg, sticky) {
    var node = el('menusStatus');
    if (!node) return;
    if (statusTimer) clearTimeout(statusTimer);
    node.textContent = msg || '';
    if (!sticky) {
      statusTimer = setTimeout(function () {
        node.textContent = '';
      }, 4000);
    }
  }

  function emptyState() {
    var sections = {};
    SECTIONS.forEach(function (s) {
      sections[s.id] = [];
    });
    return { sections: sections, active: {}, updatedAt: isoNow() };
  }

  function ensureState() {
    if (!state) state = emptyState();
    if (!state.sections) state.sections = {};
    if (!state.active) state.active = {};
    SECTIONS.forEach(function (s) {
      if (!Array.isArray(state.sections[s.id])) state.sections[s.id] = [];
    });
    return state;
  }

  function cloud() {
    return window.BurnfolderCloudState;
  }

  function loadFromCloud() {
    if (loadPromise) return loadPromise;
    var api = cloud();
    if (!api || typeof api.get !== 'function') {
      setStatus('cloud state unavailable');
      return Promise.resolve(ensureState());
    }
    setStatus('loading…', true);
    loadPromise = api.get(CLOUD_KEY)
      .then(function (value) {
        state = value || emptyState();
        ensureState();
        setStatus('');
        return state;
      })
      .catch(function (err) {
        ensureState();
        setStatus('Could not load archive.');
        console.warn('[menu] load failed', err);
        return state;
      })
      .finally(function () {
        loadPromise = null;
      });
    return loadPromise;
  }

  function saveToCloud() {
    var api = cloud();
    if (!api || typeof api.put !== 'function') {
      setStatus('cloud state unavailable');
      return Promise.resolve();
    }
    ensureState();
    state.updatedAt = isoNow();
    setStatus('saving…', true);
    return api.put(CLOUD_KEY, state, 400)
      .then(function () {
        setStatus('saved');
      })
      .catch(function (err) {
        setStatus('save failed');
        console.warn('[menu] save failed', err);
      });
  }

  function nextVersionName(sectionId) {
    var versions = ensureState().sections[sectionId] || [];
    var base = sectionId + ' version ';
    var max = 0;
    versions.forEach(function (d) {
      var m = String(d.name || '').match(new RegExp('^' + base.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '(\\d+)$', 'i'));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return base + (max + 1);
  }

  function activeVersionId(sectionId) {
    return ensureState().active[sectionId] || null;
  }

  function activeVersion(sectionId) {
    var id = activeVersionId(sectionId);
    if (!id) return null;
    var list = ensureState().sections[sectionId] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function setActive(sectionId, versionId) {
    ensureState().active[sectionId] = versionId || null;
  }

  function createVersion(sectionId) {
    var active = activeVersion(sectionId);
    var now = isoNow();
    var version = {
      id: makeId(),
      name: nextVersionName(sectionId),
      section: sectionId,
      data: { notes: '', cssOverrides: '', config: {} },
      createdAt: now,
      updatedAt: now
    };
    // Snapshot the currently active version's data if one exists.
    if (active && active.data) {
      version.data = {
        notes: active.data.notes || '',
        cssOverrides: active.data.cssOverrides || '',
        config: JSON.parse(JSON.stringify(active.data.config || {}))
      };
    }
    return version;
  }

  function deleteVersion(version) {
    if (!version) return;
    if (!window.confirm('Delete “' + (version.name || 'this version') + '”?')) return;
    var list = ensureState().sections[currentSection];
    ensureState().sections[currentSection] = list.filter(function (d) {
      return d.id !== version.id;
    });
    if (activeVersionId(currentSection) === version.id) {
      setActive(currentSection, null);
    }
    saveToCloud().then(function () {
      renderSection();
      setStatus('Version deleted');
    });
  }

  function previewUrl(version) {
    var page = SECTION_URLS[version.section] || 'index.html';
    var base = window.location.protocol + '//' + window.location.host + '/' + page;
    var params = new URLSearchParams();
    params.set('__menu_preview', '1');
    params.set('__menu_section', version.section);
    if (version.data && version.data.cssOverrides) {
      params.set('__menu_css', version.data.cssOverrides);
    }
    if (version.data && version.data.config) {
      try {
        params.set('__menu_config', JSON.stringify(version.data.config));
      } catch (e) {}
    }
    return base + '?' + params.toString();
  }

  function previewVersion(version) {
    var url = previewUrl(version);
    var name = 'menuPreview-' + version.id;
    var features = 'width=1000,height=700,scrollbars=yes,resizable=yes';
    var win = window.open(url, name, features);
    if (!win) setStatus('Popup blocked — allow popups to preview.');
  }

  function renderTabs() {
    var root = el('menusTabList');
    if (!root) return;
    root.innerHTML = '';
    SECTIONS.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'studio-menus-tab' + (s.id === currentSection ? ' is-active' : '');
      btn.textContent = s.label;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', s.id === currentSection ? 'true' : 'false');
      btn.addEventListener('click', function () {
        currentSection = s.id;
        renderTabs();
        renderSection();
      });
      root.appendChild(btn);
    });
  }

  function renderSection() {
    var title = el('menusSectionTitle');
    if (title) title.textContent = currentSection + ' versions';

    var list = ensureState().sections[currentSection] || [];
    var root = el('menusDesignsList');
    if (!root) return;
    root.innerHTML = '';

    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'studio-menus-empty';
      empty.textContent = 'No saved versions yet. Click “new version” to save the first ' + currentSection + ' backup.';
      root.appendChild(empty);
      return;
    }

    var activeId = activeVersionId(currentSection);
    list.forEach(function (version) {
      var isActive = version.id === activeId;

      var blob = document.createElement('div');
      blob.className = 'studio-menus-blob' + (isActive ? ' is-active' : '');
      blob.setAttribute('data-version-id', version.id);

      var name = document.createElement('div');
      name.className = 'studio-menus-blob-name';
      name.textContent = version.name || '(unnamed)';
      blob.appendChild(name);

      var actions = document.createElement('div');
      actions.className = 'studio-menus-blob-actions';

      var previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'icon-btn';
      previewBtn.textContent = 'preview';
      previewBtn.addEventListener('click', function () {
        previewVersion(version);
      });
      actions.appendChild(previewBtn);

      var activateBtn = document.createElement('button');
      activateBtn.type = 'button';
      activateBtn.className = 'icon-btn studio-menus-activate' + (isActive ? ' is-active' : '');
      activateBtn.textContent = isActive ? '● active' : '○';
      activateBtn.title = isActive ? 'Active version' : 'Activate this version';
      activateBtn.addEventListener('click', function () {
        setActive(currentSection, isActive ? null : version.id);
        saveToCloud().then(renderSection);
      });
      actions.appendChild(activateBtn);

      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'icon-btn studio-menus-blob-delete';
      deleteBtn.textContent = '×';
      deleteBtn.title = 'Delete this version';
      deleteBtn.addEventListener('click', function () {
        deleteVersion(version);
      });
      actions.appendChild(deleteBtn);

      blob.appendChild(actions);
      root.appendChild(blob);
    });
  }

  function bindActions() {
    var newBtn = el('menusNewDesignBtn');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        var version = createVersion(currentSection);
        ensureState().sections[currentSection].push(version);
        saveToCloud().then(function () {
          renderSection();
          setStatus('New version saved');
        });
      });
    }
  }

  function markNav() {
    document.querySelectorAll('.studio-main-nav-link[data-nav]').forEach(function (link) {
      link.classList.toggle('is-active', link.getAttribute('data-nav') === 'menus');
      link.classList.toggle('page-nav', link.getAttribute('data-nav') === 'menus');
    });
    if (window.BurnfolderStudioSiteMenu && window.BurnfolderStudioSiteMenu.sync) {
      window.BurnfolderStudioSiteMenu.sync();
    }
  }

  function boot() {
    if (!document.body || !document.body.classList.contains('studio-menus-page')) return;
    if (initDone) return;
    initDone = true;

    renderTabs();
    bindActions();

    loadFromCloud().then(function () {
      renderSection();
      markNav();
    });
  }

  function reinit() {
    initDone = false;
    boot();
  }

  window.studioInitMenusPage = boot;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.addEventListener('burnfolder-studio-navigated', reinit);
})();
