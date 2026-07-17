'use strict';

const { getStore, connectLambda } = require('@netlify/blobs');
const { scopedBlobKey } = require('./workspace-auth');

function getStateStore(event) {
  connectLambda(event);
  return getStore('studio-state');
}

async function readLogical(store, workspaceId, logicalKey) {
  const storageKey = scopedBlobKey(workspaceId, logicalKey);
  const record = await store.get(storageKey, { type: 'json' });
  if (record && typeof record === 'object' && 'value' in record) {
    return { value: record.value, updatedAt: record.updatedAt || null };
  }
  return { value: null, updatedAt: null };
}

async function writeLogical(store, workspaceId, logicalKey, value) {
  const storageKey = scopedBlobKey(workspaceId, logicalKey);
  const updatedAt = new Date().toISOString();
  await store.setJSON(storageKey, { value: value, updatedAt: updatedAt });
  return { value: value, updatedAt: updatedAt };
}

module.exports = {
  getStateStore,
  readLogical,
  writeLogical
};
