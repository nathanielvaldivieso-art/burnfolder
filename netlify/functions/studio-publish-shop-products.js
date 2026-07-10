const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');
const github = require('./lib/github-commit');

const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_COVER_BYTES = 4 * 1024 * 1024;

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

function sanitizeId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function normalizeAmounts(list, fallback) {
  const src = Array.isArray(list) ? list : fallback;
  const out = [];
  src.forEach(function (n) {
    const num = Math.round(Number(n) * 100) / 100;
    if (!Number.isFinite(num) || num < 1 || num > 500) return;
    if (out.indexOf(num) === -1) out.push(num);
  });
  return out.length ? out.slice(0, 6) : fallback.slice();
}

function normalizeProduct(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const id = sanitizeId(input.id);
  const title = String(input.title || '').trim();
  if (!id || !title) return null;

  const minAmount = Math.max(1, Math.min(500, Number(input.minAmount) || 1));
  const maxAmount = Math.max(minAmount, Math.min(500, Number(input.maxAmount) || 500));

  return {
    id: id,
    title: title,
    subtitle: typeof input.subtitle === 'string' ? input.subtitle.trim() : '',
    blurb: typeof input.blurb === 'string' ? input.blurb.trim() : '',
    coverArt: typeof input.coverArt === 'string' ? input.coverArt.trim() : '',
    downloadHref: typeof input.downloadHref === 'string' ? input.downloadHref.trim() : '',
    minAmount: minAmount,
    suggestedAmounts: normalizeAmounts(input.suggestedAmounts, [5, 10, 15]),
    maxAmount: maxAmount,
    active: input.active !== false,
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function normalizeCatalog(input) {
  const products = Array.isArray(input && input.products)
    ? input.products.map(normalizeProduct).filter(Boolean)
    : [];
  return {
    products: products,
    updatedAt: (input && input.updatedAt) || new Date().toISOString()
  };
}

function buildShopProductsJs(catalog) {
  return (
    '// Shop catalog — published from burnfolder studio\n' +
    'window.burnfolderShopProducts = ' +
    JSON.stringify(catalog || { products: [] }, null, 2) +
    ';\n'
  );
}

function normalizeCoverAsset(asset) {
  if (!asset || typeof asset !== 'object') return null;
  const path = String(asset.path || '').trim();
  const base64 = String(asset.base64 || '').trim();
  if (!path || !base64 || !/^IMAGES\//i.test(path)) return null;
  if (!/\.(png|jpe?g|webp|gif)$/i.test(path)) return null;
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_COVER_BYTES) return null;
  return { path: path, content: base64, encoding: 'base64' };
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
      body: JSON.stringify({ message: 'Shop payload is too large (cover under 4MB)' })
    };
  }

  const catalog = normalizeCatalog(body.catalog);
  if (!catalog.products.length) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ message: 'Nothing to publish — add at least one product' })
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

    const commitFiles = [{ path: 'shop-products.js', content: buildShopProductsJs(catalog) }];
    const cover = normalizeCoverAsset(body.coverAsset);
    if (cover) commitFiles.push(cover);

    const commit = await github.commitFiles('Publish shop products from studio', commitFiles);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        commitSha: commit.sha,
        commitUrl: commit.url,
        publishUrl: 'https://burnfolder.com/shop.html',
        message: 'Pushed shop catalog to burnfolder.com. Netlify will deploy shortly.'
      })
    };
  } catch (error) {
    console.error('studio-publish-shop-products error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: error.message || 'Publish failed' })
    };
  }
};
