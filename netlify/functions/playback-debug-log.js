'use strict';

/**
 * Receives and serves the auto-uploaded playback debug log.
 *
 * POST — installed-PWA sessions beacon new shared/playback-debug.js entries here
 *        (see BurnfolderPlaybackDebug.enableAutoUpload). Fire-and-forget, no auth:
 *        the payload is small, capped, and low-sensitivity (event names + timing,
 *        the same Mux playback IDs already visible in the page's own markup).
 *
 * GET  — fetch the accumulated log, e.g. after a lock-screen repro, without
 *        needing physical access to the phone. Gated by a shared key so it
 *        isn't world-readable, but the key ships in this file (not a real
 *        secret) since the whole point is that it can be fetched unattended.
 *        Override by setting PLAYBACK_DEBUG_KEY in Netlify env vars.
 *        Examples:
 *          GET /api/playback-debug-log?key=KEY            -> formatted text
 *          GET /api/playback-debug-log?key=KEY&format=json -> raw entries
 *          POST /api/playback-debug-log?key=KEY&clear=1    -> wipe the log
 */

const { studioCorsHeaders } = require('./lib/studio-auth');
const { debugStore, readEntries, appendEntries, clearEntries } = require('./lib/playback-debug-store');

const DEFAULT_KEY = 'burnfolder-playback-debug-2026';
const MAX_BODY = 32 * 1024;
const MAX_ENTRIES_PER_POST = 60;

function readKey() {
  return String(process.env.PLAYBACK_DEBUG_KEY || DEFAULT_KEY);
}

function corsHeaders(extra) {
  return Object.assign(studioCorsHeaders('GET, POST, OPTIONS'), extra || {});
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = Number(raw.t);
  if (!Number.isFinite(t)) return null;
  const entry = {
    t: Math.floor(t),
    hidden: raw.hidden === true ? true : raw.hidden === false ? false : null,
    event: String(raw.event || '').slice(0, 80),
    device: typeof raw.device === 'string' ? raw.device.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) : ''
  };
  if (!entry.event) return null;
  if (raw.data !== null && raw.data !== undefined) {
    try {
      const json = JSON.stringify(raw.data);
      entry.data = json.length > 400 ? JSON.parse(json.slice(0, 400) + '"...(truncated)"') : raw.data;
    } catch (e) {
      entry.data = null;
    }
  } else {
    entry.data = null;
  }
  return entry;
}

function pad(n, width) {
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

function formatEntry(entry, firstT) {
  const d = new Date(entry.t);
  const time =
    pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2) + '.' + pad(d.getMilliseconds(), 3);
  const rel = firstT != null ? '+' + (entry.t - firstT) + 'ms' : '';
  const vis = entry.hidden === true ? 'bg' : entry.hidden === false ? 'fg' : '??';
  const dev = entry.device ? '[' + entry.device + '] ' : '';
  let extra = '';
  if (entry.data !== null && entry.data !== undefined) {
    try {
      extra = ' ' + JSON.stringify(entry.data);
    } catch (e) {
      extra = ' ' + String(entry.data);
    }
  }
  return time + '  [' + vis + ']  ' + dev + rel.padEnd(9) + entry.event + extra;
}

function formatText(entries) {
  if (!entries.length) return '(no playback events recorded yet)';
  const firstT = entries[0].t;
  return entries.map(function (entry) { return formatEntry(entry, firstT); }).join('\n');
}

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (String(params.key || '') !== readKey()) {
    return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ message: 'Unauthorized' }) };
  }

  const store = debugStore(event);

  if (event.httpMethod === 'GET') {
    if (String(params.clear || '') === '1') {
      await clearEntries(store);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ cleared: true }) };
    }
    const entries = await readEntries(store);
    if (String(params.format || '') === 'json') {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ entries: entries }) };
    }
    return {
      statusCode: 200,
      headers: corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }),
      body: formatText(entries)
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  if (String(params.clear || '') === '1') {
    await clearEntries(store);
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if ((event.body || '').length > MAX_BODY) {
    return { statusCode: 413, headers: corsHeaders(), body: JSON.stringify({ message: 'Payload too large' }) };
  }

  let body = {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '{}';
    body = JSON.parse(raw);
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ message: 'Invalid JSON' }) };
  }

  const rawEntries = Array.isArray(body.entries) ? body.entries : [];
  const entries = rawEntries.slice(0, MAX_ENTRIES_PER_POST).map(sanitizeEntry).filter(Boolean);
  if (!entries.length) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ message: 'no valid entries' }) };
  }

  try {
    await appendEntries(store, entries);
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  } catch (error) {
    console.error('playback-debug-log:', error);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ message: error.message || 'ingest failed' }) };
  }
};
