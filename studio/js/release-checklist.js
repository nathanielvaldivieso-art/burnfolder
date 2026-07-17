/**
 * Pre-release checklist (§9.4) — rule engine. AI assist is read-only via studio-ai.
 */
(function () {
  'use strict';

  function isMasterFile(name) {
    return /\.(wav|flac|aiff?)$/i.test(String(name || ''));
  }

  /**
   * @param {object} release draft
   * @param {object} [ctx]
   * @returns {{ ok: boolean, items: Array<{ id, label, ok, detail }> }}
   */
  function evaluate(release, ctx) {
    const r = release || {};
    const tracks = Array.isArray(r.tracks) ? r.tracks : [];
    const items = [];

    function add(id, label, ok, detail) {
      items.push({ id: id, label: label, ok: !!ok, detail: detail || '' });
    }

    add('title', 'release title', !!(r.title && String(r.title).trim()), 'needed for LabelGrid + DSPs');

    add(
      'tracks',
      'at least one track',
      tracks.length > 0,
      tracks.length ? tracks.length + ' track(s)' : 'add tracks from a music project'
    );

    const mastersOk =
      tracks.length > 0 &&
      tracks.every(function (t) {
        return t && t.vaultKey;
      });
    add(
      'masters',
      'master in vault for every track',
      mastersOk,
      mastersOk ? 'all tracks have R2 masters' : 'upload WAV/FLAC masters'
    );

    const formatOk =
      tracks.length > 0 &&
      tracks.every(function (t) {
        return !t.fileName || isMasterFile(t.fileName);
      });
    add(
      'format',
      'master format looks like WAV/FLAC/AIFF',
      formatOk,
      formatOk ? 'ok' : 'prefer WAV or FLAC masters'
    );

    add(
      'artwork',
      'cover art in vault',
      !!r.artworkVaultKey,
      r.artworkVaultKey ? 'attached' : 'upload 3000×3000 JPG/PNG'
    );

    add(
      'artwork_size',
      'artwork noted as 3000×3000',
      r.artworkSizeOk !== false ? !!r.artworkVaultKey : false,
      r.artworkSizeOk === false ? 'fix dimensions before submit' : 'confirm square 3000px in checklist'
    );

    add(
      'explicit',
      'explicit flag set',
      !!r.explicit && ['off', 'on', 'edited'].indexOf(r.explicit) > -1,
      r.explicit || 'pick off / on / edited'
    );

    add(
      'credits',
      'credits / rights name',
      !!(r.rightsName && String(r.rightsName).trim()) || !!(ctx && ctx.rightsName),
      'writers, producers, featured — also set in LabelGrid prefs'
    );

    add(
      'release_date',
      'release date',
      !!r.releaseDate,
      r.releaseDate || 'set original release date'
    );

    // ISRC optional until LabelGrid returns one — pass if blank or present
    const isrcNotes = tracks
      .map(function (t) {
        return t && t.isrc ? t.isrc : null;
      })
      .filter(Boolean);
    add(
      'isrc',
      'ISRC (optional until LabelGrid assigns)',
      true,
      isrcNotes.length
        ? isrcNotes.length + ' locked/assigned'
        : 'leave blank — LabelGrid assigns on create/submit'
    );

    const upcOk = !r.upc || String(r.upc).length >= 12;
    add('upc', 'UPC / barcode (optional — auto if blank)', upcOk, r.upc || 'LabelGrid can auto-generate');

    const ok = items.every(function (item) {
      if (item.id === 'isrc' || item.id === 'upc') return true;
      if (item.id === 'format') return true; // advisory
      return item.ok;
    });

    return { ok: ok, items: items };
  }

  function renderList(container, result) {
    if (!container) return;
    container.innerHTML = '';
    const list = document.createElement('ul');
    list.className = 'studio-release-checklist';
    (result.items || []).forEach(function (item) {
      const li = document.createElement('li');
      li.className = 'studio-release-check' + (item.ok ? ' is-ok' : ' is-gap');
      li.innerHTML =
        '<span class="studio-release-check-mark" aria-hidden="true">' +
        (item.ok ? '✓' : '·') +
        '</span>' +
        '<span class="studio-release-check-label">' +
        escapeHtml(item.label) +
        '</span>' +
        (item.detail
          ? '<span class="studio-release-check-detail">' + escapeHtml(item.detail) + '</span>'
          : '');
      list.appendChild(li);
    });
    container.appendChild(list);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.BurnfolderReleaseChecklist = {
    evaluate: evaluate,
    renderList: renderList
  };
})();
