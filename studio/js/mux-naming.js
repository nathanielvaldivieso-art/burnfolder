(function () {
  'use strict';

  const core = window.BurnfolderMuxDisplayName;

  function sanitizeFileName(name) {
    if (core) return core.sanitizeFileName(name);
    return String(name || 'file')
      .trim()
      .replace(/[^\w.\-()+ ]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200) || 'file';
  }

  function splitFileName(fileName) {
    const safe = sanitizeFileName(fileName);
    const dot = safe.lastIndexOf('.');
    if (dot <= 0) return { base: safe, ext: '' };
    return { base: safe.slice(0, dot), ext: safe.slice(dot) };
  }

  function uniqueMuxFileName(fileName, takenSet) {
    const taken = takenSet || new Set();
    const parts = splitFileName(fileName);
    let n = 1;
    let candidate = parts.base + parts.ext;

    while (taken.has(candidate)) {
      n += 1;
      candidate = parts.base + '-' + n + parts.ext;
    }

    taken.add(candidate);
    return candidate;
  }

  function titleFromMuxFileName(muxFileName) {
    if (core) return core.displayTitleFromFileName(muxFileName);
    const parts = splitFileName(muxFileName);
    return parts.base || muxFileName;
  }

  function collectTakenPassthroughs(assets) {
    const taken = new Set();
    (assets || []).forEach(function (asset) {
      if (asset.muxPassthrough) taken.add(asset.muxPassthrough);
      if (asset.name) taken.add(sanitizeFileName(asset.name));
    });
    return taken;
  }

  function buildSitePlaybackTitleMap() {
    if (core) return core.buildSitePlaybackTitleMap(window);
    return new Map();
  }

  function isGenericMuxName(name) {
    if (core) return core.isGenericMuxLabel(name);
    const n = String(name || '').trim();
    return !n || /^untitled-/i.test(n) || /^asset-/i.test(n);
  }

  window.BurnfolderMuxNaming = {
    sanitizeFileName: sanitizeFileName,
    uniqueMuxFileName: uniqueMuxFileName,
    titleFromMuxFileName: titleFromMuxFileName,
    collectTakenPassthroughs: collectTakenPassthroughs,
    buildSitePlaybackTitleMap: buildSitePlaybackTitleMap,
    isGenericMuxName: isGenericMuxName
  };
})();
