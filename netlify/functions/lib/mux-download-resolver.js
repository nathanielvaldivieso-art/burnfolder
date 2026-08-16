'use strict';

/**
 * Resolves a real, downloadable Mux static rendition for a playback ID.
 *
 * Two failure modes this exists to prevent:
 *  - Guessing `/highest.mp4` on an asset that has no such rendition: Mux answers
 *    with a ~64 byte error body that the browser saves as the "download".
 *  - Naming a video `.m4a` (or vice versa) because a caller's stored `kind` was
 *    stale: the file downloads as the wrong media type. The extension is always
 *    forced to match the rendition actually served.
 */

const { muxGet, muxPost, assetIdForPlaybackId } = require('./mux-client');

const MIN_MEDIA_BYTES = 4096;

/**
 * Mux has shipped several shapes for this field: a `{ status, files: [] }` object
 * (mp4_support era) and a flat array of rendition objects (static renditions API).
 */
function collectRenditions(asset) {
  const raw = asset && asset.static_renditions;
  if (!raw) return { status: '', files: [] };

  const list = Array.isArray(raw) ? raw : Array.isArray(raw.files) ? raw.files : [];
  const overall = !Array.isArray(raw) && raw.status ? String(raw.status) : '';

  const files = list
    .map(function (file) {
      if (!file) return null;
      const name = String(file.name || '');
      const ext = String(file.ext || (name.indexOf('.') > -1 ? name.split('.').pop() : ''));
      return {
        name: name,
        ext: ext.toLowerCase(),
        // Per-file status only exists in the newer API; fall back to the parent status.
        status: String(file.status || overall || 'ready').toLowerCase(),
        filesize: Number(file.filesize || 0) || 0,
        resolution: String(file.resolution || '')
      };
    })
    .filter(function (file) {
      return file && file.name;
    });

  return { status: overall.toLowerCase(), files: files };
}

function assetHasVideoTrack(asset) {
  const tracks = (asset && asset.tracks) || [];
  return tracks.some(function (track) {
    return track && track.type === 'video';
  });
}

function rankRendition(file, wantVideo) {
  const name = file.name.toLowerCase();
  if (wantVideo) {
    if (file.ext !== 'mp4') return -1;
    if (name.indexOf('highest') > -1) return 100;
    if (name.indexOf('capped') > -1) return 90;
    if (name.indexOf('1080') > -1) return 80;
    if (name.indexOf('720') > -1) return 70;
    if (name.indexOf('medium') > -1) return 60;
    if (name.indexOf('low') > -1) return 50;
    return 40;
  }
  if (file.ext === 'm4a') return 100;
  if (file.ext === 'mp4') return 50;
  return -1;
}

function pickRendition(files, wantVideo) {
  let best = null;
  let bestRank = 0;
  files.forEach(function (file) {
    if (file.status !== 'ready') return;
    const rank = rankRendition(file, wantVideo);
    if (rank > bestRank) {
      best = file;
      bestRank = rank;
    }
  });
  return best;
}

function anyPreparing(files, overallStatus) {
  if (overallStatus === 'preparing') return true;
  return files.some(function (file) {
    return file.status === 'preparing';
  });
}

/** Forces the saved filename to match the rendition, so video never lands as .m4a. */
function filenameForRendition(filename, ext, fallbackBase) {
  const safeExt = String(ext || '').replace(/^\./, '').toLowerCase() || 'mp4';
  const base = String(filename || fallbackBase || 'clip')
    .replace(/[\\/]/g, '-')
    .replace(/[^\w.\-()+ ]/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .slice(0, 160);
  return (base || 'clip') + '.' + safeExt;
}

function renditionUrl(playbackId, name, filename) {
  const base = 'https://stream.mux.com/' + encodeURIComponent(playbackId) + '/' + encodeURIComponent(name);
  return filename ? base + '?download=' + encodeURIComponent(filename) : base;
}

/** Confirms the CDN serves real media, so we never hand back an error body. */
async function verifyMediaUrl(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1' } });
    if (!res.ok && res.status !== 206) {
      return { ok: false, reason: 'cdn returned ' + res.status };
    }

    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type && !/^(video|audio|application\/octet-stream|binary)/.test(type)) {
      return { ok: false, reason: 'unexpected content type ' + type };
    }

    // Range responses report the full size after the slash in content-range.
    const range = res.headers.get('content-range') || '';
    const total = range.indexOf('/') > -1 ? parseInt(range.split('/')[1], 10) : NaN;
    const length = Number.isFinite(total) ? total : parseInt(res.headers.get('content-length') || '0', 10);
    if (Number.isFinite(length) && length > 0 && length < MIN_MEDIA_BYTES) {
      return { ok: false, reason: 'file is only ' + length + ' bytes' };
    }

    return { ok: true, bytes: Number.isFinite(length) && length > 0 ? length : null };
  } catch (error) {
    return { ok: false, reason: error.message || 'could not reach cdn' };
  }
}

async function requestRenditions(auth, assetId, wantVideo) {
  const resolutions = wantVideo ? ['highest', 'audio-only'] : ['audio-only'];
  const errors = [];
  let created = 0;

  for (let i = 0; i < resolutions.length; i += 1) {
    const result = await muxPost(
      '/video/v1/assets/' + encodeURIComponent(assetId) + '/static-renditions',
      auth,
      { resolution: resolutions[i] }
    );
    if (result.ok) created += 1;
    else {
      const message =
        (result.data && result.data.error && (result.data.error.messages || [])[0]) ||
        'mux returned ' + result.status;
      errors.push(resolutions[i] + ': ' + message);
    }
  }

  return { created: created, errors: errors };
}

/**
 * @returns {Promise<{status: string, statusCode: number, url?: string, rendition?: string,
 *   kind?: string, bytes?: number|null, filename?: string, message?: string}>}
 */
async function resolveMuxDownload(options) {
  const opts = options || {};
  const auth = opts.auth;
  const playbackId = String(opts.playbackId || '').trim();
  const requestedKind = String(opts.kind || '').trim().toLowerCase();
  const mayPrepare = opts.mayPrepare !== false;

  if (!playbackId) {
    return { status: 'error', statusCode: 400, message: 'playbackId required' };
  }

  const assetId = await assetIdForPlaybackId(playbackId, auth);
  if (!assetId) {
    return { status: 'error', statusCode: 404, message: 'No Mux asset for this playback id' };
  }

  const assetRes = await muxGet('/video/v1/assets/' + encodeURIComponent(assetId), auth);
  const asset = assetRes.ok && assetRes.data ? assetRes.data.data : null;
  if (!asset) {
    return { status: 'error', statusCode: 404, message: 'Mux asset not found' };
  }

  if (asset.status === 'preparing') {
    return {
      status: 'preparing',
      statusCode: 202,
      message: 'still processing on mux — try again shortly'
    };
  }
  if (asset.status === 'errored') {
    return {
      status: 'errored',
      statusCode: 409,
      message: 'this asset failed to process on mux'
    };
  }

  // Mux tracks are authoritative; a caller's stored kind can be stale.
  const hasTracks = Array.isArray(asset.tracks) && asset.tracks.length > 0;
  const wantVideo = hasTracks ? assetHasVideoTrack(asset) : requestedKind === 'video';

  const renditions = collectRenditions(asset);
  const pick = pickRendition(renditions.files, wantVideo);

  if (pick) {
    const filename = filenameForRendition(opts.filename, pick.ext, opts.fallbackBase);
    const url = renditionUrl(playbackId, pick.name, filename);
    const check = await verifyMediaUrl(url);
    if (check.ok) {
      return {
        status: 'ready',
        statusCode: 200,
        url: url,
        rendition: pick.name,
        kind: wantVideo ? 'video' : 'audio',
        filename: filename,
        bytes: check.bytes || pick.filesize || null
      };
    }
    // Mux said ready but the CDN disagrees — report it instead of saving junk.
    return {
      status: 'unavailable',
      statusCode: 409,
      message: 'mux rendition is not downloadable yet (' + check.reason + ')'
    };
  }

  if (anyPreparing(renditions.files, renditions.status)) {
    return {
      status: 'preparing',
      statusCode: 202,
      message: 'download file is still being prepared — try again shortly'
    };
  }

  if (!mayPrepare) {
    return {
      status: 'missing',
      statusCode: 409,
      message: 'no downloadable file for this clip yet'
    };
  }

  const prepared = await requestRenditions(auth, assetId, wantVideo);
  if (prepared.created) {
    return {
      status: 'preparing',
      statusCode: 202,
      message: 'preparing a download file — try again in a minute'
    };
  }

  return {
    status: 'missing',
    statusCode: 409,
    message: 'mux could not prepare a download: ' + (prepared.errors[0] || 'unknown error')
  };
}

module.exports = {
  resolveMuxDownload: resolveMuxDownload,
  collectRenditions: collectRenditions,
  pickRendition: pickRendition,
  filenameForRendition: filenameForRendition,
  renditionUrl: renditionUrl,
  assetHasVideoTrack: assetHasVideoTrack,
  MIN_MEDIA_BYTES: MIN_MEDIA_BYTES
};
