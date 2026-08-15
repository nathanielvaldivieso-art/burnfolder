const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');
const {
  shareStore,
  newToken,
  normalizeShareRecord,
  normalizeMaxPlays,
  normalizeExpiresAt,
  readIndex,
  writeIndex,
  indexAdd,
  getShare,
  putShare,
  deleteShare,
  listShares
} = require('./lib/share-links-store');

function resolveExpiresAt(body, scope) {
  if (body && body.expiresAt) return normalizeExpiresAt(body.expiresAt);
  var expiresIn = body && body.expiresIn != null ? String(body.expiresIn).trim().toLowerCase() : '';
  if (expiresIn === 'never' || expiresIn === '0' || expiresIn === 'none') return null;
  var days = null;
  if (expiresIn === '24h' || expiresIn === '1d') days = 1;
  else if (expiresIn === '7d' || expiresIn === 'week') days = 7;
  else if (expiresIn === '30d' || expiresIn === 'month') days = 30;
  else if (/^\d+d$/.test(expiresIn)) days = parseInt(expiresIn, 10);
  else if (body && body.expiresInDays != null) days = Number(body.expiresInDays);
  // Video links expire in 7 days by default so shared clips don't live forever.
  if (!Number.isFinite(days) || days <= 0) {
    if (scope === 'video') days = 7;
    else return null;
  }
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

function isVideoShare(share) {
  if (share.scope === 'video') return true;
  return !!(share.tracks && share.tracks[0] && share.tracks[0].kind === 'video');
}

function shareUrl(event, share) {
  const host = event.headers.host || event.headers.Host || 'burnfolder.com';
  let proto = (event.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (!proto) {
    proto =
      /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? 'http' : 'https';
  }
  const page = isVideoShare(share) ? 'watch.html' : 'listen.html';
  return proto + '://' + host + '/' + page + '?t=' + encodeURIComponent(share.token);
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
        return Object.assign({}, share, { url: shareUrl(event, share) });
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

  const scopeOptions = ['version', 'album', 'video'];
  const scope = scopeOptions.indexOf(body.scope) > -1 ? body.scope : 'song';
  const tracks = Array.isArray(body.tracks) ? body.tracks : [];
  if (!tracks.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'tracks required' }) };
  }

  const token = newToken();
  const oneTime = !!(body.oneTime || body.maxPlays === 1);
  const maxPlays = oneTime ? 1 : normalizeMaxPlays(body.maxPlays);
  const share = normalizeShareRecord({
    token: token,
    scope: scope,
    groupKey: body.groupKey || '',
    playbackId: body.playbackId || (scope === 'version' || scope === 'video' ? tracks[0].playbackId : ''),
    albumId: body.albumId || '',
    title: body.title || tracks[0].title || 'untitled',
    subtitle: body.subtitle || '',
    coverArt: body.coverArt || '',
    tracks: tracks,
    createdAt: new Date().toISOString(),
    expiresAt: resolveExpiresAt(body, scope),
    maxPlays: maxPlays,
    oneTime: oneTime,
    revokedAt: null,
    playCount: 0,
    lastPlayedAt: null,
    downloadCount: 0,
    lastDownloadedAt: null
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
        share: Object.assign({}, share, { url: shareUrl(event, share) })
      })
    };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'create failed' }) };
  }
};
