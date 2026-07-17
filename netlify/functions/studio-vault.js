'use strict';

const {
  studioCorsHeaders,
  requireWorkspaceAccess
} = require('./lib/workspace-auth');
const vault = require('./lib/master-vault');

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return null;
  }
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const access = await requireWorkspaceAccess(event, {
    requireWrite: event.httpMethod === 'POST'
  });
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  if (!vault.vaultConfigured()) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        message:
          'R2 vault is not configured. Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME in Netlify env.',
        configured: false
      })
    };
  }

  if (event.httpMethod === 'GET') {
    const action = (event.queryStringParameters && event.queryStringParameters.action) || 'status';
    if (action === 'status') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ configured: true, bucket: vault.bucketName() })
      };
    }
    if (action === 'download') {
      const vaultKey = (event.queryStringParameters && event.queryStringParameters.vaultKey) || '';
      try {
        const result = await vault.createDownloadUrl(access.workspaceId, vaultKey);
        return { statusCode: 200, headers, body: JSON.stringify(result) };
      } catch (error) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ message: error.message || 'download url failed' })
        };
      }
    }
    if (action === 'head') {
      const vaultKey = (event.queryStringParameters && event.queryStringParameters.vaultKey) || '';
      try {
        const result = await vault.headObject(access.workspaceId, vaultKey);
        return { statusCode: 200, headers, body: JSON.stringify(result) };
      } catch (error) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ message: error.message || 'head failed' })
        };
      }
    }
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Unknown action' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const body = parseBody(event);
  if (!body) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
  }

  const action = body.action || 'upload-url';

  try {
    if (action === 'upload-url') {
      const result = await vault.createUploadUrl(access.workspaceId, {
        kind: body.kind || 'master',
        fileName: body.fileName,
        contentType: body.contentType,
        trackKey: body.trackKey || body.tempId,
        releaseKey: body.releaseKey,
        songGroupKey: body.songGroupKey,
        vaultKey: body.vaultKey
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(
          Object.assign({ configured: true, kind: body.kind || 'master' }, result)
        )
      };
    }

    if (action === 'delete') {
      if (!access.isOwner) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: 'Owner role required to delete vault objects' })
        };
      }
      const result = await vault.deleteObject(access.workspaceId, body.vaultKey);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Unknown action' }) };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: error.message || 'vault request failed' })
    };
  }
};
