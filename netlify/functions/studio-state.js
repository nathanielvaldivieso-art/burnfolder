const { getStore, connectLambda } = require('@netlify/blobs');
const { studioCorsHeaders, requireStudioAccess } = require('./lib/studio-auth');

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

// Single-user personal cloud: one document per allowed key, stored in
// Netlify Blobs. Everything is gated by the same STUDIO_API_SECRET bearer the
// Mux functions use, so only the studio password can read or write it.
const KEY_PATTERN = /^[a-z][a-zA-Z0-9_-]{0,48}$/;

function getStateStore() {
  // Match subscribe.js: default consistency works on classic Netlify Functions.
  // (consistency: 'strong' requires uncachedEdgeURL, which this env lacks.)
  return getStore('studio-state');
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const access = requireStudioAccess(event);
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  let store;
  try {
    // Classic (CommonJS) Netlify Functions must hand the Blobs token from the
    // invocation event to the SDK before getStore() will work.
    connectLambda(event);
    store = getStateStore();
  } catch (error) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ message: 'Cloud storage is not available: ' + (error.message || 'blobs error') })
    };
  }

  if (event.httpMethod === 'GET') {
    const key = (event.queryStringParameters && event.queryStringParameters.key) || '';
    if (!KEY_PATTERN.test(key)) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid key' }) };
    }
    try {
      const record = await store.get(key, { type: 'json' });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(
          record && typeof record === 'object'
            ? { key: key, value: record.value, updatedAt: record.updatedAt || null }
            : { key: key, value: null, updatedAt: null }
        )
      };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'read failed' }) };
    }
  }

  if (event.httpMethod === 'POST') {
    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
    }

    const key = typeof body.key === 'string' ? body.key : '';
    if (!KEY_PATTERN.test(key)) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid key' }) };
    }
    if (!('value' in body)) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'value required' }) };
    }

    const updatedAt = new Date().toISOString();
    try {
      await store.setJSON(key, { value: body.value, updatedAt: updatedAt });
      return { statusCode: 200, headers, body: JSON.stringify({ key: key, value: body.value, updatedAt: updatedAt }) };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'write failed' }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
};
