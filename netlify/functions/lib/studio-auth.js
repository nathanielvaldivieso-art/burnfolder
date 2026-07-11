'use strict';

function studioCorsHeaders(methods) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Workspace-Id',
    'Access-Control-Allow-Methods': methods || 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function requireStudioAccess(event) {
  const secret = process.env.STUDIO_API_SECRET;
  const isProduction = process.env.CONTEXT === 'production';

  if (!secret) {
    if (isProduction) {
      return {
        ok: false,
        statusCode: 503,
        body: {
          message:
            'Studio is locked. Add STUDIO_API_SECRET in Netlify environment variables before deploying.'
        }
      };
    }
    return { ok: true, devBypass: true };
  }

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || token !== secret) {
    return {
      ok: false,
      statusCode: 401,
      body: { message: 'Unauthorized' }
    };
  }

  return { ok: true };
}

module.exports = {
  studioCorsHeaders: studioCorsHeaders,
  requireStudioAccess: requireStudioAccess
};
