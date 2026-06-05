(function () {
  'use strict';

  const STORAGE_KEY = 'burnfolderStudioJournalDays';
  const CLOUD_KEY = 'journalDays';

  function makeId() {
    return 'rem-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
  }

  function readStore() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 1, days: {} };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.days !== 'object') return { version: 1, days: {} };
      return parsed;
    } catch {
      return { version: 1, days: {} };
    }
  }

  function writeStore(store) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    const cs = window.BurnfolderCloudState;
    if (cs && cs.put) cs.put(CLOUD_KEY, store);
  }

  let hydratePromise = null;
  function ensureHydrated() {
    if (hydratePromise) return hydratePromise;
    const cs = window.BurnfolderCloudState;
    if (!cs || !cs.get) {
      hydratePromise = Promise.resolve();
      return hydratePromise;
    }
    hydratePromise = cs.get(CLOUD_KEY).then(function (value) {
      if (value && value.days && typeof value.days === 'object') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        window.dispatchEvent(new CustomEvent('burnfolder-journal-synced'));
      } else if (value === null) {
        const local = readStore();
        if (Object.keys(local.days).length && cs.put) cs.put(CLOUD_KEY, local);
      }
    }).catch(function () {});
    return hydratePromise;
  }

  function emptyDay(dateKey) {
    return {
      dateKey: dateKey,
      journal: '',
      plan: '',
      reminders: [],
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeDay(dateKey, day) {
    const base = emptyDay(dateKey);
    if (!day || typeof day !== 'object') return base;
    return {
      dateKey: dateKey,
      journal: typeof day.journal === 'string' ? day.journal : '',
      plan: typeof day.plan === 'string' ? day.plan : '',
      reminders: Array.isArray(day.reminders)
        ? day.reminders
            .filter(function (r) {
              return r && typeof r.text === 'string';
            })
            .map(function (r) {
              return {
                id: r.id || makeId(),
                text: String(r.text || ''),
                time: typeof r.time === 'string' ? r.time : '',
                done: !!r.done
              };
            })
        : [],
      updatedAt: day.updatedAt || base.updatedAt
    };
  }

  function getDay(dateKey) {
    return ensureHydrated().then(function () {
      const store = readStore();
      return normalizeDay(dateKey, store.days[dateKey]);
    });
  }

  function saveDay(dateKey, patch) {
    return ensureHydrated().then(function () {
      const store = readStore();
      const current = normalizeDay(dateKey, store.days[dateKey]);
      const next = normalizeDay(dateKey, Object.assign({}, current, patch || {}, {
        dateKey: dateKey,
        updatedAt: new Date().toISOString()
      }));
      store.days[dateKey] = next;
      writeStore(store);
      window.dispatchEvent(new CustomEvent('burnfolder-journal-day-changed', { detail: { dateKey: dateKey } }));
      return next;
    });
  }

  function listDays() {
    return ensureHydrated().then(function () {
      const store = readStore();
      return Object.keys(store.days)
        .map(function (key) {
          return normalizeDay(key, store.days[key]);
        })
        .sort(function (a, b) {
          return parseDateKey(b.dateKey) - parseDateKey(a.dateKey);
        });
    });
  }

  function parseDateKey(key) {
    const parts = String(key || '').trim().split('.');
    if (parts.length < 3) return 0;
    const month = Number(parts[0]);
    const day = Number(parts[1]);
    let year = Number(parts[2]);
    if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return 0;
    if (year < 100) year += 2000;
    return new Date(year, month - 1, day).getTime();
  }

  function formatDateKey(date) {
    return date.getMonth() + 1 + '.' + date.getDate() + '.' + String(date.getFullYear()).slice(-2);
  }

  function todayKey() {
    return formatDateKey(new Date());
  }

  function shiftDateKey(key, deltaDays) {
    const ms = parseDateKey(key);
    const base = ms ? new Date(ms) : new Date();
    base.setDate(base.getDate() + deltaDays);
    return formatDateKey(base);
  }

  window.BurnfolderJournalDays = {
    getDay: getDay,
    saveDay: saveDay,
    listDays: listDays,
    todayKey: todayKey,
    shiftDateKey: shiftDateKey,
    parseDateKey: parseDateKey,
    makeReminderId: makeId
  };
})();
