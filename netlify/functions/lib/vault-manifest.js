'use strict';

const { getStateStore, readLogical, writeLogical } = require('./studio-state-store');
const vault = require('./master-vault');

const PROJECT_KEY = 'projectFiles';
const IMAGE_KEY = 'imageLibrary';

function makeId(prefix) {
  return (
    (prefix || 'vf') +
    '_' +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2, 8)
  );
}

function emptyProjectManifest() {
  return { files: [] };
}

function emptyImageManifest() {
  return { images: [] };
}

function normalizeProjectManifest(value) {
  if (!value || typeof value !== 'object') return emptyProjectManifest();
  const files = Array.isArray(value.files) ? value.files.filter(Boolean) : [];
  return { files: files };
}

function normalizeImageManifest(value) {
  if (!value || typeof value !== 'object') return emptyImageManifest();
  const images = Array.isArray(value.images) ? value.images.filter(Boolean) : [];
  return { images: images };
}

function inferKindFromVaultKey(vaultKey) {
  const parts = String(vaultKey || '').split('/');
  // ws/{id}/projects/{song}/sessions|stems|refs/{file}
  if (parts[2] === 'projects' && parts[4]) {
    const folder = parts[4];
    if (folder === 'sessions') return 'session';
    if (folder === 'stems') return 'stem';
    if (folder === 'refs') return 'ref';
  }
  if (parts[2] === 'images') return 'image';
  if (parts[2] === 'press') return 'press';
  if (parts[2] === 'epk') return 'epk';
  if (parts[2] === 'masters') return 'master';
  if (parts[2] === 'artwork') return 'artwork';
  return null;
}

function inferSongGroupKey(vaultKey) {
  const parts = String(vaultKey || '').split('/');
  if (parts[2] === 'projects' && parts[3]) return parts[3];
  return '';
}

function inferFolderKey(vaultKey) {
  const parts = String(vaultKey || '').split('/');
  if ((parts[2] === 'images' || parts[2] === 'press' || parts[2] === 'epk') && parts[3]) {
    return parts[3];
  }
  return 'general';
}

async function readProjectManifest(store, workspaceId) {
  const record = await readLogical(store, workspaceId, PROJECT_KEY);
  return normalizeProjectManifest(record.value);
}

async function readImageManifest(store, workspaceId) {
  const record = await readLogical(store, workspaceId, IMAGE_KEY);
  return normalizeImageManifest(record.value);
}

function matchesFilters(row, filters) {
  const f = filters || {};
  if (f.kind && row.kind !== f.kind) return false;
  if (f.songGroupKey && row.songGroupKey !== f.songGroupKey) return false;
  if (f.folderKey && row.folderKey !== f.folderKey) return false;
  return true;
}

async function listManifest(event, workspaceId, filters) {
  const store = getStateStore(event);
  const f = filters || {};
  const kind = f.kind || '';
  const items = [];

  if (!kind || vault.isProjectKind(kind)) {
    const project = await readProjectManifest(store, workspaceId);
    project.files.forEach(function (row) {
      if (matchesFilters(row, f)) items.push(Object.assign({ source: 'manifest' }, row));
    });
  }

  if (!kind || vault.isImageKind(kind)) {
    const images = await readImageManifest(store, workspaceId);
    images.images.forEach(function (row) {
      if (matchesFilters(row, f)) items.push(Object.assign({ source: 'manifest' }, row));
    });
  }

  return items;
}

async function registerFile(event, workspaceId, input) {
  const body = input || {};
  const vaultKey = String(body.vaultKey || '').trim();
  if (!vaultKey) throw new Error('vaultKey required');
  vault.assertOwnedKey(workspaceId, vaultKey);

  const kind = body.kind || inferKindFromVaultKey(vaultKey);
  if (!kind || (!vault.isProjectKind(kind) && !vault.isImageKind(kind))) {
    throw new Error('register only supports session, stem, ref, image, press, epk');
  }

  const store = getStateStore(event);
  const filename = String(body.filename || body.fileName || vaultKey.split('/').pop() || 'file');
  const size = typeof body.size === 'number' ? body.size : null;
  const contentType = body.contentType || 'application/octet-stream';
  const notes = typeof body.notes === 'string' ? body.notes : '';
  const uploadedAt = body.uploadedAt || new Date().toISOString();

  if (vault.isProjectKind(kind)) {
    const manifest = await readProjectManifest(store, workspaceId);
    const existing = manifest.files.find(function (row) {
      return row && row.vaultKey === vaultKey;
    });
    const row = {
      id: existing && existing.id ? existing.id : makeId('pf'),
      songGroupKey: String(body.songGroupKey || inferSongGroupKey(vaultKey) || 'ungrouped'),
      kind: kind,
      vaultKey: vaultKey,
      filename: filename,
      size: size,
      contentType: contentType,
      uploadedAt: existing && existing.uploadedAt ? existing.uploadedAt : uploadedAt,
      notes: notes || (existing && existing.notes) || ''
    };
    if (existing) {
      manifest.files = manifest.files.map(function (item) {
        return item && item.vaultKey === vaultKey ? row : item;
      });
    } else {
      manifest.files.push(row);
    }
    await writeLogical(store, workspaceId, PROJECT_KEY, manifest);
    return { manifest: PROJECT_KEY, row: row };
  }

  const manifest = await readImageManifest(store, workspaceId);
  const existing = manifest.images.find(function (row) {
    return row && row.vaultKey === vaultKey;
  });
  const row = {
    id: existing && existing.id ? existing.id : makeId('img'),
    folderKey: String(body.folderKey || inferFolderKey(vaultKey) || 'general'),
    kind: kind,
    vaultKey: vaultKey,
    filename: filename,
    size: size,
    contentType: contentType,
    uploadedAt: existing && existing.uploadedAt ? existing.uploadedAt : uploadedAt,
    publicPath: typeof body.publicPath === 'string' ? body.publicPath : (existing && existing.publicPath) || '',
    notes: notes || (existing && existing.notes) || ''
  };
  if (existing) {
    manifest.images = manifest.images.map(function (item) {
      return item && item.vaultKey === vaultKey ? row : item;
    });
  } else {
    manifest.images.push(row);
  }
  await writeLogical(store, workspaceId, IMAGE_KEY, manifest);
  return { manifest: IMAGE_KEY, row: row };
}

async function unregisterFile(event, workspaceId, vaultKey) {
  const key = String(vaultKey || '').trim();
  if (!key) throw new Error('vaultKey required');
  vault.assertOwnedKey(workspaceId, key);

  const store = getStateStore(event);
  let removed = null;

  const project = await readProjectManifest(store, workspaceId);
  const beforeFiles = project.files.length;
  project.files = project.files.filter(function (row) {
    if (row && row.vaultKey === key) {
      removed = row;
      return false;
    }
    return true;
  });
  if (project.files.length !== beforeFiles) {
    await writeLogical(store, workspaceId, PROJECT_KEY, project);
    return { removed: removed, manifest: PROJECT_KEY };
  }

  const images = await readImageManifest(store, workspaceId);
  const beforeImages = images.images.length;
  images.images = images.images.filter(function (row) {
    if (row && row.vaultKey === key) {
      removed = row;
      return false;
    }
    return true;
  });
  if (images.images.length !== beforeImages) {
    await writeLogical(store, workspaceId, IMAGE_KEY, images);
    return { removed: removed, manifest: IMAGE_KEY };
  }

  return { removed: null, manifest: null };
}

function mergeList(manifestItems, r2Objects) {
  const byKey = {};
  (manifestItems || []).forEach(function (row) {
    if (!row || !row.vaultKey) return;
    byKey[row.vaultKey] = Object.assign({}, row, {
      verified: true,
      source: 'manifest',
      size: row.size != null ? row.size : null
    });
  });
  (r2Objects || []).forEach(function (obj) {
    if (!obj || !obj.vaultKey) return;
    if (byKey[obj.vaultKey]) {
      byKey[obj.vaultKey] = Object.assign({}, byKey[obj.vaultKey], {
        size: byKey[obj.vaultKey].size != null ? byKey[obj.vaultKey].size : obj.size,
        lastModified: obj.lastModified || byKey[obj.vaultKey].lastModified || null
      });
      return;
    }
    byKey[obj.vaultKey] = {
      vaultKey: obj.vaultKey,
      filename: obj.vaultKey.split('/').pop() || obj.vaultKey,
      size: obj.size,
      lastModified: obj.lastModified,
      kind: inferKindFromVaultKey(obj.vaultKey),
      songGroupKey: inferSongGroupKey(obj.vaultKey) || undefined,
      folderKey: inferFolderKey(obj.vaultKey) || undefined,
      verified: false,
      source: 'r2'
    };
  });
  return Object.keys(byKey)
    .map(function (key) {
      return byKey[key];
    })
    .sort(function (a, b) {
      const aTime = a.uploadedAt || a.lastModified || '';
      const bTime = b.uploadedAt || b.lastModified || '';
      return aTime < bTime ? 1 : aTime > bTime ? -1 : 0;
    });
}

module.exports = {
  PROJECT_KEY,
  IMAGE_KEY,
  listManifest,
  registerFile,
  unregisterFile,
  mergeList,
  inferKindFromVaultKey
};
