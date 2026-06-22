(function () {
  'use strict';

  const LAST_DRAFT_KEY = 'burnfolderStudioLastDraftId';

  let statusEl = document.getElementById('studioHubStatus');
  let listRoot = document.getElementById('draftList');
  let newBtn = document.getElementById('newDraftBtn');
  let newDate = document.getElementById('newDraftDate');

  function setStatus(msg, kind) {
    if (window.BurnfolderStudioStatus) {
      window.BurnfolderStudioStatus.set(statusEl, msg, kind);
      return;
    }
    if (statusEl) statusEl.textContent = msg || '';
  }

  function todayKey() {
    if (window.BurnfolderStudioDates) return window.BurnfolderStudioDates.todayKey();
    const now = new Date();
    return now.getMonth() + 1 + '.' + now.getDate() + '.' + String(now.getFullYear()).slice(-2);
  }

  function validateDraftDate(input) {
    const dates = window.BurnfolderStudioDates;
    if (!input || !dates) return true;
    const value = String(input.value || '').trim();
    if (!value) return true;
    if (dates.isValidDateKey(value)) return true;
    setStatus(dates.formatHint(), 'error');
    return false;
  }

  function openDraft(id) {
    if (!id) return;
    window.localStorage.setItem(LAST_DRAFT_KEY, id);
    const url = '/studio/index.html?id=' + encodeURIComponent(id);
    if (typeof window.studioSpaNavigate === 'function') {
      window.studioSpaNavigate(url);
      return;
    }
    window.location.href = url;
  }

  function handleDraftOpen(event, link) {
    if (event) event.preventDefault();
    const id = link && (link.dataset.draftId || '');
    if (!id || link.classList.contains('is-opening')) return;
    link.classList.add('is-opening');
    setStatus('opening…', 'working');
    openDraft(id);
    window.setTimeout(function () {
      link.classList.remove('is-opening');
    }, 1500);
  }

  function bindDraftListTap() {
    if (!listRoot || listRoot.dataset.draftTapBound === '1') return;
    listRoot.dataset.draftTapBound = '1';

    const tap = window.BurnfolderStudioTap;
    if (tap && tap.on) {
      tap.on(listRoot, '.studio-draft-link', handleDraftOpen);
      return;
    }

    listRoot.addEventListener('click', function (event) {
      const link = event.target.closest('.studio-draft-link');
      if (!link) return;
      handleDraftOpen(event, link);
    });
  }

  function renderDraftList(items) {
    if (!listRoot) return;
    listRoot.innerHTML = '';

    if (!items.length) {
      listRoot.innerHTML = '<p class="studio-empty">no entries yet — pick a date above.</p>';
      return;
    }

    items.forEach(function (draft) {
      const link = document.createElement('a');
      link.className = 'studio-draft-link';
      link.href = 'index.html?id=' + encodeURIComponent(draft.id);
      link.dataset.draftId = draft.id;

      const date = document.createElement('span');
      date.className = 'studio-draft-date';
      date.textContent = draft.date_key || 'untitled';
      link.appendChild(date);

      if (draft.status === 'published') {
        const tag = document.createElement('span');
        tag.className = 'studio-draft-tag';
        tag.textContent = 'published';
        link.appendChild(tag);
      }

      listRoot.appendChild(link);
    });
  }

  function refreshDraftList() {
    if (!window.BurnfolderDrafts) return;
    window.BurnfolderDrafts.listDrafts().then(function (items) {
      renderDraftList(items);
      setStatus(items.length ? '' : '');
    });
  }

  function markActiveNav() {
    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      const isEntry = link.getAttribute('data-nav') === 'entry';
      link.classList.toggle('is-active', isEntry);
      link.classList.toggle('page-nav', isEntry);
    });
  }

  function boot() {
    markActiveNav();
    bindDraftListTap();

    if (newDate && !newDate.value) newDate.value = todayKey();

    if (newBtn && !newBtn.dataset.bound) {
      newBtn.dataset.bound = '1';
      const activateCreate = function (event) {
        if (event && event.preventDefault) event.preventDefault();
        const dateKey = String((newDate && newDate.value) || '').trim() || todayKey();
        if (!validateDraftDate(newDate)) return;
        if (!window.BurnfolderDrafts) {
          setStatus('drafts unavailable', 'error');
          return;
        }
        setStatus('creating…', 'working');
        window.BurnfolderDrafts.createDraft(dateKey)
          .then(function (draft) {
            openDraft(draft.id);
          })
          .catch(function (err) {
            setStatus(err.message || 'could not create entry', 'error');
          });
      };

      if (window.BurnfolderStudioTap && window.BurnfolderStudioTap.bind) {
        window.BurnfolderStudioTap.bind(newBtn, activateCreate);
      } else {
        newBtn.addEventListener('click', activateCreate);
      }
    }

    if (!window.BurnfolderDrafts) {
      setStatus('drafts unavailable');
      return;
    }

    refreshDraftList();
  }

  if (!window.__studioHubDraftsSynced) {
    window.__studioHubDraftsSynced = true;
    window.addEventListener('burnfolder-drafts-synced', refreshDraftList);
  }

  window.studioInitEntryHub = function () {
    listRoot = document.getElementById('draftList');
    statusEl = document.getElementById('studioHubStatus');
    newBtn = document.getElementById('newDraftBtn');
    newDate = document.getElementById('newDraftDate');
    boot();
  };
})();
