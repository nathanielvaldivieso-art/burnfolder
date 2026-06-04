const { studioCorsHeaders, requireStudioAccess } = require('./lib/studio-auth');

exports.handler = async function (event) {
  const headers = studioCorsHeaders('POST, OPTIONS');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const secret = process.env.STUDIO_API_SECRET;
  const isProduction = process.env.CONTEXT === 'production';

  if (!secret) {
    if (isProduction) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          message:
            'Studio is locked. Add STUDIO_API_SECRET in Netlify environment variables before deploying.'
        })
      };
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, dev: true })
    };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password !== secret) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ ok: false, message: 'Invalid password' })
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true })
  };
};
