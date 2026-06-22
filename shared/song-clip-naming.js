(function (root) {
  'use strict';

  const CLIP_SEP = ' — ';

  function extensionFromName(fileName) {
    const safe = String(fileName || '');
    const dot = safe.lastIndexOf('.');
    if (dot <= 0 || dot === safe.length - 1) return '';
    return safe.slice(dot);
  }

  function baseNameFromFile(fileName) {
    const safe = String(fileName || '').trim();
    const dot = safe.lastIndexOf('.');
    if (dot <= 0) return safe;
    return safe.slice(0, dot);
  }

  function sanitizeMuxName(value) {
    const naming = root.BurnfolderMuxNaming;
    if (naming && naming.sanitizeFileName) return naming.sanitizeFileName(value);
    return String(value || 'file')
      .trim()
      .replace(/[^\w.\-()+ ]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200) || 'file';
  }

  function buildClipMuxFileName(songTitle, clipLabel, originalFileName) {
    const song = String(songTitle || 'untitled').trim();
    let clip = String(clipLabel || '').trim();
    if (!clip) clip = baseNameFromFile(originalFileName) || 'clip';
    const ext = extensionFromName(originalFileName) || '.mp4';
    return sanitizeMuxName(song + CLIP_SEP + clip + ext);
  }

  function clipDisplayTitle(songTitle, clipLabel) {
    const song = String(songTitle || 'untitled').trim();
    const clip = String(clipLabel || 'clip').trim() || 'clip';
    return song + CLIP_SEP + clip;
  }

  function clipLabelFromPassthrough(passthrough, songTitle) {
    const value = String(passthrough || '').trim();
    if (!value) return '';

    const prefix = String(songTitle || '').trim();
    if (prefix && value.indexOf(prefix + CLIP_SEP) === 0) {
      return value.slice((prefix + CLIP_SEP).length).trim();
    }

    const sep = value.indexOf(CLIP_SEP);
    if (sep > 0) return value.slice(sep + CLIP_SEP.length).trim();
    return value;
  }

  function inferSongGroupKey(passthrough, versionsApi) {
    const value = String(passthrough || '').trim();
    const sep = value.indexOf(CLIP_SEP);
    if (sep <= 0 || !versionsApi || !versionsApi.getTrackGroupKey) return '';
    return versionsApi.getTrackGroupKey(value.slice(0, sep).trim());
  }

  function isSongClipPassthrough(passthrough) {
    return String(passthrough || '').indexOf(CLIP_SEP) > 0;
  }

  root.BurnfolderSongClipNaming = {
    CLIP_SEP: CLIP_SEP,
    buildClipMuxFileName: buildClipMuxFileName,
    clipDisplayTitle: clipDisplayTitle,
    clipLabelFromPassthrough: clipLabelFromPassthrough,
    inferSongGroupKey: inferSongGroupKey,
    isSongClipPassthrough: isSongClipPassthrough
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
