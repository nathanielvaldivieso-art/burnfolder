'use strict';

const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');

const INDEX_KEY = '__index__';
const TOKEN_PREFIX = 'sl_';

function shareStore(event) {
  connectLambda(event);
  return getStore('share-links');
}

function newToken() {
  return TOKEN_PREFIX + crypto.randomBytes(12).toString('base64url');
}

function normalizeShareRecord(raw) {
  if (!raw || typeof raw !== 'object' || !raw.token) return null;
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
              playbackId: String(t.playbackId)
            };
          })
      : [],
    createdAt: raw.createdAt || new Date().toISOString(),
    revokedAt: raw.revokedAt || null,
    playCount: typeof raw.playCount === 'number' ? raw.playCount : 0,
    lastPlayedAt: raw.lastPlayedAt || null
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
  let tokens = index.tokens.slice();
  const f = filters || {};
  if (f.groupKey && index.byGroup[f.groupKey]) {
    tokens = index.byGroup[f.groupKey].slice();
  } else if (f.albumId && index.byAlbum[f.albumId]) {
    tokens = index.byAlbum[f.albumId].slice();
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
    tracks: share.tracks,
    playCount: share.playCount,
    createdAt: share.createdAt
  };
}

module.exports = {
  shareStore: shareStore,
  newToken: newToken,
  normalizeShareRecord: normalizeShareRecord,
  readIndex: readIndex,
  writeIndex: writeIndex,
  indexAdd: indexAdd,
  indexRemove: indexRemove,
  getShare: getShare,
  putShare: putShare,
  deleteShare: deleteShare,
  listShares: listShares,
  publicSharePayload: publicSharePayload,
  TOKEN_PREFIX: TOKEN_PREFIX
};
