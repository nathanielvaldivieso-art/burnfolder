/**
 * Menus design archive — save and toggle design versions per public site section.
 *
 * Cloud key: siteMenuDesigns
 * Model:
 * {
 *   sections: { home: [...], audio: [...], archive: [...], video: [...], shop: [...], about: [...], contact: [...] },
 *   active: { home: id|null, audio: id|null, ... },
 *   updatedAt: ISO string
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

  var state = null;
  var currentSection = 'home';
  var currentDesignId = null;
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
        console.warn('[menus] load failed', err);
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
        console.warn('[menus] save failed', err);
      });
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function designName(sectionId, index) {
    var label = sectionId + ' design ' + (index + 1);
    return label;
  }

  function nextDesignName(sectionId) {
    var designs = ensureState().sections[sectionId] || [];
    var base = sectionId + ' design ';
    var max = 0;
    designs.forEach(function (d) {
      var m = String(d.name || '').match(new RegExp('^' + base.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '(\\d+)$', 'i'));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return base + (max + 1);
  }

  function findDesign(sectionId, designId) {
    var list = ensureState().sections[sectionId] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === designId) return list[i];
    }
    return null;
  }

  function activeDesignId(sectionId) {
    return ensureState().active[sectionId] || null;
  }

  function setActive(sectionId, designId) {
    ensureState().active[sectionId] = designId || null;
  }

  function createDesign(sectionId) {
    var now = isoNow();
    return {
      id: makeId(),
      name: nextDesignName(sectionId),
      section: sectionId,
      data: { notes: '', cssOverrides: '', config: {} },
      createdAt: now,
      updatedAt: now
    };
  }

  function updateDesignFromEditor(design) {
    design.name = String(el('menusDesignName').value || '').trim() || design.name;
    design.data.notes = el('menusDesignNotes').value || '';
    design.data.cssOverrides = el('menusDesignCss').value || '';
    var rawConfig = el('menusDesignConfig').value || '';
    try {
      design.data.config = rawConfig ? JSON.parse(rawConfig) : {};
      el('menusDesignConfig').classList.remove('is-invalid');
    } catch (e) {
      design.data.config = {};
      el('menusDesignConfig').classList.add('is-invalid');
      setStatus('Config JSON is invalid; saved as empty object.');
    }
    design.updatedAt = isoNow();
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
        currentDesignId = null;
        renderTabs();
        renderSection();
        hideEditor();
      });
      root.appendChild(btn);
    });
  }

  function renderSection() {
    var title = el('menusSectionTitle');
    if (title) title.textContent = currentSection + ' archive';

    var list = ensureState().sections[currentSection] || [];
    var root = el('menusDesignsList');
    if (!root) return;
    root.innerHTML = '';

    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'studio-menus-empty';
      empty.textContent = 'No saved designs yet. Click “new design” to archive the first ' + currentSection + ' idea.';
      root.appendChild(empty);
      return;
    }

    var activeId = activeDesignId(currentSection);
    list.forEach(function (design) {
      var row = document.createElement('div');
      row.className = 'studio-menus-row' + (design.id === currentDesignId ? ' is-selected' : '');

      var name = document.createElement('button');
      name.type = 'button';
      name.className = 'studio-menus-row-name';
      name.textContent = design.name || '(unnamed)';
      name.addEventListener('click', function () {
        currentDesignId = design.id;
        renderSection();
        openEditor(design);
      });
      row.appendChild(name);

      var meta = document.createElement('span');
      meta.className = 'studio-menus-row-meta';
      meta.textContent = new Date(design.updatedAt || design.createdAt).toLocaleString();
      row.appendChild(meta);

      var actions = document.createElement('span');
      actions.className = 'studio-menus-row-actions';

      var activateBtn = document.createElement('button');
      activateBtn.type = 'button';
      activateBtn.className = 'icon-btn studio-menus-activate' + (design.id === activeId ? ' is-active' : '');
      activateBtn.textContent = design.id === activeId ? 'active' : 'activate';
      activateBtn.title = design.id === activeId ? 'Active design for ' + currentSection : 'Make this the active ' + currentSection + ' design';
      activateBtn.addEventListener('click', function () {
        setActive(currentSection, design.id === activeId ? null : design.id);
        saveToCloud().then(renderSection);
      });
      actions.appendChild(activateBtn);

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'icon-btn';
      editBtn.textContent = 'edit';
      editBtn.addEventListener('click', function () {
        currentDesignId = design.id;
        renderSection();
        openEditor(design);
      });
      actions.appendChild(editBtn);

      row.appendChild(actions);
      root.appendChild(row);
    });
  }

  function showEditor() {
    var editor = el('menusEditor');
    if (editor) editor.hidden = false;
  }

  function hideEditor() {
    var editor = el('menusEditor');
    if (editor) editor.hidden = true;
    currentDesignId = null;
    if (el('menusDesignName')) el('menusDesignName').value = '';
    if (el('menusDesignNotes')) el('menusDesignNotes').value = '';
    if (el('menusDesignCss')) el('menusDesignCss').value = '';
    if (el('menusDesignConfig')) {
      el('menusDesignConfig').value = '';
      el('menusDesignConfig').classList.remove('is-invalid');
    }
  }

  function openEditor(design) {
    showEditor();
    el('menusDesignName').value = design.name || '';
    el('menusDesignNotes').value = design.data && design.data.notes ? design.data.notes : '';
    el('menusDesignCss').value = design.data && design.data.cssOverrides ? design.data.cssOverrides : '';
    var cfg = design.data && design.data.config ? design.data.config : {};
    try {
      el('menusDesignConfig').value = JSON.stringify(cfg, null, 2);
      el('menusDesignConfig').classList.remove('is-invalid');
    } catch (e) {
      el('menusDesignConfig').value = '{}';
    }
  }

  function bindActions() {
    var newBtn = el('menusNewDesignBtn');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        var design = createDesign(currentSection);
        ensureState().sections[currentSection].unshift(design);
        currentDesignId = design.id;
        saveToCloud().then(function () {
          renderSection();
          openEditor(design);
          setStatus('New design created');
        });
      });
    }

    var saveBtn = el('menusSaveDesignBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (!currentDesignId) return;
        var design = findDesign(currentSection, currentDesignId);
        if (!design) return;
        updateDesignFromEditor(design);
        saveToCloud().then(function () {
          renderSection();
          setStatus('Design saved');
        });
      });
    }

    var duplicateBtn = el('menusDuplicateDesignBtn');
    if (duplicateBtn) {
      duplicateBtn.addEventListener('click', function () {
        if (!currentDesignId) return;
        var design = findDesign(currentSection, currentDesignId);
        if (!design) return;
        var copy = JSON.parse(JSON.stringify(design));
        copy.id = makeId();
        copy.name = design.name + ' copy';
        copy.createdAt = isoNow();
        copy.updatedAt = isoNow();
        ensureState().sections[currentSection].unshift(copy);
        currentDesignId = copy.id;
        saveToCloud().then(function () {
          renderSection();
          openEditor(copy);
          setStatus('Design duplicated');
        });
      });
    }

    var deleteBtn = el('menusDeleteDesignBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        if (!currentDesignId) return;
        var design = findDesign(currentSection, currentDesignId);
        var label = design ? '“' + design.name + '”' : 'this design';
        if (!window.confirm('Delete ' + label + '? This cannot be undone.')) return;
        var list = ensureState().sections[currentSection];
        ensureState().sections[currentSection] = list.filter(function (d) {
          return d.id !== currentDesignId;
        });
        if (activeDesignId(currentSection) === currentDesignId) {
          setActive(currentSection, null);
        }
        hideEditor();
        saveToCloud().then(function () {
          renderSection();
          setStatus('Design deleted');
        });
      });
    }

    var closeBtn = el('menusCloseEditorBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        hideEditor();
        renderSection();
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
    hideEditor();

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
