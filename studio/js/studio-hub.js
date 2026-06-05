(function () {
  'use strict';

  const LAST_DRAFT_KEY = 'burnfolderStudioLastDraftId';

  const statusEl = document.getElementById('studioHubStatus');
  const listRoot = document.getElementById('draftList');
  const newBtn = document.getElementById('newDraftBtn');
  const newDate = document.getElementById('newDraftDate');

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || '';
  }

  function todayKey() {
    const now = new Date();
    return now.getMonth() + 1 + '.' + now.getDate() + '.' + String(now.getFullYear()).slice(-2);
  }

  function openDraft(id) {
    window.localStorage.setItem(LAST_DRAFT_KEY, id);
    const url = new URL('index.html', window.location.href);
    url.searchParams.set('id', id);
    window.location.href = url.pathname + url.search;
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
    });
  }

  function boot() {
    markActiveNav();

    if (newDate && !newDate.value) newDate.value = todayKey();

    if (newBtn) {
      newBtn.addEventListener('click', function () {
        const dateKey = String((newDate && newDate.value) || '').trim() || todayKey();
        if (!window.BurnfolderDrafts) {
          setStatus('drafts unavailable');
          return;
        }
        setStatus('creating…');
        window.BurnfolderDrafts.createDraft(dateKey)
          .then(function (draft) {
            openDraft(draft.id);
          })
          .catch(function (err) {
            setStatus(err.message || 'could not create entry');
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

  boot();
})();
