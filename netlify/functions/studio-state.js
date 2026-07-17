const { getStore, connectLambda } = require('@netlify/blobs');
const {
  studioCorsHeaders,
  requireWorkspaceAccess,
  scopedBlobKey,
  legacyBlobKey,
  LOGICAL_KEY_PATTERN,
  filterGroupsForAccess,
  mergeGroupsForAccess
} = require('./lib/workspace-auth');

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

function getStateStore() {
  return getStore('studio-state');
}

const MIGRATABLE_KEYS = [
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

async function readRecord(store, storageKey) {
  return store.get(storageKey, { type: 'json' });
}

async function migrateLegacy(store, workspaceId, logicalKey) {
  if (!workspaceId || workspaceId === 'legacy') return null;
  const scoped = scopedBlobKey(workspaceId, logicalKey);
  const legacy = legacyBlobKey(logicalKey);
  if (!scoped || scoped === legacy) return null;
  const existing = await readRecord(store, scoped);
  if (existing && typeof existing === 'object' && 'value' in existing) return existing;
  const old = await readRecord(store, legacy);
  if (!old || typeof old !== 'object' || !('value' in old)) return null;
  await store.setJSON(scoped, old);
  return old;
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const logicalKey =
    event.httpMethod === 'GET'
      ? (event.queryStringParameters && event.queryStringParameters.key) || ''
      : (function () {
          try {
            const body = JSON.parse(event.body || '{}');
            return typeof body.key === 'string' ? body.key : '';
          } catch {
            return '';
          }
        })();

  const access = await requireWorkspaceAccess(event, {
    requireWrite: event.httpMethod === 'POST',
    logicalKey: logicalKey
  });
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  let store;
  try {
    connectLambda(event);
    store = getStateStore();
  } catch (error) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ message: 'Cloud storage is not available: ' + (error.message || 'blobs error') })
    };
  }

  if (!LOGICAL_KEY_PATTERN.test(logicalKey)) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid key' }) };
  }

  const storageKey = scopedBlobKey(access.workspaceId, logicalKey);

  if (event.httpMethod === 'GET') {
    try {
      let record = await readRecord(store, storageKey);
      if ((!record || !('value' in record)) && MIGRATABLE_KEYS.indexOf(logicalKey) > -1) {
        record = await migrateLegacy(store, access.workspaceId, logicalKey);
      }
      let value =
        record && typeof record === 'object' && 'value' in record ? record.value : null;
      if (logicalKey === 'groups') {
        value = filterGroupsForAccess(value, access);
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(
          value !== null && record && typeof record === 'object'
            ? { key: logicalKey, value: value, updatedAt: record.updatedAt || null }
            : { key: logicalKey, value: value, updatedAt: null }
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

    if (!('value' in body)) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'value required' }) };
    }

    const updatedAt = new Date().toISOString();
    try {
      let value = body.value;
      if (logicalKey === 'groups') {
        let fullRecord = await readRecord(store, storageKey);
        if ((!fullRecord || !('value' in fullRecord)) && MIGRATABLE_KEYS.indexOf(logicalKey) > -1) {
          fullRecord = await migrateLegacy(store, access.workspaceId, logicalKey);
        }
        const fullGroups =
          fullRecord && typeof fullRecord === 'object' && 'value' in fullRecord
            ? fullRecord.value
            : [];
        try {
          value = mergeGroupsForAccess(fullGroups, body.value, access);
        } catch (error) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ message: error.message || 'Project access denied' })
          };
        }
      }
      if (logicalKey === 'trackRegistry') {
        const existing = await readRecord(store, storageKey);
        const prevTracks =
          existing && existing.value && Array.isArray(existing.value.tracks)
            ? existing.value.tracks
            : [];
        const locked = {};
        prevTracks.forEach(function (row) {
          if (row && row.id && row.isrc && row.isrcLocked) locked[row.id] = row.isrc;
        });
        if (value && Array.isArray(value.tracks)) {
          value = {
            tracks: value.tracks.map(function (row) {
              if (!row || !row.id) return row;
              if (!locked[row.id]) return row;
              return Object.assign({}, row, { isrc: locked[row.id], isrcLocked: true });
            })
          };
        }
      }
      await store.setJSON(storageKey, { value: value, updatedAt: updatedAt });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ key: logicalKey, value: value, updatedAt: updatedAt })
      };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'write failed' }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
};
