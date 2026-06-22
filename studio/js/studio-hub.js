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
    window.localStorage.setItem(LAST_DRAFT_KEY, id);
    const url = '/studio/index.html?id=' + encodeURIComponent(id);
    if (typeof window.studioSpaNavigate === 'function') {
      window.studioSpaNavigate(url);
      return;
    }
    window.location.href = url;
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
      link.addEventListener('click', function (event) {
        event.preventDefault();
        openDraft(draft.id);
      });
      listRoot.appendChild(link);
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

    if (newDate && !newDate.value) newDate.value = todayKey();

    if (newBtn && !newBtn.dataset.bound) {
      newBtn.dataset.bound = '1';
      newBtn.addEventListener('click', function () {
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
      });
    }

    if (!window.BurnfolderDrafts) {
      setStatus('drafts unavailable');
      return;
    }

    window.BurnfolderDrafts.listDrafts().then(function (items) {
      renderDraftList(items);
      setStatus(items.length ? '' : '');
    });
  }

  window.studioInitEntryHub = function () {
    listRoot = document.getElementById('draftList');
    statusEl = document.getElementById('studioHubStatus');
    newBtn = document.getElementById('newDraftBtn');
    newDate = document.getElementById('newDraftDate');
    boot();
  };

  window.studioInitEntryHub();
})();
