const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');
const { muxAuthHeader } = require('./lib/mux-client');

function corsHeaders() {
  return studioCorsHeaders('POST, OPTIONS');
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

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const access = await requireWorkspaceAccess(event);
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
    // Unique against client-known names only. Listing Mux assets here used to
    // page hundreds of GETs before every upload and made starts feel slow.
    const taken = new Set();
    reserved.forEach(function (name) {
      taken.add(sanitizeFileName(name));
    });

    const sourceName = fileName || legacyPassthrough || 'file';
    const passthrough = uniqueMuxFileName(sourceName, taken);

    // Mux rejects deprecated mp4_support:"standard" on basic-quality assets.
    // static_renditions covers downloadable MP4/M4A for video + audio uploads.
    const payload = {
      cors_origin: corsOrigin,
      new_asset_settings: {
        playback_policies: ['public'],
        static_renditions: [{ resolution: 'highest' }, { resolution: 'audio-only' }],
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
      const err = data && data.error;
      const fromMessages =
        err && Array.isArray(err.messages) && err.messages.length
          ? err.messages.join('; ')
          : '';
      return {
        statusCode: res.status,
        headers,
        body: JSON.stringify({
          message: (err && err.message) || fromMessages || 'Mux create upload failed',
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
