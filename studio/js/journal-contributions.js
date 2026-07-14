(function () {
  'use strict';

  const store = window.BurnfolderJournalDays;
  if (!store) return;

  let activeDateKey = null;
  const REBUILD_FLAG = 'bf_journal_contrib_rebuild_v1';

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

  function explicitDateKey(asset) {
    if (!asset) return '';
    return String(asset.contributionDateKey || '').trim();
  }

  function fromAsset(asset) {
    if (!asset) return null;
    const playbackId = asset.muxPlaybackId || asset.playbackId;
    if (!playbackId) return null;
    // Only count uploads that were intentionally stamped for a journal day.
    // Never treat the whole Mux / stream catalog as daily contributions.
    const dateKey = explicitDateKey(asset);
    if (!dateKey) return null;
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

  function rebuildFromExplicitAssets() {
    if (!store.clearAllContributions) return Promise.resolve(0);
    const cloud = window.BurnfolderAssetCloud;
    // Full catalog was previously dumped onto journal days. Wipe those lists
    // and strip auto-stamped date keys so only future journal uploads attach.
    const clearKeys =
      cloud && cloud.clearContributionDateKeys
        ? cloud.clearContributionDateKeys()
        : Promise.resolve(0);
    return store.clearAllContributions().then(function () {
      return clearKeys;
    }).then(function () {
      return 0;
    });
  }

  function syncAll(opts) {
    const options = opts || {};
    const now = Date.now();
    if (
      !options.force &&
      syncAll.lastAt &&
      now - syncAll.lastAt < 120000
    ) {
      return Promise.resolve(0);
    }
    syncAll.lastAt = now;

    // One-time cleanup: older builds dumped the entire catalog onto journal days.
    let needsRebuild = !!options.force;
    try {
      if (!window.localStorage.getItem(REBUILD_FLAG)) needsRebuild = true;
    } catch (e) {
      needsRebuild = true;
    }

    if (!needsRebuild) return Promise.resolve(0);

    return rebuildFromExplicitAssets().then(function (count) {
      try {
        window.localStorage.setItem(REBUILD_FLAG, '1');
      } catch (e2) {
        /* noop */
      }
      return count;
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
      if (detail && detail.type === 'add' && detail.asset && explicitDateKey(detail.asset)) {
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
    rebuildFromExplicitAssets: rebuildFromExplicitAssets,
    listForDay: listForDay,
    daysWithContributions: daysWithContributions
  };
})();
