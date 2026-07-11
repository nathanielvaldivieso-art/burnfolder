const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');
const github = require('./lib/github-commit');

const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

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

function normalizeLinkRow(item) {
  if (!item || typeof item !== 'object') return null;
  const label = String(item.label || '').trim();
  if (!label) return null;
  return {
    label: label,
    href: String(item.href || '').trim(),
    pending: !!item.pending
  };
}

function normalizeAssetRow(item) {
  if (!item || typeof item !== 'object') return null;
  const label = String(item.label || '').trim();
  if (!label) return null;
  const row = {
    label: label,
    href: String(item.href || '').trim(),
    pending: !!item.pending
  };
  if (item.download) row.download = true;
  return row;
}

function normalizePage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const links = Array.isArray(input.links)
    ? input.links.map(normalizeLinkRow).filter(Boolean)
    : [];
  const assets = Array.isArray(input.assets)
    ? input.assets.map(normalizeAssetRow).filter(Boolean)
    : [];
  return {
    pressPhoto: typeof input.pressPhoto === 'string' ? input.pressPhoto : '',
    bio:
      typeof input.bio === 'string'
        ? input.bio
        : typeof input.artist === 'string'
          ? input.artist
          : '',
    releaseLine: typeof input.releaseLine === 'string' ? input.releaseLine : '',
    pullQuote: typeof input.pullQuote === 'string' ? input.pullQuote : '',
    contactEmail: typeof input.contactEmail === 'string' ? input.contactEmail : '',
    links: links,
    assets: assets,
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function normalizePhotoAsset(asset) {
  if (!asset || typeof asset !== 'object') return null;
  const path = String(asset.path || '').trim();
  const base64 = String(asset.base64 || '').trim();
  if (!path || !base64 || !/^IMAGES\//i.test(path)) return null;
  if (!/\.(png|jpe?g|webp|gif)$/i.test(path)) return null;
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_PHOTO_BYTES) return null;
  return { path: path, content: base64, encoding: 'base64' };
}

function buildPressPageJs(page) {
  return (
    '// Press / EPK content — published from burnfolder studio\n' +
    'window.burnfolderPressPage = ' +
    JSON.stringify(page || {}, null, 2) +
    ';\n'
  );
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const access = await requireWorkspaceAccess(event, { requirePublish: true });
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
      body: JSON.stringify({ message: 'Press page payload is too large (photo under 4MB)' })
    };
  }

  const page = normalizePage(body.page);
  if (!page) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ message: 'Nothing to publish — add press page content first' })
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

    const commitFiles = [{ path: 'press-page.js', content: buildPressPageJs(page) }];
    const photo = normalizePhotoAsset(body.photoAsset);
    if (photo) commitFiles.push(photo);

    const commit = await github.commitFiles('Publish press page from studio', commitFiles);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        commitSha: commit.sha,
        commitUrl: commit.url,
        publishUrl: 'https://burnfolder.com/press.html',
        message: photo
          ? 'Pushed press page + photo to burnfolder.com. Netlify will deploy shortly.'
          : 'Pushed press page to burnfolder.com. Netlify will deploy shortly.'
      })
    };
  } catch (error) {
    console.error('studio-publish-press-page error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: error.message || 'Publish failed' })
    };
  }
};
