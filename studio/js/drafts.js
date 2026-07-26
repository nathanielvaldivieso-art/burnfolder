(function (root) {
  'use strict';

  const kit = root.BurnfolderCloudStoreKit;
  const cloudStore = kit.createLocalCloudStore({
    storageKey: 'burnfolderStudioDrafts',
    cloudKey: 'drafts',
    emptyState: function () {
      return { version: 1, drafts: [] };
    },
    isValidLocal: function (parsed) {
      return Array.isArray(parsed.drafts);
    },
    hasLocalContent: function (local) {
      return local.drafts.length;
    },
    syncEventName: 'burnfolder-drafts-synced'
  });
  const readStore = cloudStore.readStore;
  const writeStore = cloudStore.writeStore;
  const ensureHydrated = cloudStore.ensureHydrated;

  function makeId() {
    return kit.makeId('draft');
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

  root.BurnfolderDrafts = {
    listDrafts: listDrafts,
    getDraftById: getDraftById,
    upsertDraft: upsertDraft,
    markDraftPublished: markDraftPublished,
    createDraft: createDraft,
    deleteDraft: deleteDraft
  };
})(typeof window !== 'undefined' ? window : globalThis);
