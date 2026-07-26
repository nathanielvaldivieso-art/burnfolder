'use strict';

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const DEFAULT_BUCKET = 'burnfolder-masters';
const UPLOAD_TTL_SEC = 60 * 30;
const DOWNLOAD_TTL_SEC = 60 * 15;

const PROJECT_KINDS = ['session', 'stem', 'ref'];
const IMAGE_KINDS = ['image', 'press', 'epk'];
const ALL_KINDS = ['master', 'artwork'].concat(PROJECT_KINDS, IMAGE_KINDS);

function vaultConfigured() {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY
  );
}

function bucketName() {
  return process.env.R2_BUCKET_NAME || DEFAULT_BUCKET;
}

function getClient() {
  if (!vaultConfigured()) {
    throw new Error(
      'R2 vault is not configured. Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (and optional R2_BUCKET_NAME) in Netlify env.'
    );
  }
  const accountId = process.env.R2_ACCOUNT_ID;
  return new S3Client({
    region: 'auto',
    endpoint: 'https://' + accountId + '.r2.cloudflarestorage.com',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });
}

function sanitizeFileName(name) {
  return String(name || 'file')
    .trim()
    .replace(/[^\w.\-()+ ]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'file';
}

function sanitizeSegment(value, fallback) {
  return String(value || fallback || 'general')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80) || fallback || 'general';
}

function workspacePrefix(workspaceId) {
  const id = String(workspaceId || 'legacy').replace(/[^a-zA-Z0-9_-]/g, '');
  return 'ws/' + id;
}

function isAllowedKind(kind) {
  return ALL_KINDS.indexOf(kind) > -1;
}

function isProjectKind(kind) {
  return PROJECT_KINDS.indexOf(kind) > -1;
}

function isImageKind(kind) {
  return IMAGE_KINDS.indexOf(kind) > -1;
}

/**
 * Masters: ws/{id}/masters/{trackKey}/{filename}
 * Artwork: ws/{id}/artwork/{releaseKey}/{filename}
 * Projects: ws/{id}/projects/{songGroupKey}/{kind}s/{filename}
 * Images: ws/{id}/images|press|epk/{folderKey}/{filename}
 */
function buildVaultKey(workspaceId, kind, opts) {
  const o = opts || {};
  const fileName = sanitizeFileName(o.fileName || 'file');
  const prefix = workspacePrefix(workspaceId);
  if (kind === 'master') {
    const trackKey = sanitizeSegment(o.trackKey || o.tempId, 'temp');
    return prefix + '/masters/' + trackKey + '/' + fileName;
  }
  if (kind === 'artwork') {
    const releaseKey = sanitizeSegment(o.releaseKey, 'draft');
    return prefix + '/artwork/' + releaseKey + '/' + fileName;
  }
  if (isProjectKind(kind)) {
    const songGroupKey = sanitizeSegment(o.songGroupKey, 'ungrouped');
    return prefix + '/projects/' + songGroupKey + '/' + kind + 's/' + fileName;
  }
  if (isImageKind(kind)) {
    const folderKey = sanitizeSegment(o.folderKey, 'general');
    const folder = kind === 'image' ? 'images' : kind;
    return prefix + '/' + folder + '/' + folderKey + '/' + fileName;
  }
  throw new Error('Unknown vault kind: ' + kind);
}

function listPrefixFor(workspaceId, options) {
  const opts = options || {};
  const kind = opts.kind || '';
  const prefix = workspacePrefix(workspaceId) + '/';

  if (isProjectKind(kind)) {
    const songGroupKey = sanitizeSegment(opts.songGroupKey, 'ungrouped');
    if (opts.songGroupKey) {
      return prefix + 'projects/' + songGroupKey + '/' + kind + 's/';
    }
    return prefix + 'projects/';
  }
  if (isImageKind(kind)) {
    const folder = kind === 'image' ? 'images' : kind;
    if (opts.folderKey) {
      return prefix + folder + '/' + sanitizeSegment(opts.folderKey, 'general') + '/';
    }
    return prefix + folder + '/';
  }
  if (kind === 'master') {
    if (opts.trackKey) {
      return prefix + 'masters/' + sanitizeSegment(opts.trackKey, 'temp') + '/';
    }
    return prefix + 'masters/';
  }
  if (kind === 'artwork') {
    if (opts.releaseKey) {
      return prefix + 'artwork/' + sanitizeSegment(opts.releaseKey, 'draft') + '/';
    }
    return prefix + 'artwork/';
  }
  return prefix;
}

function assertOwnedKey(workspaceId, key) {
  const expected = workspacePrefix(workspaceId) + '/';
  if (!key || typeof key !== 'string' || key.indexOf(expected) !== 0) {
    throw new Error('Vault key is outside this workspace');
  }
  if (key.indexOf('..') > -1) {
    throw new Error('Invalid vault key');
  }
}

function assertOwnedPrefix(workspaceId, prefix) {
  const expected = workspacePrefix(workspaceId) + '/';
  if (!prefix || typeof prefix !== 'string' || prefix.indexOf(expected) !== 0) {
    throw new Error('Vault prefix is outside this workspace');
  }
  if (prefix.indexOf('..') > -1) {
    throw new Error('Invalid vault prefix');
  }
}

async function createUploadUrl(workspaceId, options) {
  const opts = options || {};
  const kind = opts.kind || 'master';
  if (!isAllowedKind(kind)) {
    throw new Error('Unknown vault kind: ' + kind);
  }
  const contentType = opts.contentType || 'application/octet-stream';
  const key = opts.vaultKey || buildVaultKey(workspaceId, kind, opts);
  assertOwnedKey(workspaceId, key);

  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: bucketName(),
    Key: key,
    ContentType: contentType
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: UPLOAD_TTL_SEC });
  return {
    vaultKey: key,
    uploadUrl: uploadUrl,
    expiresIn: UPLOAD_TTL_SEC,
    contentType: contentType,
    bucket: bucketName()
  };
}

async function createDownloadUrl(workspaceId, vaultKey) {
  assertOwnedKey(workspaceId, vaultKey);
  const client = getClient();
  const command = new GetObjectCommand({
    Bucket: bucketName(),
    Key: vaultKey
  });
  const downloadUrl = await getSignedUrl(client, command, { expiresIn: DOWNLOAD_TTL_SEC });
  return {
    vaultKey: vaultKey,
    downloadUrl: downloadUrl,
    expiresIn: DOWNLOAD_TTL_SEC
  };
}

async function headObject(workspaceId, vaultKey) {
  assertOwnedKey(workspaceId, vaultKey);
  const client = getClient();
  try {
    const result = await client.send(
      new HeadObjectCommand({
        Bucket: bucketName(),
        Key: vaultKey
      })
    );
    return {
      exists: true,
      vaultKey: vaultKey,
      contentType: result.ContentType || null,
      contentLength: typeof result.ContentLength === 'number' ? result.ContentLength : null,
      lastModified: result.LastModified ? result.LastModified.toISOString() : null
    };
  } catch (error) {
    if (error && (error.name === 'NotFound' || error.$metadata && error.$metadata.httpStatusCode === 404)) {
      return { exists: false, vaultKey: vaultKey };
    }
    throw error;
  }
}

async function getObjectBuffer(workspaceId, vaultKey) {
  assertOwnedKey(workspaceId, vaultKey);
  const client = getClient();
  const result = await client.send(
    new GetObjectCommand({
      Bucket: bucketName(),
      Key: vaultKey
    })
  );
  const bytes = await result.Body.transformToByteArray();
  return {
    buffer: Buffer.from(bytes),
    contentType: result.ContentType || 'application/octet-stream',
    contentLength: typeof result.ContentLength === 'number' ? result.ContentLength : bytes.length
  };
}

async function deleteObject(workspaceId, vaultKey) {
  assertOwnedKey(workspaceId, vaultKey);
  const client = getClient();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucketName(),
      Key: vaultKey
    })
  );
  return { deleted: true, vaultKey: vaultKey };
}

async function listPrefix(workspaceId, options) {
  const opts = options || {};
  const prefix = opts.prefix || listPrefixFor(workspaceId, opts);
  assertOwnedPrefix(workspaceId, prefix);

  const client = getClient();
  const objects = [];
  let continuationToken = undefined;

  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 200
      })
    );
    const contents = result.Contents || [];
    for (let i = 0; i < contents.length; i++) {
      const item = contents[i];
      if (!item || !item.Key || item.Key.endsWith('/')) continue;
      objects.push({
        vaultKey: item.Key,
        size: typeof item.Size === 'number' ? item.Size : null,
        lastModified: item.LastModified ? item.LastModified.toISOString() : null,
        verified: false
      });
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return { prefix: prefix, objects: objects };
}

module.exports = {
  vaultConfigured,
  bucketName,
  buildVaultKey,
  assertOwnedKey,
  assertOwnedPrefix,
  createUploadUrl,
  createDownloadUrl,
  headObject,
  getObjectBuffer,
  deleteObject,
  listPrefix,
  listPrefixFor,
  sanitizeFileName,
  isAllowedKind,
  isProjectKind,
  isImageKind,
  PROJECT_KINDS,
  IMAGE_KINDS,
  ALL_KINDS
};
