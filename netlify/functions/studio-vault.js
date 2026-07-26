'use strict';

const {
  studioCorsHeaders,
  requireWorkspaceAccess
} = require('./lib/workspace-auth');
const vault = require('./lib/master-vault');
const manifest = require('./lib/vault-manifest');

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

function parseJsonBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return null;
  }
}

function headerValue(event, name) {
  const headers = event.headers || {};
  const lower = name.toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === lower) return headers[keys[i]];
  }
  return '';
}

function readBinaryBody(event) {
  const raw = event.body || '';
  if (!raw) return Buffer.alloc(0);
  if (event.isBase64Encoded) {
    return Buffer.from(raw, 'base64');
  }
  return Buffer.from(raw, 'binary');
}

function queryFilters(params) {
  const p = params || {};
  return {
    kind: p.kind || '',
    songGroupKey: p.songGroupKey || '',
    folderKey: p.folderKey || '',
    trackKey: p.trackKey || '',
    releaseKey: p.releaseKey || ''
  };
}

async function handleBinaryPut(event, access, headers) {
  const params = event.queryStringParameters || {};
  const kind = params.kind || 'master';
  if (!vault.isAllowedKind(kind)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ message: 'Unknown vault kind: ' + kind })
    };
  }
  const buffer = readBinaryBody(event);
  if (!buffer.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'empty body' }) };
  }
  const contentType =
    params.contentType || headerValue(event, 'content-type') || 'application/octet-stream';
  const result = await vault.putObject(access.workspaceId, {
    kind: kind,
    fileName: params.fileName || 'file',
    contentType: contentType,
    trackKey: params.trackKey || params.tempId,
    releaseKey: params.releaseKey,
    songGroupKey: params.songGroupKey,
    folderKey: params.folderKey,
    vaultKey: params.vaultKey,
    body: buffer
  });
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(Object.assign({ configured: true, kind: kind }, result))
  };
}

async function handleBinaryPart(event, access, headers) {
  const params = event.queryStringParameters || {};
  const buffer = readBinaryBody(event);
  if (!buffer.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'empty body' }) };
  }
  const partNumber = parseInt(params.partNumber, 10);
  const result = await vault.uploadPart(access.workspaceId, {
    vaultKey: params.vaultKey,
    uploadId: params.uploadId,
    partNumber: partNumber,
    body: buffer
  });
  return { statusCode: 200, headers, body: JSON.stringify(result) };
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
    const params = event.queryStringParameters || {};
    const action = params.action || 'status';
    if (action === 'status') {
      let cors = null;
      try {
        cors = await vault.ensureBucketCors();
      } catch (error) {
        cors = {
          ok: false,
          message: error && error.message ? error.message : 'cors ensure failed'
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ configured: true, bucket: vault.bucketName(), cors: cors })
      };
    }
    if (action === 'download') {
      const vaultKey = params.vaultKey || '';
      const filename = params.filename || params.fileName || '';
      const inline =
        params.inline === '1' ||
        params.inline === 'true' ||
        params.disposition === 'inline';
      try {
        const result = await vault.createDownloadUrl(access.workspaceId, vaultKey, {
          filename: filename,
          inline: inline
        });
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
      const vaultKey = params.vaultKey || '';
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
    if (action === 'list') {
      try {
        const filters = queryFilters(params);
        const [manifestItems, r2] = await Promise.all([
          manifest.listManifest(event, access.workspaceId, filters),
          vault.listPrefix(access.workspaceId, filters)
        ]);
        const items = manifest.mergeList(manifestItems, r2.objects);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            prefix: r2.prefix,
            items: items,
            count: items.length
          })
        };
      } catch (error) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ message: error.message || 'list failed' })
        };
      }
    }
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Unknown action' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const queryAction = (event.queryStringParameters || {}).action || '';

  try {
    // Binary proxy uploads (avoids browser→R2 CORS / Safari "Load failed")
    if (queryAction === 'put') {
      return await handleBinaryPut(event, access, headers);
    }
    if (queryAction === 'multipart-part') {
      return await handleBinaryPart(event, access, headers);
    }

    const body = parseJsonBody(event);
    if (!body) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
    }

    const action = body.action || 'upload-url';

    if (action === 'upload-url') {
      const kind = body.kind || 'master';
      if (!vault.isAllowedKind(kind)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ message: 'Unknown vault kind: ' + kind })
        };
      }
      const result = await vault.createUploadUrl(access.workspaceId, {
        kind: kind,
        fileName: body.fileName,
        contentType: body.contentType,
        trackKey: body.trackKey || body.tempId,
        releaseKey: body.releaseKey,
        songGroupKey: body.songGroupKey,
        folderKey: body.folderKey,
        vaultKey: body.vaultKey
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(Object.assign({ configured: true, kind: kind }, result))
      };
    }

    if (action === 'register') {
      const result = await manifest.registerFile(event, access.workspaceId, body);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    if (action === 'multipart-init') {
      const kind = body.kind || 'master';
      if (!vault.isAllowedKind(kind)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ message: 'Unknown vault kind: ' + kind })
        };
      }
      const result = await vault.createMultipartUpload(access.workspaceId, {
        kind: kind,
        fileName: body.fileName,
        contentType: body.contentType,
        trackKey: body.trackKey || body.tempId,
        releaseKey: body.releaseKey,
        songGroupKey: body.songGroupKey,
        folderKey: body.folderKey,
        vaultKey: body.vaultKey
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(Object.assign({ configured: true, kind: kind }, result))
      };
    }

    if (action === 'multipart-complete') {
      const result = await vault.completeMultipartUpload(access.workspaceId, {
        vaultKey: body.vaultKey,
        uploadId: body.uploadId,
        parts: body.parts
      });
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    }

    if (action === 'multipart-abort') {
      const result = await vault.abortMultipartUpload(access.workspaceId, {
        vaultKey: body.vaultKey,
        uploadId: body.uploadId
      });
      return { statusCode: 200, headers, body: JSON.stringify(result) };
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
      let unregistered = null;
      try {
        unregistered = await manifest.unregisterFile(event, access.workspaceId, body.vaultKey);
      } catch (error) {
        unregistered = { removed: null, manifest: null, warning: error.message };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(Object.assign({}, result, { unregistered: unregistered }))
      };
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
