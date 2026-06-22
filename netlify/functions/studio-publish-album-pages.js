const { studioCorsHeaders, requireStudioAccess } = require('./lib/studio-auth');
const github = require('./lib/github-commit');

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function corsHeaders() {
  return studioCorsHeaders('POST, OPTIONS');
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return null;
  }
}

function buildAlbumPagesJs(pages) {
  return (
    '// Album page content — published from burnfolder studio\n' +
    'window.burnfolderAlbumPages = ' +
    JSON.stringify(pages || {}, null, 2) +
    ';\n'
  );
}

function normalizePages(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  Object.keys(input).forEach(function (key) {
    const rawKey = String(key || '').trim();
    if (!rawKey) return;
    const page = input[key];
    if (!page || typeof page !== 'object') return;
    out[rawKey] = {
      notes: typeof page.notes === 'string' ? page.notes : '',
      heroVideoPlaybackId: String(page.heroVideoPlaybackId || '').trim(),
      media: Array.isArray(page.media) ? page.media : [],
      title: String(page.title || '').trim(),
      coverArt: String(page.coverArt || '').trim(),
      tracks: Array.isArray(page.tracks)
        ? page.tracks
            .map(function (track) {
              if (!track || typeof track !== 'object') return null;
              return {
                title: String(track.title || '').trim(),
                playbackId: String(track.playbackId || '').trim(),
                groupKey: String(track.groupKey || '').trim()
              };
            })
            .filter(function (track) {
              return track && track.playbackId;
            })
        : [],
      updatedAt: page.updatedAt || new Date().toISOString()
    };
  });
  return out;
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const access = requireStudioAccess(event);
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  const body = parseBody(event);
  if (!body) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
  }

  if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY_BYTES) {
    return {
      statusCode: 413,
      headers,
      body: JSON.stringify({ message: 'Album pages payload is too large' })
    };
  }

  const pages = normalizePages(body.pages);
  if (!pages || !Object.keys(pages).length) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ message: 'Nothing to publish — add album page content first' })
    };
  }

  try {
    if (!process.env.GITHUB_TOKEN) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          message: 'Publish is not configured. Add GITHUB_TOKEN to Netlify environment variables.'
        })
      };
    }

    const content = buildAlbumPagesJs(pages);
    const commit = await github.commitFiles('Publish album pages from studio', [
      { path: 'album-pages.js', content: content }
    ]);

    const count = Object.keys(pages).length;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        pageCount: count,
        commitSha: commit.sha,
        commitUrl: commit.url,
        publishUrl: 'https://burnfolder.com/album.html',
        message:
          'Pushed ' +
          count +
          ' album page' +
          (count === 1 ? '' : 's') +
          ' to burnfolder.com. Netlify will deploy shortly.'
      })
    };
  } catch (error) {
    console.error('studio-publish-album-pages error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: error.message || 'Publish failed' })
    };
  }
};
