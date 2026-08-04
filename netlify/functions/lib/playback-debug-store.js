'use strict';

/**
 * Storage for the auto-uploaded playback debug log (see shared/playback-debug.js).
 * One rolling buffer, capped, shared across whichever installed-PWA devices are
 * being used to chase the current lock-screen bug. Not meant for high traffic —
 * only installed/standalone sessions upload, which in practice is just whoever
 * is actively testing.
 */

const { getStore, connectLambda } = require('@netlify/blobs');

const STORE_NAME = 'playback-debug';
const LOG_KEY = 'log/v1';
const MAX_ENTRIES = 800;

function debugStore(event) {
  if (event) connectLambda(event);
  return getStore(STORE_NAME);
}

async function readEntries(store) {
  const data = await store.get(LOG_KEY, { type: 'json' });
  if (!data || !Array.isArray(data.entries)) return [];
  return data.entries;
}

async function appendEntries(store, newEntries) {
  const existing = await readEntries(store);
  const merged = existing.concat(newEntries).slice(-MAX_ENTRIES);
  await store.setJSON(LOG_KEY, { entries: merged, updatedAt: new Date().toISOString() });
  return merged;
}

async function clearEntries(store) {
  await store.setJSON(LOG_KEY, { entries: [], updatedAt: new Date().toISOString() });
}

module.exports = {
  debugStore,
  readEntries,
  appendEntries,
  clearEntries,
  MAX_ENTRIES
};
