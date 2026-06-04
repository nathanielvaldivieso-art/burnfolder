const { studioCorsHeaders, requireStudioAccess } = require('./lib/studio-auth');

function corsHeaders() {
  return studioCorsHeaders('GET, OPTIONS');
}

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
  return { ok: res.ok, status: res.status, data };
}

const naming = require('../../shared/mux-display-name.js');

function publicPlaybackId(asset) {
  const ids = asset && asset.playback_ids ? asset.playback_ids : [];
  const pub = ids.find(function (p) { return p.policy === 'public'; });
  return pub ? pub.id : ids[0] ? ids[0].id : null;
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
  return res.ok;
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const access = requireStudioAccess(event);
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
