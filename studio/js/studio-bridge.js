(function () {
  'use strict';

  function todayKey() {
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

    function setStatus(message) {
      if (opts.onStatus) opts.onStatus(message);
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

          if (opts.onDraftMeta) opts.onDraftMeta(row);

          setStatus('loaded ' + row.date_key);
          return {
            date: row.date_key,
            blocks: Array.isArray(row.blocks) ? row.blocks : []
          };
        });
      },

      persistDraft: function (payload) {
        if (saveTimer) window.clearTimeout(saveTimer);

        saveTimer = window.setTimeout(function () {
          if (saving) return;
          saving = true;

          const dateKey = String(payload.date || '').trim() || todayKey();

          drafts
            .upsertDraft({
              id: currentDraftId,
              dateKey: dateKey,
              blocks: blocksForStorage(payload.blocks),
              status: 'draft'
            })
            .then(function (saved) {
              currentDraftId = saved.id;
              window.burnfolderStudio.draftId = saved.id;

              const url = new URL(window.location.href);
              if (url.searchParams.get('id') !== saved.id) {
                url.searchParams.set('id', saved.id);
                window.history.replaceState({}, '', url);
              }

              if (opts.onDraftMeta) opts.onDraftMeta(saved);
              setStatus('saved ' + dateKey);
            })
            .catch(function (error) {
              setStatus(error.message || 'save failed');
            })
            .finally(function () {
              saving = false;
            });
        }, 600);
      }
    };
  };
})();
