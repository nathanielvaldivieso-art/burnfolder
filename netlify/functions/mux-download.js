'use strict';

/** Studio-side download resolver for a Mux playback ID. Logic lives in lib/mux-download-resolver. */

const { studioCorsHeaders, requireWorkspaceAccess, canWriteStudioState } = require('./lib/workspace-auth');
const { muxAuthHeader } = require('./lib/mux-client');
const { resolveMuxDownload } = require('./lib/mux-download-resolver');

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

function json(statusCode, payload) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(payload) };
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

  const auth = muxAuthHeader();
  if (!auth) return json(503, { message: 'Mux is not configured on the server.' });

  try {
    const result = await resolveMuxDownload({
      auth: auth,
      playbackId: playbackId,
      filename: String(params.filename || '').trim(),
      kind: String(params.kind || '').trim(),
      mayPrepare: params.prepare !== '0' && canWriteStudioState(access)
    });

    if (result.status === 'ready') {
      return json(200, {
        status: 'ready',
        url: result.url,
        downloadUrl: result.url,
        rendition: result.rendition,
        kind: result.kind,
        filename: result.filename,
        bytes: result.bytes
      });
    }

    return json(result.statusCode, { status: result.status, message: result.message });
  } catch (error) {
    return json(500, { message: error.message || 'could not resolve download' });
  }
};
