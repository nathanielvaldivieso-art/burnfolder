(function () {
  'use strict';

  const store = window.BurnfolderJournalDays;
  const contrib = window.BurnfolderJournalContributions;
  if (!store) return;

  const MONTH_NAMES = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];

  let calendarGrid = document.getElementById('journalCalendarGrid');
  let monthLabel = document.getElementById('journalMonthLabel');
  let selectedLabel = document.getElementById('journalSelectedLabel');
  let journalBody = document.getElementById('journalBody');
  let contributionsList = document.getElementById('journalContributionsList');
  let uploadRoot = document.getElementById('journalUpload');
  let statusEl = document.getElementById('journalStatus');

  let activeDate = store.todayKey();
  let viewYear = 0;
  let viewMonth = 0;
  let currentDay = null;
  let saveTimer = null;
  let loadingDay = false;
  let markedDays = new Set();

  function setStatus(msg, kind) {
    if (window.BurnfolderStudioStatus) {
      window.BurnfolderStudioStatus.set(statusEl, msg, kind);
      return;
    }
    if (statusEl) statusEl.textContent = msg || '';
  }

  function markNav() {
    document.querySelectorAll('.studio-main-nav-link').forEach(function (link) {
      const active = link.getAttribute('data-nav') === 'journal';
      link.classList.toggle('is-active', active);
      link.classList.toggle('page-nav', active);
    });
  }

  function syncViewFromDateKey(dateKey) {
    const date = store.dateFromKey(dateKey) || new Date();
    viewYear = date.getFullYear();
    viewMonth = date.getMonth() + 1;
  }

  function dayHasJournal(day) {
    return !!(day && day.journal && String(day.journal).trim());
  }

  function dayHasContributions(day) {
    return !!(day && day.contributions && day.contributions.length);
  }

  function refreshMarkedDays() {
    return store.listDays().then(function (days) {
      markedDays = new Set();
      (days || []).forEach(function (day) {
        if (dayHasJournal(day) || dayHasContributions(day)) {
          markedDays.add(day.dateKey);
        }
      });
    });
  }

  function monthGridCells(year, month) {
    const cells = [];
    const first = new Date(year, month - 1, 1);
    const startPad = first.getDay();
    const cursor = new Date(year, month - 1, 1 - startPad);

    for (let i = 0; i < 42; i += 1) {
      const date = new Date(cursor);
      cells.push({
        dateKey: store.keyFromDate(date),
        day: date.getDate(),
        outside: date.getMonth() !== month - 1
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return cells;
  }

  function renderCalendar() {
    if (!calendarGrid) return;

    if (monthLabel) {
      monthLabel.textContent = MONTH_NAMES[viewMonth - 1] + ' ' + viewYear;
    }

    calendarGrid.innerHTML = '';
    calendarGrid.setAttribute(
      'aria-label',
      MONTH_NAMES[viewMonth - 1] + ' ' + viewYear
    );

    const today = store.todayKey();
    const cells = monthGridCells(viewYear, viewMonth);

    cells.forEach(function (cell) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'studio-journal-calendar-day';
      btn.dataset.dateKey = cell.dateKey;
      btn.setAttribute('role', 'gridcell');
      btn.setAttribute('aria-label', cell.dateKey);

      if (cell.outside) btn.classList.add('is-outside');
      if (cell.dateKey === today) btn.classList.add('is-today');
      if (cell.dateKey === activeDate) btn.classList.add('is-selected');
      if (markedDays.has(cell.dateKey)) btn.classList.add('has-entry');

      const num = document.createElement('span');
      num.className = 'studio-journal-calendar-day-num';
      num.textContent = String(cell.day);
      btn.appendChild(num);

      if (markedDays.has(cell.dateKey)) {
        const dot = document.createElement('span');
        dot.className = 'studio-journal-calendar-day-dot';
        dot.setAttribute('aria-hidden', 'true');
        btn.appendChild(dot);
      }

      btn.addEventListener('click', function () {
        loadDay(cell.dateKey);
      });

      calendarGrid.appendChild(btn);
    });
  }

  function playContribution(item) {
    const player = window.BurnfolderStreamPlayer;
    if (!player || !item || !item.playbackId) return;
    if (window.BurnfolderStudioPlaybackShell) {
      window.BurnfolderStudioPlaybackShell.ensureShell();
      window.BurnfolderStudioPlaybackShell.mountBar();
    }
    player.playItem({
      playbackId: item.playbackId,
      kind: item.kind,
      displayTitle: item.title,
      muxAssetId: item.muxAssetId
    });
  }

  function renderContributions(items) {
    if (!contributionsList) return;
    contributionsList.innerHTML = '';

    if (!items || !items.length) {
      contributionsList.innerHTML =
        '<li class="studio-journal-empty">nothing uploaded for this day yet</li>';
      return;
    }

    items.forEach(function (item) {
      const li = document.createElement('li');
      li.className = 'studio-journal-contribution-item';

      const kind = document.createElement('span');
      kind.className = 'studio-journal-contribution-kind';
      kind.textContent = item.kind === 'video' ? 'video' : 'music';

      const title = document.createElement('span');
      title.className = 'studio-journal-contribution-title';
      title.textContent = item.title || 'untitled';

      const actions = document.createElement('span');
      actions.className = 'studio-journal-contribution-actions';

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'studio-journal-contribution-play';
      playBtn.textContent = item.kind === 'video' ? 'open' : 'play';
      playBtn.addEventListener('click', function () {
        if (item.kind === 'video') {
          window.location.href = '/studio/video.html';
          return;
        }
        playContribution(item);
      });
      actions.appendChild(playBtn);

      const streamLink = document.createElement('a');
      streamLink.className = 'studio-journal-contribution-link';
      streamLink.href =
        item.kind === 'video' ? '/studio/video.html' : '/studio/stream.html';
      streamLink.textContent = 'library';
      actions.appendChild(streamLink);

      li.appendChild(kind);
      li.appendChild(title);
      li.appendChild(actions);
      contributionsList.appendChild(li);
    });
  }

  function loadContributions(dateKey) {
    if (!contrib || !contrib.listForDay) {
      renderContributions([]);
      return Promise.resolve();
    }
    return contrib.listForDay(dateKey).then(renderContributions);
  }

  function debouncedSave() {
    if (loadingDay || !currentDay) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      store
        .saveDay(activeDate, {
          journal: journalBody ? journalBody.value : ''
        })
        .then(function (saved) {
          currentDay = saved;
          if (dayHasJournal(saved)) markedDays.add(activeDate);
          else if (!dayHasContributions(saved)) markedDays.delete(activeDate);
          renderCalendar();
          setStatus('saved', 'success');
        })
        .catch(function (err) {
          setStatus(err.message || 'could not save', 'error');
        });
    }, 450);
  }

  function loadDay(dateKey) {
    const key = String(dateKey || '').trim() || store.todayKey();
    activeDate = key;
    if (contrib && contrib.setActiveDateKey) contrib.setActiveDateKey(key);
    syncViewFromDateKey(key);
    loadingDay = true;
    if (selectedLabel) selectedLabel.textContent = key;
    setStatus('loading…', 'working');

    return store.getDay(key).then(function (day) {
      currentDay = day;
      if (journalBody) journalBody.value = day.journal || '';
      if (dayHasJournal(day) || dayHasContributions(day)) markedDays.add(key);
      loadingDay = false;
      setStatus('');
      renderCalendar();
      return loadContributions(key);
    });
  }

  function shiftMonth(delta) {
    const base = new Date(viewYear, viewMonth - 1 + delta, 1);
    viewYear = base.getFullYear();
    viewMonth = base.getMonth() + 1;
    renderCalendar();
  }

  function mountJournalUpload() {
    if (!uploadRoot || !window.BurnfolderCloudUI) return;
    if (uploadRoot.dataset.uploadZoneBound === '1') return;
    window.BurnfolderCloudUI.mountUploadZone(uploadRoot, {
      onStatus: setStatus,
      getContributionDateKey: function () {
        return activeDate || store.todayKey();
      },
      onUploaded: function () {
        refreshMarkedDays().then(function () {
          renderCalendar();
          loadContributions(activeDate);
        });
      }
    });
  }

  function bindFields() {
    if (journalBody) {
      journalBody.addEventListener('input', debouncedSave);
    }
  }

  function bindNav() {
    const prevMonth = document.getElementById('journalPrevMonth');
    const nextMonth = document.getElementById('journalNextMonth');
    const todayBtn = document.getElementById('journalTodayBtn');

    if (prevMonth) {
      prevMonth.addEventListener('click', function () {
        shiftMonth(-1);
      });
    }
    if (nextMonth) {
      nextMonth.addEventListener('click', function () {
        shiftMonth(1);
      });
    }
    if (todayBtn) {
      todayBtn.addEventListener('click', function () {
        loadDay(store.todayKey());
      });
    }
  }

  function boot() {
    syncViewFromDateKey(activeDate);
    if (contrib && contrib.setActiveDateKey) contrib.setActiveDateKey(activeDate);
    mountJournalUpload();

    const sync = contrib && contrib.syncAll ? contrib.syncAll() : Promise.resolve();

    return sync.then(function () {
      return refreshMarkedDays();
    }).then(function () {
      renderCalendar();
      return loadDay(activeDate);
    });
  }

  markNav();
  bindFields();
  bindNav();
  boot();

  window.studioInitJournalPage = function () {
    calendarGrid = document.getElementById('journalCalendarGrid');
    monthLabel = document.getElementById('journalMonthLabel');
    selectedLabel = document.getElementById('journalSelectedLabel');
    journalBody = document.getElementById('journalBody');
    contributionsList = document.getElementById('journalContributionsList');
    uploadRoot = document.getElementById('journalUpload');
    statusEl = document.getElementById('journalStatus');
    markNav();
    boot();
  };

  window.addEventListener('burnfolder-journal-synced', function () {
    refreshMarkedDays().then(function () {
      renderCalendar();
      loadDay(activeDate);
    });
  });

  window.addEventListener('burnfolder-journal-day-changed', function (event) {
    const key = event.detail && event.detail.dateKey;
    if (!key) return;
    if (journalBody && key === activeDate) {
      if (journalBody.value.trim()) markedDays.add(key);
      else if (!currentDay || !dayHasContributions(currentDay)) markedDays.delete(key);
    }
    renderCalendar();
  });

  window.addEventListener('burnfolder-journal-contributions-changed', function (event) {
    const key = event.detail && event.detail.dateKey;
    if (key) markedDays.add(key);
    renderCalendar();
    if (key === activeDate) loadContributions(activeDate);
  });
})();
