'use strict';

const { getStore, connectLambda } = require('@netlify/blobs');
const {
  studioCorsHeaders,
  requireWorkspaceAccess,
  scopedBlobKey
} = require('./lib/workspace-auth');

const EXPORT_KEYS = [
  'drafts',
  'stack',
  'stackMeta',
  'groups',
  'journalDays',
  'songPages',
  'albumPages',
  'releaseDates',
  'trackPipeline'
];

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

  if (access.role !== 'owner') {
    return { statusCode: 403, headers, body: JSON.stringify({ message: 'Owner role required for export' }) };
  }

  let store;
  try {
    connectLambda(event);
    store = getStore('studio-state');
  } catch (error) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ message: 'Cloud storage unavailable' })
    };
  }

  const bundle = {
    exportedAt: new Date().toISOString(),
    workspace: {
      id: access.workspaceId,
      slug: access.slug,
      name: access.name
    },
    keys: {}
  };

  try {
    for (let i = 0; i < EXPORT_KEYS.length; i++) {
      const logical = EXPORT_KEYS[i];
      const storageKey = scopedBlobKey(access.workspaceId, logical);
      const record = await store.get(storageKey, { type: 'json' });
      bundle.keys[logical] =
        record && typeof record === 'object' && 'value' in record ? record.value : null;
    }
    return { statusCode: 200, headers, body: JSON.stringify(bundle) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'export failed' }) };
  }
};
