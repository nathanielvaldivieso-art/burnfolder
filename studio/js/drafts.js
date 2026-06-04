(function () {
  'use strict';

  const STORAGE_KEY = 'burnfolderStudioDrafts';
  const CLOUD_KEY = 'drafts';

  function makeId() {
    return 'draft-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
  }

  function readStore() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 1, drafts: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.drafts)) return { version: 1, drafts: [] };
      return parsed;
    } catch {
      return { version: 1, drafts: [] };
    }
  }

  function writeStore(store) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    const cs = window.BurnfolderCloudState;
    if (cs && cs.put) cs.put(CLOUD_KEY, store);
  }

  // Personal-cloud hydration: pull drafts once per page load so entries you
  // wrote on another device are available here. Cloud is the source of truth;
  // an empty cloud is seeded from whatever is local (first run).
  let hydratePromise = null;
  function ensureHydrated() {
    if (hydratePromise) return hydratePromise;
    const cs = window.BurnfolderCloudState;
    if (!cs || !cs.get) {
      hydratePromise = Promise.resolve();
      return hydratePromise;
    }
    hydratePromise = cs.get(CLOUD_KEY).then(function (value) {
      if (value && Array.isArray(value.drafts)) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        window.dispatchEvent(new CustomEvent('burnfolder-drafts-synced'));
      } else if (value === null) {
        const local = readStore();
        if (local.drafts.length && cs.put) cs.put(CLOUD_KEY, local);
      }
    }).catch(function () {});
    return hydratePromise;
  }

  function sortDrafts(drafts) {
    return drafts.slice().sort(function (a, b) {
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });
  }

  function listDrafts() {
    return ensureHydrated().then(function () {
      const store = readStore();
      return sortDrafts(store.drafts).map(function (d) {
        return {
          id: d.id,
          date_key: d.date_key,
          status: d.status || 'draft',
          updated_at: d.updated_at,
          published_at: d.published_at || null
        };
      });
    });
  }

  function getDraftById(id) {
    return ensureHydrated().then(function () {
      const store = readStore();
      return store.drafts.find(function (d) { return d.id === id; }) || null;
    });
  }

  function upsertDraft(opts) {
    return ensureHydrated().then(function () {
      const store = readStore();
      const now = new Date().toISOString();
      const dateKey = opts.dateKey;
      const id = opts.id;
      const blocks = opts.blocks;
      const status = opts.status || 'draft';

      const existingIndex = id
        ? store.drafts.findIndex(function (d) { return d.id === id; })
        : store.drafts.findIndex(function (d) { return d.date_key === dateKey; });

      const row = {
        id: existingIndex >= 0 ? store.drafts[existingIndex].id : id || makeId(),
        date_key: dateKey,
        blocks: blocks || [],
        status: status,
        updated_at: now,
        published_at: existingIndex >= 0 ? store.drafts[existingIndex].published_at : null
      };

      if (existingIndex >= 0) {
        store.drafts[existingIndex] = Object.assign({}, store.drafts[existingIndex], row);
      } else {
        store.drafts.push(row);
      }

      writeStore(store);
      return row;
    });
  }

  function markDraftPublished(id) {
    return ensureHydrated().then(function () {
      const store = readStore();
      const draft = store.drafts.find(function (d) { return d.id === id; });
      if (!draft) throw new Error('draft not found');

      draft.status = 'published';
      draft.published_at = new Date().toISOString();
      draft.updated_at = draft.published_at;
      writeStore(store);
      return draft;
    });
  }

  function createDraft(dateKey) {
    return upsertDraft({
      dateKey: dateKey,
      blocks: [{ type: 'text', text: '' }],
      status: 'draft'
    });
  }

  function deleteDraft(id) {
    return ensureHydrated().then(function () {
      const store = readStore();
      store.drafts = store.drafts.filter(function (d) { return d.id !== id; });
      writeStore(store);
    });
  }

  window.BurnfolderDrafts = {
    listDrafts: listDrafts,
    getDraftById: getDraftById,
    upsertDraft: upsertDraft,
    markDraftPublished: markDraftPublished,
    createDraft: createDraft,
    deleteDraft: deleteDraft
  };
})();
