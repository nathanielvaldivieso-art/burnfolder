(function (root) {
  'use strict';

  const kit = root.BurnfolderCloudStoreKit;
  const cloudStore = kit.createLocalCloudStore({
    storageKey: 'burnfolderStudioJournalDays',
    cloudKey: 'journalDays',
    emptyState: function () {
      return { version: 1, days: {} };
    },
    isValidLocal: function (parsed) {
      return typeof parsed.days === 'object';
    },
    isValidCloudValue: function (value) {
      return !!(value.days && typeof value.days === 'object');
    },
    hasLocalContent: function (local) {
      return Object.keys(local.days).length;
    },
    syncEventName: 'burnfolder-journal-synced'
  });
  const readStore = cloudStore.readStore;
  const writeStore = cloudStore.writeStore;
  const ensureHydrated = cloudStore.ensureHydrated;

  function makeId() {
    return kit.makeId('rem');
  }

  function emptyDay(dateKey) {
    return {
      dateKey: dateKey,
      journal: '',
      plan: '',
      reminders: [],
      contributions: [],
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeContribution(entry) {
    if (!entry || !entry.playbackId) return null;
    return {
      id: entry.id || entry.playbackId,
      playbackId: String(entry.playbackId),
      muxAssetId: entry.muxAssetId || null,
      kind: entry.kind === 'video' ? 'video' : 'audio',
      title: String(entry.title || 'untitled'),
      addedAt: entry.addedAt || new Date().toISOString()
    };
  }

  function normalizeDay(dateKey, day) {
    const base = emptyDay(dateKey);
    if (!day || typeof day !== 'object') return base;
    const contributions = Array.isArray(day.contributions)
      ? day.contributions.map(normalizeContribution).filter(Boolean)
      : [];
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
      contributions: contributions,
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

  function keyFromDate(date) {
    return formatDateKey(date);
  }

  function dateFromKey(key) {
    const ms = parseDateKey(key);
    return ms ? new Date(ms) : null;
  }

  function upsertContribution(dateKey, contribution) {
    const item = normalizeContribution(contribution);
    if (!item) return Promise.resolve(null);
    return ensureHydrated().then(function () {
      const store = readStore();
      const current = normalizeDay(dateKey, store.days[dateKey]);
      const list = (current.contributions || []).filter(function (row) {
        return row.playbackId !== item.playbackId;
      });
      list.unshift(item);
      const next = normalizeDay(dateKey, Object.assign({}, current, {
        contributions: list,
        dateKey: dateKey,
        updatedAt: new Date().toISOString()
      }));
      store.days[dateKey] = next;
      writeStore(store);
      window.dispatchEvent(new CustomEvent('burnfolder-journal-day-changed', { detail: { dateKey: dateKey } }));
      return next;
    });
  }

  function removeContribution(dateKey, playbackId) {
    const id = String(playbackId || '').trim();
    if (!id) return Promise.resolve(null);
    return ensureHydrated().then(function () {
      const store = readStore();
      const current = normalizeDay(dateKey, store.days[dateKey]);
      const list = (current.contributions || []).filter(function (row) {
        return row.playbackId !== id;
      });
      if (list.length === (current.contributions || []).length) return current;
      const next = normalizeDay(dateKey, Object.assign({}, current, {
        contributions: list,
        dateKey: dateKey,
        updatedAt: new Date().toISOString()
      }));
      store.days[dateKey] = next;
      writeStore(store);
      window.dispatchEvent(new CustomEvent('burnfolder-journal-day-changed', { detail: { dateKey: dateKey } }));
      return next;
    });
  }

  /** Wipe contribution lists on every day (journal text / plan / reminders stay). */
  function clearAllContributions() {
    return ensureHydrated().then(function () {
      const store = readStore();
      let changed = false;
      Object.keys(store.days || {}).forEach(function (key) {
        const day = store.days[key];
        if (!day || !Array.isArray(day.contributions) || !day.contributions.length) return;
        day.contributions = [];
        day.updatedAt = new Date().toISOString();
        changed = true;
      });
      if (changed) writeStore(store);
      return changed;
    });
  }

  root.BurnfolderJournalDays = {
    getDay: getDay,
    saveDay: saveDay,
    listDays: listDays,
    upsertContribution: upsertContribution,
    removeContribution: removeContribution,
    clearAllContributions: clearAllContributions,
    todayKey: todayKey,
    shiftDateKey: shiftDateKey,
    parseDateKey: parseDateKey,
    keyFromDate: keyFromDate,
    dateFromKey: dateFromKey,
    makeReminderId: makeId
  };
})(typeof window !== 'undefined' ? window : globalThis);
