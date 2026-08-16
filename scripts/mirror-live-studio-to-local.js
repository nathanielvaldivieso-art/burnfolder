#!/usr/bin/env node
/**
 * One-shot: copy production studio-state into local netlify dev blobs.
 *
 * Usage (with local `npm run dev` already on :8888):
 *   node scripts/mirror-live-studio-to-local.js
 *
 * Reads STUDIO_API_SECRET from .env (never prints it).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIVE = process.env.LIVE_ORIGIN || 'https://burnfolder.com';
const LOCAL = process.env.LOCAL_ORIGIN || 'http://localhost:8888';

const KEYS = [
  'drafts',
  'stack',
  'stackMeta',
  'groups',
  'journalDays',
  'songPages',
  'albumPages',
  'pressPage',
  'shopProducts',
  'notes',
  'releaseDates',
  'trackPipeline',
  'trackRegistry',
  'releaseCatalog',
  'distroPreferences',
  'projectFiles',
  'imageLibrary',
  'clips'
];

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env — need STUDIO_API_SECRET');
  }
  const out = {};
  fs.readFileSync(envPath, 'utf8').split(/\n/).forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === '#') return;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') ||
      (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  });
  return out;
}

async function main() {
  const env = loadEnv();
  const secret = env.STUDIO_API_SECRET || process.env.STUDIO_API_SECRET;
  if (!secret) throw new Error('STUDIO_API_SECRET missing');

  const exportUrl = LIVE.replace(/\/$/, '') + '/.netlify/functions/studio-export';
  const res = await fetch(exportUrl, {
    headers: { Authorization: 'Bearer ' + secret }
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error('live export failed (' + res.status + '): ' + text.slice(0, 200));
  }
  const bundle = JSON.parse(text);
  const keys = bundle.keys || {};
  console.log(
    'live workspace:',
    (bundle.workspace && (bundle.workspace.slug || bundle.workspace.id)) || '(unknown)',
    'exportedAt:',
    bundle.exportedAt || '?'
  );

  const base = LOCAL.replace(/\/$/, '') + '/.netlify/functions/studio-state';
  let wrote = 0;
  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[i];
    if (!(key in keys)) continue;
    const value = keys[key];
    const put = await fetch(base, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secret,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ key: key, value: value })
    });
    if (!put.ok) {
      const errText = await put.text();
      throw new Error('local write "' + key + '" failed (' + put.status + '): ' + errText.slice(0, 200));
    }
    wrote += 1;
    const preview =
      key === 'clips' && value && Array.isArray(value.blocks)
        ? ' blocks=' + value.blocks.length
        : key === 'groups' && Array.isArray(value)
          ? ' groups=' + value.length
          : '';
    console.log('wrote', key + preview);
  }
  console.log('done — mirrored', wrote, 'keys into', LOCAL);
  console.log('hard-refresh http://localhost:8888/studio/clips.html');
}

main().catch(function (err) {
  console.error(err.message || err);
  process.exit(1);
});
