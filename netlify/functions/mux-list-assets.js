const naming = require('../../shared/mux-display-name.js');
const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');

function corsHeaders() {
  return studioCorsHeaders('GET, OPTIONS');
}

function muxAuthHeader() {
  const id = process.env.MUX_TOKEN_ID;
  const secret = process.env.MUX_TOKEN_SECRET;
  if (!id || !secret) return null;
  return 'Basic ' + Buffer.from(id + ':' + secret).toString('base64');
}

async function muxGet(path, auth) {
  const res = await fetch('https://api.mux.com' + path, {
    headers: { Authorization: auth }
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function muxPatch(path, auth, body) {
  const res = await fetch('https://api.mux.com' + path, {
    method: 'PATCH',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

function publicPlaybackId(asset) {
  const ids = asset && asset.playback_ids ? asset.playback_ids : [];
  const pub = ids.find(function (p) {
    return p.policy === 'public';
  });
  return pub ? pub.id : ids[0] ? ids[0].id : null;
}

function inferKindMeta(asset, fileName) {
  const tracks = asset && asset.tracks ? asset.tracks : [];
  const hasVideoTrack = tracks.some(function (t) {
    return t.type === 'video';
  });
  const hasAudioTrack = tracks.some(function (t) {
    return t.type === 'audio';
  });

  if (hasVideoTrack) {
    return { kind: 'video', hasVideoTrack: true };
  }
  if (hasAudioTrack) {
    return { kind: 'audio', hasVideoTrack: false };
  }

  const name = fileName || (asset && asset.passthrough) || '';
  const fromName = inferKindFromName(name);
  if (fromName === 'audio') {
    return { kind: 'audio', hasVideoTrack: false };
  }
  if (fromName === 'video') {
    return { kind: 'video', hasVideoTrack: false };
  }

  const ar = asset && asset.aspect_ratio ? String(asset.aspect_ratio) : '';
  if (ar && ar !== '0:0') {
    const parts = ar.split(':').map(function (n) {
      return parseFloat(n, 10);
    });
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0 && parts[0] / parts[1] > 1.05) {
      return { kind: 'video', hasVideoTrack: false };
    }
  }

  return { kind: 'audio', hasVideoTrack: false };
}

function inferKindFromName(name) {
  const lower = String(name || '').toLowerCase();
  if (/\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)(\?|$)/i.test(lower)) return 'video';
  if (/\.(mp3|wav|flac|aiff|aif|m4a|ogg|aac)(\?|$)/i.test(lower)) return 'audio';
  return '';
}

async function listAllUploads(auth, maxPages) {
  const uploads = [];
  const pages = maxPages || 50;

  for (let page = 1; page <= pages; page += 1) {
    const result = await muxGet('/video/v1/uploads?limit=100&page=' + page, auth);
    if (!result.ok || !result.data || !Array.isArray(result.data.data)) break;
    uploads.push.apply(uploads, result.data.data);
    if (result.data.data.length < 100) break;
  }

  return uploads;
}

async function fetchAssetDetail(auth, assetId) {
  const result = await muxGet('/video/v1/assets/' + encodeURIComponent(assetId), auth);
  if (!result.ok || !result.data || !result.data.data) return null;
  return result.data.data;
}

async function repairAssetPassthrough(auth, assetId, passthrough) {
  if (!assetId || !passthrough || naming.isGenericMuxLabel(passthrough)) return;
  await muxPatch('/video/v1/assets/' + encodeURIComponent(assetId), auth, {
    passthrough: naming.sanitizeFileName(passthrough)
  });
}

async function listAllMuxAssets(auth, maxPages) {
  const uploads = await listAllUploads(auth, maxPages);
  const uploadMaps = naming.buildUploadMaps(uploads);
  const assets = [];
  const pages = maxPages || 50;

  for (let page = 1; page <= pages; page += 1) {
    const result = await muxGet('/video/v1/assets?limit=100&page=' + page, auth);
    if (!result.ok || !result.data || !Array.isArray(result.data.data)) break;

    result.data.data.forEach(function (row) {
      if (row.status === 'errored' || row.status === 'deleted') return;
      const playbackId = publicPlaybackId(row);
      if (!playbackId) return;

      const resolved = naming.resolveMuxAssetName(
        { id: row.id, passthrough: row.passthrough, input_info: row.input_info, playbackId: playbackId },
        { uploadByAssetId: uploadMaps.byAssetId }
      );

      const kindMeta = inferKindMeta(row, resolved.muxFileName);
      const kindFromName = inferKindFromName(resolved.muxFileName);
      if (kindFromName === 'audio') {
        kindMeta.kind = 'audio';
        kindMeta.hasVideoTrack = false;
      }

      assets.push({
        muxAssetId: row.id,
        playbackId: playbackId,
        passthrough: resolved.passthrough || resolved.muxFileName,
        displayTitle: resolved.displayTitle,
        muxFileName: resolved.muxFileName,
        kind: kindMeta.kind,
        hasVideoTrack: kindMeta.hasVideoTrack,
        duration: row.duration || null,
        aspectRatio: row.aspect_ratio || null,
        createdAt: row.created_at || null,
        nameSource: resolved.nameSource
      });
    });

    if (result.data.data.length < 100) break;
  }

  const needsDetail = assets.filter(function (item) {
    return naming.isGenericMuxLabel(item.passthrough) || item.nameSource === 'fallback';
  });

  for (let i = 0; i < needsDetail.length; i += 4) {
    const chunk = needsDetail.slice(i, i + 4);
    await Promise.all(
      chunk.map(async function (item) {
        const detail = await fetchAssetDetail(auth, item.muxAssetId);
        if (!detail) return;

        const detailResolved = naming.resolveMuxAssetName(
          {
            id: detail.id,
            passthrough: detail.passthrough,
            input_info: detail.input_info,
            playbackId: item.playbackId
          },
          { uploadByAssetId: uploadMaps.byAssetId, detailPassthrough: detail.passthrough }
        );

        if (detailResolved.nameSource === 'fallback') return;

        item.passthrough = detailResolved.passthrough || detailResolved.muxFileName;
        item.displayTitle = detailResolved.displayTitle;
        item.muxFileName = detailResolved.muxFileName;
        item.nameSource = detailResolved.nameSource;

        if (!detail.passthrough && item.passthrough) {
          repairAssetPassthrough(auth, item.muxAssetId, item.passthrough).catch(function () {});
        }
      })
    );
  }

  assets.forEach(function (item) {
    const uploadName = uploadMaps.byAssetId.get(item.muxAssetId);
    if (uploadName && naming.isGenericMuxLabel(item.passthrough)) {
      item.passthrough = uploadName;
      item.displayTitle = naming.displayTitleFromFileName(uploadName);
      item.muxFileName = naming.sanitizeFileName(uploadName);
      item.nameSource = 'mux-upload-repair';
      repairAssetPassthrough(auth, item.muxAssetId, uploadName).catch(function () {});
    }
  });

  assets.sort(function (a, b) {
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });

  return assets;
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

  const auth = muxAuthHeader();
  if (!auth) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ message: 'Mux is not configured on the server.' })
    };
  }

  try {
    const assets = await listAllMuxAssets(auth, 50);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ assets: assets, count: assets.length })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: error.message || 'Could not list Mux assets' })
    };
  }
};
