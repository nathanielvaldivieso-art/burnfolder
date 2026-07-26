const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');
const { muxAuthHeader, muxGet, muxPatch, publicPlaybackId } = require('./lib/mux-client');
const naming = require('../../shared/mux-display-name.js');

function corsHeaders() {
  return studioCorsHeaders('GET, OPTIONS');
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const access = await requireWorkspaceAccess(event, { requireWrite: false });
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  const auth = muxAuthHeader();
  if (!auth) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ message: 'Mux is not configured on the server.' })
    };
  }

  const uploadId = event.queryStringParameters && event.queryStringParameters.uploadId;
  if (!uploadId) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'uploadId query parameter required' }) };
  }

  try {
    const uploadRes = await muxGet('/video/v1/uploads/' + encodeURIComponent(uploadId), auth);
    if (!uploadRes.ok) {
      return {
        statusCode: uploadRes.status,
        headers,
        body: JSON.stringify({
          message: 'Could not read Mux upload',
          details: uploadRes.data
        })
      };
    }

    const upload = uploadRes.data.data;
    const out = {
      uploadId: upload.id,
      status: upload.status,
      assetId: upload.asset_id || null,
      playbackId: null,
      error: upload.error || null
    };

    const uploadPassthrough = naming.passthroughFromUpload(upload);

    if (upload.asset_id) {
      const assetRes = await muxGet('/video/v1/assets/' + encodeURIComponent(upload.asset_id), auth);
      if (assetRes.ok && assetRes.data.data) {
        const asset = assetRes.data.data;
        out.playbackId = publicPlaybackId(asset);
        out.assetStatus = asset.status;
        out.passthrough = uploadPassthrough || asset.passthrough || null;

        if (uploadPassthrough && !String(asset.passthrough || '').trim()) {
          await muxPatch(
            '/video/v1/assets/' + encodeURIComponent(upload.asset_id),
            auth,
            { passthrough: naming.sanitizeFileName(uploadPassthrough) }
          );
        }
      }
    } else if (uploadPassthrough) {
      out.passthrough = uploadPassthrough;
    }

    return { statusCode: 200, headers, body: JSON.stringify(out) };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: error.message || 'Mux status check failed' })
    };
  }
};
