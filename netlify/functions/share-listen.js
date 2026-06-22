const { studioCorsHeaders } = require('./lib/studio-auth');
const { shareStore, getShare, putShare, publicSharePayload } = require('./lib/share-links-store');

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const token = ((event.queryStringParameters && event.queryStringParameters.t) || '').trim();
  if (!token) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Missing token' }) };
  }

  let store;
  try {
    store = shareStore(event);
  } catch (error) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ message: 'Share storage unavailable' })
    };
  }

  try {
    const share = await getShare(store, token);
    if (!share) {
      return { statusCode: 404, headers, body: JSON.stringify({ message: 'Link not found' }) };
    }
    if (share.revokedAt) {
      return { statusCode: 410, headers, body: JSON.stringify({ message: 'This link has been revoked' }) };
    }

    if (event.httpMethod === 'POST') {
      share.playCount = (share.playCount || 0) + 1;
      share.lastPlayedAt = new Date().toISOString();
      await putShare(store, share);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, playCount: share.playCount })
      };
    }

    if (event.httpMethod === 'GET') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, share: publicSharePayload(share) })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'request failed' }) };
  }
};
