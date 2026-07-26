'use strict';

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const DEFAULT_BUCKET = 'burnfolder-masters';
const UPLOAD_TTL_SEC = 60 * 30;
const DOWNLOAD_TTL_SEC = 60 * 15;
/** Max binary bytes for a single Netlify-proxied put (under ~6MB function limit). */
const PROXY_PUT_MAX_BYTES = 5 * 1024 * 1024 + 512 * 1024;
/** S3/R2 require non-final multipart parts to be at least 5 MiB. */
const MULTIPART_PART_BYTES = 5 * 1024 * 1024;

/** Browser PUT/GET to presigned R2 URLs requires bucket CORS (Safari: "Load failed"). */
const VAULT_CORS_RULES = [
  {
    AllowedOrigins: ['*'],
    AllowedMethods: ['GET', 'PUT', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag', 'Content-Type', 'Content-Length'],
    MaxAgeSeconds: 3600
  }
];

let corsEnsurePromise = null;

const PROJECT_KINDS = ['session', 'stem', 'ref'];
const IMAGE_KINDS = ['image', 'press', 'epk'];
/** Generic Clips board attachments (pdf, zip, non-stream wav masters, etc.). */
const CLIP_KINDS = ['clip'];
const ALL_KINDS = ['master', 'artwork'].concat(PROJECT_KINDS, IMAGE_KINDS, CLIP_KINDS);

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

function isClipKind(kind) {
  return CLIP_KINDS.indexOf(kind) > -1;
}

/**
 * Masters: ws/{id}/masters/{trackKey}/{filename}
 * Artwork: ws/{id}/artwork/{releaseKey}/{filename}
 * Projects: ws/{id}/projects/{songGroupKey}/{kind}s/{filename}
 * Images: ws/{id}/images|press|epk/{folderKey}/{filename}
 * Clips: ws/{id}/clips/{folderKey}/{filename}
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
  if (isClipKind(kind)) {
    const folderKey = sanitizeSegment(o.folderKey, 'board');
    return prefix + '/clips/' + folderKey + '/' + fileName;
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
  if (isClipKind(kind)) {
    if (opts.folderKey) {
      return prefix + 'clips/' + sanitizeSegment(opts.folderKey, 'board') + '/';
    }
    return prefix + 'clips/';
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

function corsRuleAllowsBrowserPut(rule) {
  if (!rule) return false;
  const methods = rule.AllowedMethods || [];
  const hasPut = methods.indexOf('PUT') > -1;
  const hasGet = methods.indexOf('GET') > -1;
  const origins = rule.AllowedOrigins || [];
  const hasOrigin = origins.indexOf('*') > -1 || origins.length > 0;
  const headers = rule.AllowedHeaders || [];
  const hasHeaders = headers.indexOf('*') > -1 || headers.length > 0;
  return hasPut && hasGet && hasOrigin && hasHeaders;
}

function corsConfigIsReady(cors) {
  const rules = (cors && cors.CORSRules) || [];
  return rules.some(corsRuleAllowsBrowserPut);
}

/**
 * Ensures the R2 bucket accepts browser PUT/GET with Content-Type (presigned uploads).
 * Idempotent; cached per process after the first successful check/apply.
 */
async function ensureBucketCors() {
  if (corsEnsurePromise) return corsEnsurePromise;
  corsEnsurePromise = (async function () {
    const client = getClient();
    const bucket = bucketName();
    try {
      const existing = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
      if (corsConfigIsReady(existing)) {
        return { ok: true, applied: false, bucket: bucket };
      }
    } catch (error) {
      const status = error && error.$metadata && error.$metadata.httpStatusCode;
      const missing =
        status === 404 ||
        (error && (error.name === 'NoSuchCORSConfiguration' || error.Code === 'NoSuchCORSConfiguration'));
      if (!missing) throw error;
    }
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: VAULT_CORS_RULES }
      })
    );
    return { ok: true, applied: true, bucket: bucket };
  })().catch(function (error) {
    corsEnsurePromise = null;
    throw error;
  });
  return corsEnsurePromise;
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
  // Best-effort: missing CORS is the usual cause of Safari "Load failed" on PUT.
  try {
    await ensureBucketCors();
  } catch (error) {
    console.warn(
      '[master-vault] ensureBucketCors failed:',
      error && error.message ? error.message : error
    );
  }
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

/**
 * Server-side put (avoids browser→R2 CORS). Body must be a Buffer.
 */
async function putObject(workspaceId, options) {
  const opts = options || {};
  const kind = opts.kind || 'master';
  if (!opts.vaultKey && !isAllowedKind(kind)) {
    throw new Error('Unknown vault kind: ' + kind);
  }
  const contentType = opts.contentType || 'application/octet-stream';
  const key = opts.vaultKey || buildVaultKey(workspaceId, kind, opts);
  assertOwnedKey(workspaceId, key);
  const body = opts.body;
  if (!Buffer.isBuffer(body)) {
    throw new Error('putObject requires a Buffer body');
  }
  if (body.length > PROXY_PUT_MAX_BYTES) {
    throw new Error(
      'File too large for single proxy put (' + body.length + ' bytes). Use multipart.'
    );
  }
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
  return {
    vaultKey: key,
    contentType: contentType,
    size: body.length,
    bucket: bucketName()
  };
}

async function createMultipartUpload(workspaceId, options) {
  const opts = options || {};
  const kind = opts.kind || 'master';
  if (!isAllowedKind(kind)) {
    throw new Error('Unknown vault kind: ' + kind);
  }
  const contentType = opts.contentType || 'application/octet-stream';
  const key = opts.vaultKey || buildVaultKey(workspaceId, kind, opts);
  assertOwnedKey(workspaceId, key);
  const client = getClient();
  const result = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucketName(),
      Key: key,
      ContentType: contentType
    })
  );
  return {
    vaultKey: key,
    uploadId: result.UploadId,
    contentType: contentType,
    bucket: bucketName()
  };
}

async function uploadPart(workspaceId, options) {
  const opts = options || {};
  const key = opts.vaultKey;
  const uploadId = opts.uploadId;
  const partNumber = opts.partNumber;
  const body = opts.body;
  assertOwnedKey(workspaceId, key);
  if (!uploadId) throw new Error('uploadId required');
  if (!partNumber || partNumber < 1) throw new Error('partNumber required');
  if (!Buffer.isBuffer(body) || !body.length) throw new Error('part body required');
  if (body.length > PROXY_PUT_MAX_BYTES) {
    throw new Error('Part too large for proxy upload');
  }
  const client = getClient();
  const result = await client.send(
    new UploadPartCommand({
      Bucket: bucketName(),
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body
    })
  );
  return {
    vaultKey: key,
    uploadId: uploadId,
    partNumber: partNumber,
    etag: result.ETag
  };
}

async function completeMultipartUpload(workspaceId, options) {
  const opts = options || {};
  const key = opts.vaultKey;
  const uploadId = opts.uploadId;
  const parts = Array.isArray(opts.parts) ? opts.parts : [];
  assertOwnedKey(workspaceId, key);
  if (!uploadId) throw new Error('uploadId required');
  if (!parts.length) throw new Error('parts required');
  const client = getClient();
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucketName(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map(function (part) {
          return { ETag: part.etag || part.ETag, PartNumber: part.partNumber || part.PartNumber };
        })
      }
    })
  );
  return { vaultKey: key, uploadId: uploadId, completed: true };
}

async function abortMultipartUpload(workspaceId, options) {
  const opts = options || {};
  const key = opts.vaultKey;
  const uploadId = opts.uploadId;
  assertOwnedKey(workspaceId, key);
  if (!uploadId) throw new Error('uploadId required');
  const client = getClient();
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: bucketName(),
      Key: key,
      UploadId: uploadId
    })
  );
  return { vaultKey: key, uploadId: uploadId, aborted: true };
}

async function createDownloadUrl(workspaceId, vaultKey, options) {
  assertOwnedKey(workspaceId, vaultKey);
  const opts = options || {};
  const client = getClient();
  const rawName = String(opts.filename || '')
    .replace(/[\\/]/g, '-')
    .replace(/[^\w.\-()+ ]/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 180);
  const inline = opts.inline === true || opts.disposition === 'inline';
  const disposition = inline
    ? rawName
      ? 'inline; filename="' + rawName.replace(/"/g, '') + '"'
      : 'inline'
    : rawName
      ? 'attachment; filename="' + rawName.replace(/"/g, '') + '"'
      : 'attachment';
  const command = new GetObjectCommand({
    Bucket: bucketName(),
    Key: vaultKey,
    ResponseContentDisposition: disposition
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
  ensureBucketCors,
  createUploadUrl,
  putObject,
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
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
  isClipKind,
  PROJECT_KINDS,
  IMAGE_KINDS,
  CLIP_KINDS,
  ALL_KINDS,
  VAULT_CORS_RULES,
  PROXY_PUT_MAX_BYTES,
  MULTIPART_PART_BYTES
};
