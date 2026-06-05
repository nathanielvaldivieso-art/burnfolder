(function () {
  'use strict';

  const store = window.BurnfolderJournalDays;
  if (!store) return;

  let dateInput = document.getElementById('journalDateKey');
  let journalBody = document.getElementById('journalBody');
  let journalPlan = document.getElementById('journalPlan');
  let checklistEl = document.getElementById('journalChecklist');
  let recentList = document.getElementById('journalRecentList');
  let statusEl = document.getElementById('journalStatus');

  let activeDate = store.todayKey();
  let currentDay = null;
  let saveTimer = null;
  let loadingDay = false;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || '';
  }

  function markNav() {
    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      link.classList.toggle('is-active', link.getAttribute('data-nav') === 'journal');
    });
  }

  function debouncedSave() {
    if (loadingDay || !currentDay) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      store
        .saveDay(activeDate, {
          journal: journalBody ? journalBody.value : '',
          plan: journalPlan ? journalPlan.value : '',
          reminders: currentDay.reminders || []
        })
        .then(function (saved) {
          currentDay = saved;
          setStatus('saved');
          renderRecent();
        })
        .catch(function (err) {
          setStatus(err.message || 'could not save');
        });
    }, 450);
  }

  function focusChecklistInput(li) {
    if (!li) return;
    const input = li.querySelector('.studio-journal-checklist-text');
    if (input) input.focus();
  }

  function addChecklistItem(text, focusNew) {
    const value = String(text || '').trim();
    if (!value || !currentDay) return null;
    const item = {
      id: store.makeReminderId(),
      text: value,
      done: false
    };
    currentDay.reminders = (currentDay.reminders || []).concat([item]);
    renderChecklist(currentDay.reminders);
    debouncedSave();
    if (focusNew !== false) {
      const rows = checklistEl ? checklistEl.querySelectorAll('.studio-journal-checklist-item') : [];
      const addRow = rows[rows.length - 1];
      focusChecklistInput(addRow);
    }
    return item;
  }

  function updateChecklistItem(id, patch) {
    if (!currentDay) return;
    currentDay.reminders = (currentDay.reminders || []).map(function (item) {
      if (item.id !== id) return item;
      return Object.assign({}, item, patch || {});
    });
    debouncedSave();
  }

  function removeChecklistItem(id) {
    if (!currentDay) return;
    currentDay.reminders = (currentDay.reminders || []).filter(function (item) {
      return item.id !== id;
    });
    renderChecklist(currentDay.reminders);
    debouncedSave();
  }

  function createChecklistRow(item, isAddRow) {
    const li = document.createElement('li');
    li.className = 'studio-journal-checklist-item';
    if (item && item.done) li.classList.add('is-done');
    if (item && item.id) li.dataset.id = item.id;
    if (isAddRow) li.classList.add('is-add-row');

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'studio-journal-checklist-check';
    check.setAttribute('aria-label', 'Done');
    if (isAddRow) {
      check.disabled = true;
      check.tabIndex = -1;
    } else {
      check.checked = !!item.done;
      check.addEventListener('change', function () {
        li.classList.toggle('is-done', check.checked);
        updateChecklistItem(item.id, { done: check.checked });
      });
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'studio-journal-checklist-text';
    input.spellcheck = false;
    input.value = item ? item.text : '';
    input.placeholder = isAddRow ? 'add item…' : '';

    input.addEventListener('input', function () {
      if (isAddRow || !item) return;
      updateChecklistItem(item.id, { text: input.value });
    });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (isAddRow) {
          const added = addChecklistItem(input.value);
          if (added) input.value = '';
          return;
        }
        const text = String(input.value || '').trim();
        if (!text && !isAddRow) return;
        if (!isAddRow) updateChecklistItem(item.id, { text: text });
        const next = li.nextElementSibling;
        if (next) focusChecklistInput(next);
        return;
      }

      if (event.key === 'Backspace' && !isAddRow && !input.value) {
        event.preventDefault();
        const prev = li.previousElementSibling;
        const id = item.id;
        removeChecklistItem(id);
        focusChecklistInput(prev || checklistEl.querySelector('.is-add-row'));
      }
    });

    li.appendChild(check);
    li.appendChild(input);
    return li;
  }

  function renderChecklist(reminders) {
    if (!checklistEl) return;
    checklistEl.innerHTML = '';
    const items = reminders || [];
    items.forEach(function (item) {
      checklistEl.appendChild(createChecklistRow(item, false));
    });
    checklistEl.appendChild(createChecklistRow(null, true));
  }

  function loadDay(dateKey) {
    const key = String(dateKey || '').trim() || store.todayKey();
    activeDate = key;
    loadingDay = true;
    if (dateInput) dateInput.value = key;
    setStatus('loading…');

    return store.getDay(key).then(function (day) {
      currentDay = day;
      if (journalBody) journalBody.value = day.journal || '';
      if (journalPlan) journalPlan.value = day.plan || '';
      renderChecklist(day.reminders);
      loadingDay = false;
      setStatus('');
      renderRecent();
    });
  }

  function renderRecent() {
    if (!recentList) return;
    store.listDays().then(function (days) {
      recentList.innerHTML = '';
      const withContent = days.filter(function (day) {
        return (
          (day.journal && day.journal.trim()) ||
          (day.plan && day.plan.trim()) ||
          (day.reminders && day.reminders.length)
        );
      });
      if (!withContent.length) {
        recentList.innerHTML = '<li class="studio-journal-empty">days you write will appear here</li>';
        return;
      }
      withContent.slice(0, 12).forEach(function (day) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'studio-journal-recent-btn';
        btn.textContent = day.dateKey;
        if (day.dateKey === activeDate) btn.classList.add('is-active');
        btn.addEventListener('click', function () {
          loadDay(day.dateKey);
        });
        li.appendChild(btn);
        recentList.appendChild(li);
      });
    });
  }

  function bindFields() {
    [journalBody, journalPlan].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', debouncedSave);
    });

    if (dateInput) {
      dateInput.addEventListener('change', function () {
        loadDay(dateInput.value);
      });
      dateInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          loadDay(dateInput.value);
        }
      });
    }
  }

  function bindNav() {
    const prev = document.getElementById('journalPrevDay');
    const next = document.getElementById('journalNextDay');
    const todayBtn = document.getElementById('journalTodayBtn');

    if (prev) {
      prev.addEventListener('click', function () {
        loadDay(store.shiftDateKey(activeDate, -1));
      });
    }
    if (next) {
      next.addEventListener('click', function () {
        loadDay(store.shiftDateKey(activeDate, 1));
      });
    }
    if (todayBtn) {
      todayBtn.addEventListener('click', function () {
        loadDay(store.todayKey());
      });
    }
  }

  markNav();
  bindFields();
  bindNav();

  window.studioInitJournalPage = function () {
    dateInput = document.getElementById('journalDateKey');
    journalBody = document.getElementById('journalBody');
    journalPlan = document.getElementById('journalPlan');
    checklistEl = document.getElementById('journalChecklist');
    recentList = document.getElementById('journalRecentList');
    statusEl = document.getElementById('journalStatus');
    markNav();
    loadDay(activeDate || store.todayKey());
  };

  loadDay(store.todayKey());

  window.addEventListener('burnfolder-journal-synced', function () {
    loadDay(activeDate);
  });
})();
