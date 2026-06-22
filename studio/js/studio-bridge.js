(function () {
  'use strict';

  function todayKey() {
    if (window.BurnfolderStudioDates) return window.BurnfolderStudioDates.todayKey();
    const now = new Date();
    return (now.getMonth() + 1) + '.' + now.getDate() + '.' + String(now.getFullYear()).slice(-2);
  }

  function blocksForStorage(blocks) {
    return (blocks || []).map(function (block) {
      return Object.assign({}, block);
    });
  }

  window.installBurnfolderStudioBridge = function (opts) {
    const drafts = window.BurnfolderDrafts;
    let currentDraftId = opts.draftId || null;
    let saveTimer = null;
    let saving = false;
    let dirty = false;
    let latestPayload = null;
    let openedRevision = null;

    function setStatus(message) {
      if (opts.onStatus) opts.onStatus(message);
    }

    function scheduleSave(delayMs) {
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(runSave, typeof delayMs === 'number' ? delayMs : 600);
    }

    function runSave() {
      saveTimer = null;
      if (saving || !dirty || !latestPayload) return;

      saving = true;
      dirty = false;
      const payload = latestPayload;
      const dateKey = String(payload.date || '').trim() || todayKey();

      drafts
        .getDraftById(currentDraftId)
        .then(function (existing) {
          if (
            existing &&
            openedRevision &&
            existing.updated_at &&
            existing.updated_at > openedRevision &&
            existing.id === currentDraftId
          ) {
            setStatus('cloud copy is newer — saved anyway (reload to discard local)');
          }
          return drafts.upsertDraft({
            id: currentDraftId,
            dateKey: dateKey,
            blocks: blocksForStorage(payload.blocks),
            status: 'draft'
          });
        })
        .then(function (saved) {
          currentDraftId = saved.id;
          window.burnfolderStudio.draftId = saved.id;
          openedRevision = saved.updated_at || openedRevision;

          const url = new URL(window.location.href);
          if (url.searchParams.get('id') !== saved.id) {
            url.searchParams.set('id', saved.id);
            window.history.replaceState({}, '', url);
          }

          if (opts.onDraftMeta) opts.onDraftMeta(saved);
          setStatus('saved ' + dateKey);
        })
        .catch(function (error) {
          dirty = true;
          setStatus(error.message || 'save failed');
        })
        .finally(function () {
          saving = false;
          if (dirty) scheduleSave(0);
        });
    }

    window.burnfolderStudio = {
      draftId: currentDraftId,

      loadInitialDraft: function () {
        if (!currentDraftId) {
          const params = new URLSearchParams(window.location.search);
          currentDraftId = params.get('id');
        }

        if (!currentDraftId) return Promise.resolve(null);

        return drafts.getDraftById(currentDraftId).then(function (row) {
          if (!row) {
            setStatus('draft not found');
            return null;
          }

          currentDraftId = row.id;
          window.burnfolderStudio.draftId = row.id;
          openedRevision = row.updated_at || null;

          if (opts.onDraftMeta) opts.onDraftMeta(row);

          setStatus('loaded ' + row.date_key);
          return {
            date: row.date_key,
            blocks: Array.isArray(row.blocks) ? row.blocks : []
          };
        });
      },

      persistDraft: function (payload) {
        latestPayload = payload;
        dirty = true;
        scheduleSave();
      },

      flushDraft: function () {
        if (saveTimer) {
          window.clearTimeout(saveTimer);
          saveTimer = null;
        }
        if (!latestPayload) return Promise.resolve();
        dirty = true;
        runSave();
        if (!saving) return Promise.resolve();
        return new Promise(function (resolve) {
          (function wait() {
            if (!saving) {
              resolve();
              return;
            }
            window.setTimeout(wait, 50);
          })();
        });
      }
    };
  };
})();
