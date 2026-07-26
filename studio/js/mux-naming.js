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

  function titleFromMuxFileName(muxFileName) {
    if (core) return core.displayTitleFromFileName(muxFileName);
    const parts = splitFileName(muxFileName);
    return parts.base || muxFileName;
  }

  window.BurnfolderMuxNaming = {
    sanitizeFileName: sanitizeFileName,
    titleFromMuxFileName: titleFromMuxFileName
  };
})();
