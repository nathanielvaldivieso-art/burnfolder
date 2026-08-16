'use strict';

const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');

const INDEX_KEY = '__index__';
const TOKEN_PREFIX = 'sl_';
const MUX_IMAGE_BASE = 'https://image.mux.com';

function shareStore(event) {
  connectLambda(event);
  return getStore('share-links');
}

function newToken() {
  return TOKEN_PREFIX + crypto.randomBytes(12).toString('base64url');
}

function normalizeTrackKind(kind) {
  return kind === 'video' ? 'video' : 'audio';
}

/**
 * Token-gated download route. Resolving the rendition server-side (rather than
 * guessing highest.mp4 / audio.m4a from the sender's stored kind) is what keeps a
 * video from arriving as audio, or as a tiny Mux error body.
 */
function shareDownloadUrl(token, playbackId) {
  return (
    '/.netlify/functions/share-download?t=' +
    encodeURIComponent(token) +
    (playbackId ? '&p=' + encodeURIComponent(playbackId) : '')
  );
}

function muxPosterUrl(playbackId) {
  return MUX_IMAGE_BASE + '/' + encodeURIComponent(playbackId) + '/thumbnail.jpg?time=1&width=960&fit_mode=smartcrop';
}

function normalizeMaxPlays(value) {
  if (value == null || value === '') return null;
  var n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(1000, Math.floor(n));
}

function normalizeExpiresAt(value) {
  if (!value) return null;
  var ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Returns a 410-style reason when the share should no longer open. */
function shareUnavailableReason(share) {
  if (!share) return 'Link not found';
  if (share.revokedAt) return 'This link has been revoked';
  if (share.expiresAt) {
    var exp = Date.parse(share.expiresAt);
    if (Number.isFinite(exp) && Date.now() > exp) return 'This link has expired';
  }
  if (share.maxPlays != null && share.playCount >= share.maxPlays) {
    return 'This link has reached its play limit';
  }
  return null;
}

function normalizeShareRecord(raw) {
  if (!raw || typeof raw !== 'object' || !raw.token) return null;
  var maxPlays = normalizeMaxPlays(raw.maxPlays);
  var oneTime = !!(raw.oneTime || maxPlays === 1);
  if (oneTime && maxPlays == null) maxPlays = 1;
  return {
    token: String(raw.token),
    scope: raw.scope || 'song',
    groupKey: raw.groupKey ? String(raw.groupKey) : '',
    playbackId: raw.playbackId ? String(raw.playbackId) : '',
    albumId: raw.albumId ? String(raw.albumId) : '',
    title: String(raw.title || 'untitled'),
    subtitle: String(raw.subtitle || ''),
    coverArt: raw.coverArt ? String(raw.coverArt) : '',
    tracks: Array.isArray(raw.tracks)
      ? raw.tracks
          .filter(function (t) {
            return t && t.playbackId;
          })
          .map(function (t) {
            return {
              title: String(t.title || 'untitled'),
              playbackId: String(t.playbackId),
              kind: normalizeTrackKind(t.kind),
              filename: t.filename ? String(t.filename) : ''
            };
          })
      : [],
    createdAt: raw.createdAt || new Date().toISOString(),
    expiresAt: normalizeExpiresAt(raw.expiresAt),
    maxPlays: maxPlays,
    oneTime: oneTime,
    revokedAt: raw.revokedAt || null,
    playCount: typeof raw.playCount === 'number' ? raw.playCount : 0,
    lastPlayedAt: raw.lastPlayedAt || null,
    downloadCount: typeof raw.downloadCount === 'number' ? raw.downloadCount : 0,
    lastDownloadedAt: raw.lastDownloadedAt || null
  };
}

async function readIndex(store) {
  const record = await store.get(INDEX_KEY, { type: 'json' });
  if (!record || typeof record !== 'object') {
    return { tokens: [], byGroup: {}, byAlbum: {} };
  }
  return {
    tokens: Array.isArray(record.tokens) ? record.tokens.slice() : [],
    byGroup: record.byGroup && typeof record.byGroup === 'object' ? record.byGroup : {},
    byAlbum: record.byAlbum && typeof record.byAlbum === 'object' ? record.byAlbum : {}
  };
}

async function writeIndex(store, index) {
  await store.setJSON(INDEX_KEY, {
    tokens: index.tokens || [],
    byGroup: index.byGroup || {},
    byAlbum: index.byAlbum || {},
    updatedAt: new Date().toISOString()
  });
}

function indexAdd(index, share) {
  if (!index.tokens.includes(share.token)) index.tokens.unshift(share.token);
  if (share.groupKey) {
    if (!index.byGroup[share.groupKey]) index.byGroup[share.groupKey] = [];
    if (!index.byGroup[share.groupKey].includes(share.token)) {
      index.byGroup[share.groupKey].unshift(share.token);
    }
  }
  if (share.albumId) {
    if (!index.byAlbum[share.albumId]) index.byAlbum[share.albumId] = [];
    if (!index.byAlbum[share.albumId].includes(share.token)) {
      index.byAlbum[share.albumId].unshift(share.token);
    }
  }
}

function indexRemove(index, token, share) {
  index.tokens = index.tokens.filter(function (t) {
    return t !== token;
  });
  if (share && share.groupKey && index.byGroup[share.groupKey]) {
    index.byGroup[share.groupKey] = index.byGroup[share.groupKey].filter(function (t) {
      return t !== token;
    });
  }
  if (share && share.albumId && index.byAlbum[share.albumId]) {
    index.byAlbum[share.albumId] = index.byAlbum[share.albumId].filter(function (t) {
      return t !== token;
    });
  }
}

async function getShare(store, token) {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  const raw = await store.get(token, { type: 'json' });
  return normalizeShareRecord(raw);
}

async function putShare(store, share) {
  await store.setJSON(share.token, share);
}

async function deleteShare(store, token) {
  const share = await getShare(store, token);
  if (!share) return null;
  await store.delete(token);
  const index = await readIndex(store);
  indexRemove(index, token, share);
  await writeIndex(store, index);
  return share;
}

async function listShares(store, filters) {
  const index = await readIndex(store);
  const f = filters || {};
  let tokens = index.tokens.slice();

  // Unknown group/album must return [] — never fall through to the global list.
  // Otherwise a first-time share panel for e.g. "rehearsal" shows every existing
  // link (including unrelated clips like "adventure"), and copy sends the wrong token.
  if (f.groupKey) {
    tokens = index.byGroup[f.groupKey] ? index.byGroup[f.groupKey].slice() : [];
  } else if (f.albumId) {
    tokens = index.byAlbum[f.albumId] ? index.byAlbum[f.albumId].slice() : [];
  }

  const shares = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const share = await getShare(store, tokens[i]);
    if (share && !share.revokedAt) shares.push(share);
  }
  return shares;
}

function publicSharePayload(share) {
  return {
    token: share.token,
    scope: share.scope,
    title: share.title,
    subtitle: share.subtitle,
    coverArt: share.coverArt || '',
    tracks: (share.tracks || []).map(function (t) {
      return {
        title: t.title,
        playbackId: t.playbackId,
        kind: normalizeTrackKind(t.kind),
        downloadUrl: shareDownloadUrl(share.token, t.playbackId),
        posterUrl: muxPosterUrl(t.playbackId)
      };
    }),
    playCount: share.playCount,
    downloadCount: share.downloadCount || 0,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt || null,
    maxPlays: share.maxPlays,
    oneTime: !!share.oneTime
  };
}

module.exports = {
  shareStore: shareStore,
  newToken: newToken,
  normalizeShareRecord: normalizeShareRecord,
  normalizeMaxPlays: normalizeMaxPlays,
  normalizeExpiresAt: normalizeExpiresAt,
  shareUnavailableReason: shareUnavailableReason,
  readIndex: readIndex,
  writeIndex: writeIndex,
  indexAdd: indexAdd,
  indexRemove: indexRemove,
  getShare: getShare,
  putShare: putShare,
  deleteShare: deleteShare,
  listShares: listShares,
  publicSharePayload: publicSharePayload,
  shareDownloadUrl: shareDownloadUrl,
  muxPosterUrl: muxPosterUrl,
  TOKEN_PREFIX: TOKEN_PREFIX
};
