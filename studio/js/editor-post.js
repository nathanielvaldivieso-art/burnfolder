(function () {
  'use strict';

  if (!window.studioEditorReady || !window.burnfolderStudio) return;

  window.initBurnfolderPublishPanel({
    onStatus: window.studioEditorSetStatus,
    onPublishLive: function (data) {
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
  });
})();
