(function () {
  'use strict';

  const store = window.BurnfolderJournalDays;
  if (!store) return;

  let activeDateKey = null;

  function todayKey() {
    return store.todayKey();
  }

  function getActiveDateKey() {
    return activeDateKey || todayKey();
  }

  function setActiveDateKey(key) {
    activeDateKey = key ? String(key).trim() : null;
  }

  function dateKeyFromIso(iso) {
    if (!iso) return todayKey();
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return todayKey();
    return store.keyFromDate(date);
  }

  function fromAsset(asset) {
    if (!asset) return null;
    const playbackId = asset.muxPlaybackId || asset.playbackId;
    if (!playbackId) return null;
    const dateKey = asset.contributionDateKey || dateKeyFromIso(asset.createdAt);
    return {
      id: asset.id || playbackId,
      playbackId: String(playbackId),
      muxAssetId: asset.muxAssetId || null,
      kind: asset.kind === 'video' ? 'video' : 'audio',
      title: asset.displayTitle || asset.name || asset.passthrough || 'untitled',
      addedAt: asset.createdAt || new Date().toISOString(),
      dateKey: dateKey
    };
  }

  function registerAsset(asset) {
    const item = fromAsset(asset);
    if (!item || !store.upsertContribution) return Promise.resolve(null);
    return store.upsertContribution(item.dateKey, item).then(function () {
      window.dispatchEvent(
        new CustomEvent('burnfolder-journal-contributions-changed', {
          detail: { dateKey: item.dateKey, playbackId: item.playbackId }
        })
      );
      return item;
    });
  }

  function syncLocalLibrary() {
    const cloud = window.BurnfolderAssetCloud;
    if (!cloud || !cloud.listAssets) return Promise.resolve(0);
    return cloud.listAssets().then(function (rows) {
      return Promise.all(
        (rows || []).map(function (row) {
          return registerAsset(row);
        })
      ).then(function () {
        return rows.length;
      });
    });
  }

  function syncMuxLibrary() {
    const mux = window.BurnfolderStudioMux;
    if (!mux || !mux.listMuxLibrary) return Promise.resolve(0);
    return mux.listMuxLibrary().then(function (items) {
      return Promise.all(
        (items || []).map(function (item) {
          return registerAsset(item);
        })
      ).then(function () {
        return items.length;
      });
    }).catch(function () {
      return 0;
    });
  }

  function syncAll() {
    return syncLocalLibrary().then(function () {
      return syncMuxLibrary();
    });
  }

  function listForDay(dateKey) {
    const key = String(dateKey || '').trim() || todayKey();
    return store.getDay(key).then(function (day) {
      return (day.contributions || []).slice().sort(function (a, b) {
        return String(b.addedAt || '').localeCompare(String(a.addedAt || ''));
      });
    });
  }

  function daysWithContributions() {
    return store.listDays().then(function (days) {
      const set = new Set();
      (days || []).forEach(function (day) {
        if (day.contributions && day.contributions.length) set.add(day.dateKey);
      });
      return set;
    });
  }

  if (!window.__journalContributionsBound) {
    window.__journalContributionsBound = true;
    window.addEventListener('burnfolder-assets-changed', function (event) {
      const detail = event && event.detail;
      if (detail && detail.type === 'add' && detail.asset) {
        registerAsset(detail.asset);
      }
    });
  }

  window.BurnfolderJournalContributions = {
    getActiveDateKey: getActiveDateKey,
    setActiveDateKey: setActiveDateKey,
    dateKeyFromIso: dateKeyFromIso,
    registerAsset: registerAsset,
    syncAll: syncAll,
    listForDay: listForDay,
    daysWithContributions: daysWithContributions
  };
})();
