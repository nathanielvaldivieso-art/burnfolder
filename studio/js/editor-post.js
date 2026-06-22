(function () {
  'use strict';

  function publishPanelOpts() {
    return {
      onStatus: window.studioEditorSetStatus,
      onPublishLive: function () {
        const id = window.burnfolderStudio.draftId;
        if (id && window.BurnfolderDrafts && window.BurnfolderDrafts.markDraftPublished) {
          return window.BurnfolderDrafts.markDraftPublished(id).then(function () {
            window.studioEditorRenderMeta({
              date_key: document.getElementById('entryDate').value,
              status: 'published'
            });
          });
        }
        window.studioEditorRenderMeta({
          date_key: document.getElementById('entryDate').value,
          status: 'published'
        });
      },
      onMarkPublished: function () {
        const id = window.burnfolderStudio.draftId;
        if (!id) {
          window.studioEditorSetStatus('save draft first');
          return;
        }
        return window.BurnfolderDrafts.markDraftPublished(id).then(function () {
          window.studioEditorSetStatus('marked published locally — paste files into burnfolder.com for live site');
          window.studioEditorRenderMeta({
            date_key: document.getElementById('entryDate').value,
            status: 'published'
          });
        });
      }
    };
  }

  window.studioInitEditorPost = function () {
    if (!window.studioEditorReady || !window.burnfolderStudio) return;
    if (!window.initBurnfolderPublishPanel) return;

    const liveBtn = document.getElementById('publishLiveBtn');
    if (!liveBtn || liveBtn.dataset.publishPanelBound === '1') return;
    liveBtn.dataset.publishPanelBound = '1';

    window.initBurnfolderPublishPanel(publishPanelOpts());
  };

  if (window.studioEditorReady && window.burnfolderStudio) {
    window.studioInitEditorPost();
  }
})();
