'use strict';

/** Shared Mux API helpers used by the mux-*.js Netlify functions. */

function muxAuthHeader() {
  const id = process.env.MUX_TOKEN_ID;
  const secret = process.env.MUX_TOKEN_SECRET;
  if (!id || !secret) return null;
  return 'Basic ' + Buffer.from(id + ':' + secret).toString('base64');
}

async function muxGet(path, auth) {
  const res = await fetch('https://api.mux.com' + path, {
    headers: { Authorization: auth }
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data: data };
}

async function muxPatch(path, auth, body) {
  const res = await fetch('https://api.mux.com' + path, {
    method: 'PATCH',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(function () {
    return null;
  });
  return { ok: res.ok, status: res.status, data: data };
}

async function muxPost(path, auth, body) {
  const res = await fetch('https://api.mux.com' + path, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(function () {
    return null;
  });
  return { ok: res.ok, status: res.status, data: data };
}

async function assetIdForPlaybackId(playbackId, auth) {
  const result = await muxGet('/video/v1/playback-ids/' + encodeURIComponent(playbackId), auth);
  if (!result.ok || !result.data || !result.data.data) return null;
  const object = result.data.data.object || {};
  return object.type === 'asset' && object.id ? object.id : null;
}

function publicPlaybackId(asset) {
  const ids = asset && asset.playback_ids ? asset.playback_ids : [];
  const pub = ids.find(function (p) {
    return p.policy === 'public';
  });
  return pub ? pub.id : ids[0] ? ids[0].id : null;
}

module.exports = {
  muxAuthHeader: muxAuthHeader,
  muxGet: muxGet,
  muxPatch: muxPatch,
  muxPost: muxPost,
  assetIdForPlaybackId: assetIdForPlaybackId,
  publicPlaybackId: publicPlaybackId
};
