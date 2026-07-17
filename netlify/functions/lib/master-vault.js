'use strict';

const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const DEFAULT_BUCKET = 'burnfolder-masters';
const UPLOAD_TTL_SEC = 60 * 30;
const DOWNLOAD_TTL_SEC = 60 * 15;

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

function workspacePrefix(workspaceId) {
  const id = String(workspaceId || 'legacy').replace(/[^a-zA-Z0-9_-]/g, '');
  return 'ws/' + id;
}

/**
 * Masters: ws/{id}/masters/{trackKey}/{filename}
 * Projects: ws/{id}/projects/{songGroupKey}/{kind}/{filename}
 * Artwork: ws/{id}/artwork/{releaseKey}/{filename}
 */
function buildVaultKey(workspaceId, kind, opts) {
  const o = opts || {};
  const fileName = sanitizeFileName(o.fileName || 'file');
  const prefix = workspacePrefix(workspaceId);
  if (kind === 'master') {
    const trackKey = String(o.trackKey || o.tempId || 'temp')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 80) || 'temp';
    return prefix + '/masters/' + trackKey + '/' + fileName;
  }
  if (kind === 'artwork') {
    const releaseKey = String(o.releaseKey || 'draft')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 80) || 'draft';
    return prefix + '/artwork/' + releaseKey + '/' + fileName;
  }
  if (kind === 'session' || kind === 'stem' || kind === 'ref') {
    const songGroupKey = String(o.songGroupKey || 'ungrouped')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 80) || 'ungrouped';
    return prefix + '/projects/' + songGroupKey + '/' + kind + 's/' + fileName;
  }
  throw new Error('Unknown vault kind: ' + kind);
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

async function createUploadUrl(workspaceId, options) {
  const opts = options || {};
  const kind = opts.kind || 'master';
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

module.exports = {
  vaultConfigured,
  bucketName,
  buildVaultKey,
  assertOwnedKey,
  createUploadUrl,
  createDownloadUrl,
  headObject,
  getObjectBuffer,
  deleteObject,
  sanitizeFileName
};
