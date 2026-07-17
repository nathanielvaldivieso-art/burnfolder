'use strict';

const { vaultConfigured, getObjectBuffer } = require('../master-vault');

const PROD_BASE = 'https://api.labelgrid.com/api/public';
const SANDBOX_BASE = 'https://api-sandbox.stg.labelgrid.com/api/public';

function apiBase() {
  if (String(process.env.LABELGRID_SANDBOX || '').toLowerCase() === 'true') {
    return SANDBOX_BASE;
  }
  return process.env.LABELGRID_API_BASE || PROD_BASE;
}

function apiKey() {
  return process.env.LABELGRID_API_KEY || '';
}

function configured() {
  return !!apiKey();
}

async function lgRequest(method, path, body) {
  const key = apiKey();
  if (!key) {
    throw new Error(
      'LabelGrid is not configured. Add LABELGRID_API_KEY and DISTRO_PROVIDER=labelgrid in Netlify env.'
    );
  }
  const url = apiBase().replace(/\/$/, '') + path;
  const headers = {
    Authorization: 'Bearer ' + key,
    Accept: 'application/json'
  };
  const init = { method: method, headers: headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const message =
      (data && (data.message || data.error)) ||
      (data && data.errors && JSON.stringify(data.errors)) ||
      'LabelGrid ' + method + ' ' + path + ' failed (' + res.status + ')';
    const err = new Error(typeof message === 'string' ? message : JSON.stringify(message));
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

function unwrap(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.data && typeof data.data === 'object') return data.data;
  return data;
}

function titleLocales(text) {
  return [{ iso_code: 'en', text: String(text || '').trim() || 'Untitled' }];
}

function releaseTitleLocales(text) {
  return [{ iso_code: 'en', text: String(text || '').trim() || 'Untitled', phonetic: null }];
}

function safeUploadName(name, fallbackExt) {
  const raw = String(name || 'file.' + (fallbackExt || 'wav')).trim();
  const cleaned = raw
    .replace(/[^a-zA-Z0-9\s\-_.()]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
  if (/\.[a-zA-Z0-9]+$/.test(cleaned)) return cleaned;
  return cleaned + '.' + (fallbackExt || 'bin');
}

async function putToPresignedUrl(uploadUrl, buffer, contentType) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType || 'application/octet-stream'
    },
    body: buffer
  });
  if (!res.ok) {
    const text = await res.text().catch(function () {
      return '';
    });
    throw new Error('LabelGrid asset upload failed (' + res.status + '): ' + (text || 'no body'));
  }
}

async function uploadTrackAudio(trackId, workspaceId, vaultKey, fileName) {
  if (!vaultConfigured()) {
    throw new Error('R2 vault required to submit masters to LabelGrid');
  }
  const obj = await getObjectBuffer(workspaceId, vaultKey);
  const filename = safeUploadName(fileName || vaultKey.split('/').pop(), 'wav');
  const upload = unwrap(
    await lgRequest('POST', '/tracks/' + trackId + '/files/stereo/upload-url', {
      filename: filename
    })
  );
  await putToPresignedUrl(upload.upload_url, obj.buffer, obj.contentType || 'audio/wav');
  const stored = unwrap(
    await lgRequest('PUT', '/tracks/' + trackId + '/files/stereo', {
      s3_key: upload.key
    })
  );
  return { key: upload.key, stored: stored };
}

async function uploadReleaseArtwork(releaseId, workspaceId, vaultKey, fileName) {
  if (!vaultConfigured()) {
    throw new Error('R2 vault required to submit artwork to LabelGrid');
  }
  const obj = await getObjectBuffer(workspaceId, vaultKey);
  const filename = safeUploadName(fileName || vaultKey.split('/').pop(), 'jpg');
  const upload = unwrap(
    await lgRequest('POST', '/releases/' + releaseId + '/files/square/upload-url', {
      filename: filename
    })
  );
  await putToPresignedUrl(upload.upload_url, obj.buffer, obj.contentType || 'image/jpeg');
  const stored = unwrap(
    await lgRequest('PUT', '/releases/' + releaseId + '/files/square', {
      s3_key: upload.key
    })
  );
  return { key: upload.key, stored: stored };
}

function contentTypeFromTrackCount(count, preferred) {
  if (preferred) return preferred;
  if (count <= 1) return 'Single';
  if (count <= 6) return 'EP';
  return 'Album';
}

/**
 * @param {object} payload
 * @param {string} payload.workspaceId
 * @param {object} payload.prefs — distroPreferences (labelId, artistId, writerId, genreId, …)
 * @param {object} payload.release — studio release draft
 */
async function createRelease(payload) {
  const prefs = (payload && payload.prefs) || {};
  const release = (payload && payload.release) || {};
  const workspaceId = payload.workspaceId;
  const tracks = Array.isArray(release.tracks) ? release.tracks : [];

  const labelId = Number(prefs.labelId || process.env.LABELGRID_LABEL_ID);
  const artistId = Number(prefs.artistId || process.env.LABELGRID_ARTIST_ID);
  const writerId = Number(prefs.writerId || process.env.LABELGRID_WRITER_ID || 0);
  const genreId = Number(prefs.primaryGenreId || process.env.LABELGRID_PRIMARY_GENRE_ID);

  if (!labelId || !artistId || !genreId) {
    throw new Error(
      'LabelGrid prefs incomplete. Set labelId, artistId, and primaryGenreId in studio distro prefs (or LABELGRID_LABEL_ID / LABELGRID_ARTIST_ID / LABELGRID_PRIMARY_GENRE_ID env).'
    );
  }

  const title = String(release.title || '').trim() || 'Untitled';
  const year = Number(release.copyrightYear || prefs.copyrightYear || new Date().getFullYear());
  const rightsName = String(prefs.rightsName || release.rightsName || prefs.labelName || 'Burnfolder').trim();
  const cat =
    String(release.catalogNumber || prefs.catalogPrefix || 'BF')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 16) +
    String(Date.now()).slice(-4);

  const releaseBody = {
    content_type: contentTypeFromTrackCount(tracks.length, release.contentType),
    label_id: labelId,
    artists: [{ artist_id: artistId, artistic_role: 'MainArtist', position: 1 }],
    titles: releaseTitleLocales(title),
    cat: cat,
    artwork_ai_usage: release.artworkAiUsage || prefs.artworkAiUsage || 'none',
    primary_genre_id: genreId,
    release_date: release.releaseDate || null,
    barcode_number: release.upc || null,
    cline_year: year,
    cline_name: rightsName,
    pline_year: year,
    pline_name: rightsName,
    explicit: release.explicit || 'off',
    preferred_localization: 'en'
  };

  const created = unwrap(await lgRequest('POST', '/releases', releaseBody));
  const providerReleaseId = created.id;
  if (!providerReleaseId) {
    throw new Error('LabelGrid createRelease returned no id');
  }

  if (release.artworkVaultKey) {
    await uploadReleaseArtwork(
      providerReleaseId,
      workspaceId,
      release.artworkVaultKey,
      release.artworkFileName || 'cover.jpg'
    );
  }

  const trackResults = [];
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i] || {};
    const trackTitle = String(track.title || '').trim() || 'Track ' + (i + 1);
    const contributors = [];
    if (writerId) {
      contributors.push({
        writer_id: writerId,
        roles: { Composer: true, Lyricist: true },
        ai_contribution: 'none'
      });
    } else {
      contributors.push({
        roles: { Composer: true, Lyricist: true },
        ai_contribution: 'none'
      });
    }

    const trackBody = {
      release_id: providerReleaseId,
      disc: 1,
      track_num: i + 1,
      composition_type: track.compositionType || 'original_composition',
      titles: titleLocales(trackTitle),
      artists: [{ artist_id: artistId, artistic_role: 'MainArtist', position: 1 }],
      audio_ai_usage: track.audioAiUsage || 'none',
      composition_ai_usage: track.compositionAiUsage || 'none',
      commercial_samples: track.commercialSamples || 'no',
      audio_language: track.audioLanguage || prefs.audioLanguage || 'en',
      contributors: contributors,
      isrc: track.isrc || null,
      explicit: track.explicit || release.explicit || 'off',
      primary_genre_id: genreId,
      pline_year: year,
      pline_name: rightsName
    };

    const createdTrack = unwrap(await lgRequest('POST', '/tracks', trackBody));
    const providerTrackId = createdTrack.id || (createdTrack.track && createdTrack.track.id);
    if (!providerTrackId) {
      throw new Error('LabelGrid create track failed for "' + trackTitle + '"');
    }

    if (track.vaultKey) {
      await uploadTrackAudio(
        providerTrackId,
        workspaceId,
        track.vaultKey,
        track.fileName || trackTitle + '.wav'
      );
    }

    const refreshed = unwrap(await lgRequest('GET', '/tracks/' + providerTrackId));
    trackResults.push({
      studioTrackId: track.id || null,
      title: trackTitle,
      providerTrackId: providerTrackId,
      isrc: refreshed.isrc || createdTrack.isrc || track.isrc || null,
      vaultKey: track.vaultKey || null
    });
  }

  const refreshedRelease = unwrap(await lgRequest('GET', '/releases/' + providerReleaseId));
  return {
    provider: 'labelgrid',
    providerReleaseId: providerReleaseId,
    publicId: refreshedRelease.public_id || created.public_id || null,
    upc: refreshedRelease.barcode_number || created.barcode_number || release.upc || null,
    catalogNumber: refreshedRelease.cat || cat,
    tracks: trackResults,
    raw: refreshedRelease
  };
}

async function submitRelease(providerReleaseId) {
  const id = Number(providerReleaseId);
  if (!id) throw new Error('providerReleaseId required');

  const validation = unwrap(await lgRequest('POST', '/releases/' + id + '/validate'));
  if (validation && validation.result === 'ERROR') {
    const err = new Error(
      'LabelGrid validation failed: ' +
        (Array.isArray(validation.errors) ? validation.errors.join('; ') : 'see details')
    );
    err.status = 422;
    err.details = validation;
    throw err;
  }

  const dist = unwrap(await lgRequest('POST', '/releases/' + id + '/distribute'));
  return {
    provider: 'labelgrid',
    providerReleaseId: id,
    status: (dist && dist.status) || 'submitted',
    message: (dist && dist.message) || 'submitted for distribution',
    validation: validation,
    raw: dist
  };
}

async function getReleaseStatus(providerReleaseId) {
  const id = Number(providerReleaseId);
  if (!id) throw new Error('providerReleaseId required');
  const data = unwrap(await lgRequest('GET', '/releases/' + id));
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  return {
    provider: 'labelgrid',
    providerReleaseId: id,
    status: data.status || data.distribution_status || 'unknown',
    upc: data.barcode_number || null,
    catalogNumber: data.cat || null,
    publicId: data.public_id || null,
    tracks: tracks.map(function (t) {
      return {
        providerTrackId: t.id,
        title: t.titles && t.titles[0] ? t.titles[0].text : null,
        isrc: t.isrc || null
      };
    }),
    raw: data
  };
}

async function getAnalytics() {
  return {
    provider: 'labelgrid',
    status: 'stub',
    note: 'LabelGrid analytics ingest is Tier 3 — after the release is live on DSPs.'
  };
}

async function importCatalog() {
  throw new Error('importCatalog is Tier 3');
}

async function ping() {
  const me = unwrap(await lgRequest('GET', '/me'));
  return { ok: true, user: me };
}

async function listLabels() {
  const data = unwrap(await lgRequest('GET', '/labels'));
  return Array.isArray(data) ? data : data && data.data ? data.data : [];
}

async function listArtists() {
  const data = unwrap(await lgRequest('GET', '/artists'));
  return Array.isArray(data) ? data : data && data.data ? data.data : [];
}

async function listGenres() {
  const data = unwrap(await lgRequest('GET', '/genres'));
  return Array.isArray(data) ? data : data && data.data ? data.data : [];
}

module.exports = {
  name: 'labelgrid',
  configured,
  apiBase,
  createRelease,
  submitRelease,
  getReleaseStatus,
  getAnalytics,
  importCatalog,
  ping,
  listLabels,
  listArtists,
  listGenres
};
