const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');

function corsHeaders() {
  return studioCorsHeaders('POST, OPTIONS');
}

function muxAuthHeader() {
  const id = process.env.MUX_TOKEN_ID;
  const secret = process.env.MUX_TOKEN_SECRET;
  if (!id || !secret) return null;
  return 'Basic ' + Buffer.from(id + ':' + secret).toString('base64');
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const access = await requireWorkspaceAccess(event);
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

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
  }

  const assetId = typeof body.assetId === 'string' ? body.assetId.trim() : '';
  if (!assetId) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'assetId required' }) };
  }

  try {
    const res = await fetch(
      'https://api.mux.com/video/v1/assets/' + encodeURIComponent(assetId),
      {
        method: 'DELETE',
        headers: { Authorization: auth }
      }
    );

    if (res.status === 404) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: 'mux asset not found' })
      };
    }

    if (!res.ok && res.status !== 204) {
      const data = await res.json().catch(function () {
        return {};
      });
      return {
        statusCode: res.status,
        headers,
        body: JSON.stringify({
          message:
            (data.error && data.error.messages && data.error.messages[0]) ||
            (data.error && data.error.message) ||
            'could not delete mux asset',
          details: data
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ deleted: true, assetId: assetId })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: error.message || 'Mux delete failed' })
    };
  }
};
