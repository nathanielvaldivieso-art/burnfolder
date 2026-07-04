const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');
const {
  shareStore,
  newToken,
  normalizeShareRecord,
  readIndex,
  writeIndex,
  indexAdd,
  getShare,
  putShare,
  deleteShare,
  listShares
} = require('./lib/share-links-store');

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

function listenUrl(event, token) {
  const host = event.headers.host || event.headers.Host || 'burnfolder.com';
  let proto = (event.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (!proto) {
    proto =
      /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? 'http' : 'https';
  }
  return proto + '://' + host + '/listen.html?t=' + encodeURIComponent(token);
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const access = await requireWorkspaceAccess(event);
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  let store;
  try {
    store = shareStore(event);
  } catch (error) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ message: 'Share storage unavailable: ' + (error.message || 'blobs error') })
    };
  }

  if (event.httpMethod === 'GET') {
    const qs = event.queryStringParameters || {};
    try {
      const shares = await listShares(store, {
        groupKey: qs.groupKey || '',
        albumId: qs.albumId || ''
      });
      const rows = shares.map(function (share) {
        return Object.assign({}, share, { url: listenUrl(event, share.token) });
      });
      return { statusCode: 200, headers, body: JSON.stringify({ shares: rows }) };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'list failed' }) };
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
  }

  const action = body.action || 'create';

  if (action === 'revoke') {
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'token required' }) };
    }
    try {
      const deleted = await deleteShare(store, token);
      if (!deleted) {
        return { statusCode: 404, headers, body: JSON.stringify({ message: 'Share link not found' }) };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, deleted: true, token: token })
      };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'delete failed' }) };
    }
  }

  if (action !== 'create') {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Unknown action' }) };
  }

  const scope = body.scope === 'version' || body.scope === 'album' ? body.scope : 'song';
  const tracks = Array.isArray(body.tracks) ? body.tracks : [];
  if (!tracks.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'tracks required' }) };
  }

  const token = newToken();
  const share = normalizeShareRecord({
    token: token,
    scope: scope,
    groupKey: body.groupKey || '',
    playbackId: body.playbackId || (scope === 'version' ? tracks[0].playbackId : ''),
    albumId: body.albumId || '',
    title: body.title || tracks[0].title || 'untitled',
    subtitle: body.subtitle || '',
    coverArt: body.coverArt || '',
    tracks: tracks,
    createdAt: new Date().toISOString(),
    revokedAt: null,
    playCount: 0,
    lastPlayedAt: null
  });

  try {
    await putShare(store, share);
    const index = await readIndex(store);
    indexAdd(index, share);
    await writeIndex(store, index);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        share: Object.assign({}, share, { url: listenUrl(event, share.token) })
      })
    };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'create failed' }) };
  }
};
