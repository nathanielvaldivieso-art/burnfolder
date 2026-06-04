const { studioCorsHeaders, requireStudioAccess } = require('./lib/studio-auth');

function corsHeaders() {
  return studioCorsHeaders('POST, OPTIONS');
}

function muxAuthHeader() {
  const id = process.env.MUX_TOKEN_ID;
  const secret = process.env.MUX_TOKEN_SECRET;
  if (!id || !secret) return null;
  return 'Basic ' + Buffer.from(id + ':' + secret).toString('base64');
}

function sanitizeFileName(name) {
  return String(name || 'file')
    .trim()
    .replace(/[^\w.\-()+ ]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'file';
}

function uniqueMuxFileName(fileName, takenSet) {
  const taken = takenSet || new Set();
  const safe = sanitizeFileName(fileName);
  const dot = safe.lastIndexOf('.');
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';

  let n = 1;
  let candidate = base + ext;

  while (taken.has(candidate)) {
    n += 1;
    candidate = base + '-' + n + ext;
  }

  taken.add(candidate);
  return candidate;
}

async function muxGet(path, auth) {
  const res = await fetch('https://api.mux.com' + path, {
    headers: { Authorization: auth }
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

async function listMuxPassthroughs(auth, maxPages) {
  const taken = new Set();
  const pages = maxPages || 5;

  for (let page = 1; page <= pages; page += 1) {
    const result = await muxGet('/video/v1/assets?limit=100&page=' + page, auth);
    if (!result.ok || !result.data || !Array.isArray(result.data.data)) break;

    result.data.data.forEach(function (asset) {
      if (asset.passthrough) taken.add(String(asset.passthrough));
    });

    if (result.data.data.length < 100) break;
  }

  return taken;
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

  const auth = muxAuthHeader();
  if (!auth) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        message: 'Mux is not configured. Add MUX_TOKEN_ID and MUX_TOKEN_SECRET in Netlify environment variables.'
      })
    };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
  }

  const corsOrigin = typeof body.corsOrigin === 'string' && body.corsOrigin ? body.corsOrigin : '*';
  const fileName = typeof body.fileName === 'string' ? body.fileName : '';
  const legacyPassthrough = typeof body.passthrough === 'string' ? body.passthrough : '';

  const reserved = Array.isArray(body.reservedPassthroughs)
    ? body.reservedPassthroughs.map(String)
    : [];

  try {
    const taken = await listMuxPassthroughs(auth, 5);
    reserved.forEach(function (name) {
      taken.add(sanitizeFileName(name));
    });

    const sourceName = fileName || legacyPassthrough || 'file';
    const passthrough = uniqueMuxFileName(sourceName, taken);

    const payload = {
      cors_origin: corsOrigin,
      new_asset_settings: {
        playback_policy: ['public'],
        passthrough: passthrough
      }
    };

    const res = await fetch('https://api.mux.com/video/v1/uploads', {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers,
        body: JSON.stringify({
          message: data && data.error && data.error.message ? data.error.message : 'Mux create upload failed',
          details: data
        })
      };
    }

    const upload = data.data;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        uploadId: upload.id,
        uploadUrl: upload.url,
        status: upload.status,
        passthrough: passthrough
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: error.message || 'Mux request failed' })
    };
  }
};
