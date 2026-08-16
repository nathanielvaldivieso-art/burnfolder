'use strict';

/**
 * Resolves a real downloadable file for a Mux playback ID.
 *
 * Guessing `stream.mux.com/<id>/highest.mp4` returns a ~64 byte error body for any
 * asset without that rendition, and the browser happily saves it as the .mp4.
 * This endpoint only hands back a URL after Mux reports the rendition ready and a
 * range request confirms real media bytes.
 */

const { studioCorsHeaders, requireWorkspaceAccess, canWriteStudioState } = require('./lib/workspace-auth');
const { muxAuthHeader, muxGet, muxPost, assetIdForPlaybackId } = require('./lib/mux-client');

const MIN_MEDIA_BYTES = 4096;

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

function json(statusCode, payload) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(payload) };
}

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

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { message: 'Method Not Allowed' });
  }

  const access = await requireWorkspaceAccess(event, { requireWrite: false });
  if (!access.ok) return json(access.statusCode, access.body);

  const params = event.queryStringParameters || {};
  const playbackId = String(params.playbackId || '').trim();
  if (!playbackId) return json(400, { message: 'playbackId required' });

  const filename = String(params.filename || '').trim();
  const requestedKind = String(params.kind || '').trim().toLowerCase();
  const mayPrepare = params.prepare !== '0' && canWriteStudioState(access);

  const auth = muxAuthHeader();
  if (!auth) return json(503, { message: 'Mux is not configured on the server.' });

  try {
    const assetId = await assetIdForPlaybackId(playbackId, auth);
    if (!assetId) return json(404, { message: 'No Mux asset for this playback id' });

    const assetRes = await muxGet('/video/v1/assets/' + encodeURIComponent(assetId), auth);
    const asset = assetRes.ok && assetRes.data ? assetRes.data.data : null;
    if (!asset) return json(404, { message: 'Mux asset not found' });

    if (asset.status === 'preparing') {
      return json(202, { status: 'preparing', message: 'still processing on mux — try again shortly' });
    }
    if (asset.status === 'errored') {
      return json(409, { status: 'errored', message: 'this asset failed to process on mux' });
    }

    // Trust Mux tracks over the caller's guess; fall back to the caller's kind.
    const wantVideo = assetHasVideoTrack(asset) || (requestedKind === 'video' && !asset.tracks);
    const renditions = collectRenditions(asset);
    const pick = pickRendition(renditions.files, wantVideo);

    if (pick) {
      const url = renditionUrl(playbackId, pick.name, filename);
      const check = await verifyMediaUrl(url);
      if (check.ok) {
        return json(200, {
          status: 'ready',
          url: url,
          downloadUrl: url,
          rendition: pick.name,
          kind: wantVideo ? 'video' : 'audio',
          bytes: check.bytes || pick.filesize || null
        });
      }
      // Mux said ready but the CDN disagrees — report it instead of saving junk.
      return json(409, {
        status: 'unavailable',
        message: 'mux rendition is not downloadable yet (' + check.reason + ')'
      });
    }

    if (anyPreparing(renditions.files, renditions.status)) {
      return json(202, { status: 'preparing', message: 'download file is still being prepared — try again shortly' });
    }

    if (!mayPrepare) {
      return json(409, {
        status: 'missing',
        message: 'no downloadable file for this clip yet'
      });
    }

    const prepared = await requestRenditions(auth, assetId, wantVideo);
    if (prepared.created) {
      return json(202, {
        status: 'preparing',
        message: 'preparing a download file — try again in a minute'
      });
    }

    return json(409, {
      status: 'missing',
      message: 'mux could not prepare a download: ' + (prepared.errors[0] || 'unknown error')
    });
  } catch (error) {
    return json(500, { message: error.message || 'could not resolve download' });
  }
};
