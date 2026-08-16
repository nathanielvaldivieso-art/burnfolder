'use strict';

/**
 * Download endpoint for public share links (no studio auth — the token is the key).
 *
 * The share payload used to hand recipients a hand-built stream.mux.com URL whose
 * rendition and file extension came from the sender's stored `kind`. When that was
 * stale, a video downloaded as audio (or as a 64 byte error body). This resolves the
 * rendition against Mux and redirects to a verified file instead.
 */

const { studioCorsHeaders } = require('./lib/studio-auth');
const { shareStore, getShare, shareUnavailableReason } = require('./lib/share-links-store');
const { muxAuthHeader } = require('./lib/mux-client');
const { resolveMuxDownload } = require('./lib/mux-download-resolver');

function corsHeaders() {
  return studioCorsHeaders('GET, OPTIONS');
}

function json(statusCode, payload) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(payload) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return json(405, { message: 'Method Not Allowed' });
  }

  const params = event.queryStringParameters || {};
  const token = String(params.t || '').trim();
  const playbackId = String(params.p || '').trim();
  if (!token) return json(400, { message: 'Missing token' });

  let store;
  try {
    store = shareStore(event);
  } catch (error) {
    return json(503, { message: 'Share storage unavailable' });
  }

  const auth = muxAuthHeader();
  if (!auth) return json(503, { message: 'Mux is not configured on the server.' });

  try {
    const share = await getShare(store, token);
    if (!share) return json(404, { message: 'Link not found' });

    const unavailable = shareUnavailableReason(share);
    if (unavailable) return json(410, { message: unavailable });

    // Only playback IDs inside this share are downloadable through this token.
    const tracks = share.tracks || [];
    const track = playbackId
      ? tracks.filter(function (t) {
          return t.playbackId === playbackId;
        })[0]
      : tracks[0];
    if (!track) return json(404, { message: 'Not part of this link' });

    const result = await resolveMuxDownload({
      auth: auth,
      playbackId: track.playbackId,
      filename: track.filename || track.title,
      kind: track.kind,
      fallbackBase: track.title || share.title,
      mayPrepare: true
    });

    if (result.status === 'ready') {
      return {
        statusCode: 302,
        headers: Object.assign(corsHeaders(), { Location: result.url, 'Cache-Control': 'no-store' }),
        body: ''
      };
    }

    return json(result.statusCode, { status: result.status, message: result.message });
  } catch (error) {
    return json(500, { message: error.message || 'could not resolve download' });
  }
};
