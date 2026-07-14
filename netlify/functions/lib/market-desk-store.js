'use strict';

const { getStore, connectLambda } = require('@netlify/blobs');
const { scopedBlobKey } = require('./workspace-auth');

const STORE_NAME = 'studio-state';
const QUEUE_KEY = 'loyaltyQueue';
const FANS_KEY = 'fanActions';
const MAX_QUEUE = 40;
const MAX_FAN_EVENTS = 500;

function store(event) {
  if (event) connectLambda(event);
  return getStore(STORE_NAME);
}

function keyFor(workspaceId, logical) {
  return scopedBlobKey(workspaceId || 'legacy', logical) || logical;
}

async function readJson(blobStore, key, fallback) {
  const data = await blobStore.get(key, { type: 'json' });
  return data && typeof data === 'object' ? data : fallback;
}

async function writeJson(blobStore, key, value) {
  await blobStore.setJSON(key, value);
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function newId() {
  return 'lq_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

async function readQueue(blobStore, workspaceId) {
  const key = keyFor(workspaceId, QUEUE_KEY);
  const data = await readJson(blobStore, key, { items: [] });
  return {
    key: key,
    items: Array.isArray(data.items) ? data.items : []
  };
}

async function writeQueue(blobStore, workspaceId, items) {
  const key = keyFor(workspaceId, QUEUE_KEY);
  await writeJson(blobStore, key, {
    items: (items || []).slice(0, MAX_QUEUE),
    updatedAt: new Date().toISOString()
  });
}

async function readFans(blobStore, workspaceId) {
  const key = keyFor(workspaceId, FANS_KEY);
  const data = await readJson(blobStore, key, { events: [] });
  return {
    key: key,
    events: Array.isArray(data.events) ? data.events : []
  };
}

async function writeFans(blobStore, workspaceId, events) {
  const key = keyFor(workspaceId, FANS_KEY);
  await writeJson(blobStore, key, {
    events: (events || []).slice(0, MAX_FAN_EVENTS),
    updatedAt: new Date().toISOString()
  });
}

/**
 * Record an identifiable fan action (email known). Anonymous site plays cannot use this.
 * actionKey examples: subscribe | tip | digital | shop | campaign:entry-foo
 */
async function recordFanAction(blobStore, workspaceId, event) {
  const email = normalizeEmail(event && event.email);
  if (!email || email.indexOf('@') < 0) return null;
  const actionKey = String((event && event.actionKey) || 'unknown').slice(0, 80);
  const fans = await readFans(blobStore, workspaceId);
  fans.events.unshift({
    email: email,
    actionKey: actionKey,
    label: String((event && event.label) || actionKey).slice(0, 120),
    at: (event && event.at) || new Date().toISOString(),
    meta: event && event.meta && typeof event.meta === 'object' ? event.meta : {}
  });
  await writeFans(blobStore, workspaceId, fans.events);
  return fans.events[0];
}

async function listSubscribers(event) {
  try {
    if (event) connectLambda(event);
    const news = getStore('burnfolder-newsletter');
    const data = await news.get('subscriber-emails', { type: 'json' });
    const list = Array.isArray(data) ? data : [];
    return list.map(normalizeEmail).filter(function (e) {
      return e.indexOf('@') > 0;
    });
  } catch (e) {
    return [];
  }
}

function uniqueEmails(list) {
  const seen = {};
  const out = [];
  (list || []).forEach(function (raw) {
    const e = normalizeEmail(raw);
    if (!e || e.indexOf('@') < 0 || seen[e]) return;
    seen[e] = true;
    out.push(e);
  });
  return out;
}

async function resolveAudience(blobStore, workspaceId, audience, event) {
  const mode = audience && audience.mode ? String(audience.mode).toLowerCase() : 'none';
  if (mode === 'none' || mode === 'task') {
    return { emails: [], note: 'studio task — no email audience' };
  }
  if (mode === 'manual') {
    return {
      emails: uniqueEmails(audience.emails || []),
      note: 'manual pick'
    };
  }
  if (mode === 'action') {
    const actionKey = String((audience && audience.actionKey) || '').slice(0, 80);
    if (!actionKey) {
      return { emails: [], note: 'missing actionKey' };
    }
    if (actionKey === 'subscribe' || actionKey === 'subscribers') {
      const subs = await listSubscribers(event);
      return { emails: uniqueEmails(subs), note: 'all subscribers' };
    }
    // Fan actions (tips/checkout/subscribe) are site-global → legacy key.
    const fans = await readFans(blobStore, 'legacy');
    const matched = fans.events
      .filter(function (row) {
        return row.actionKey === actionKey;
      })
      .map(function (row) {
        return row.email;
      });
    return {
      emails: uniqueEmails(matched),
      note: 'fans with action ' + actionKey
    };
  }
  if (mode === 'subscribers' || mode === 'subscribe') {
    const subs = await listSubscribers(event);
    return { emails: uniqueEmails(subs), note: 'all subscribers' };
  }
  return { emails: [], note: 'unknown audience mode' };
}

function normalizeQueueItem(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const audienceIn = item.audience && typeof item.audience === 'object' ? item.audience : {};
  const mode = String(audienceIn.mode || 'none').toLowerCase() || 'none';
  return {
    id: item.id || newId(),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || new Date().toISOString(),
    status: item.status || 'queued',
    move: String(item.move || 'act').slice(0, 40),
    title: String(item.title || '').trim().slice(0, 160),
    why: String(item.why || '').slice(0, 600),
    cohortLabel: String(item.cohortLabel || '').slice(0, 160),
    audience: {
      mode: mode,
      actionKey: String(audienceIn.actionKey || '').slice(0, 80),
      emails: Array.isArray(audienceIn.emails)
        ? audienceIn.emails.map(normalizeEmail).slice(0, 200)
        : []
    },
    subject: String(item.subject || '').slice(0, 200),
    body: String(item.body || '').slice(0, 8000),
    shareHint: String(item.shareHint || '').slice(0, 400),
    aiHint: String(item.aiHint || '').slice(0, 600),
    sentAt: item.sentAt || null,
    sentCount: Number(item.sentCount) || 0
  };
}

var JUNK_TITLE =
  /^(untitled(\s+move)?|note|other|move|todo|action|act|item|check|look|see)?\.?$/i;
var FLUFF_TITLE =
  /^(more plays|nice week|looking good|keep going|great job|you'?re growing)\b/i;

/**
 * Concrete marketing / studio move — titled, not fluff.
 * Email audiences stay explicit; ops tasks use audience.mode "none".
 */
function passesScrutiny(raw) {
  const item = normalizeQueueItem(raw);
  const title = String(item.title || '').trim();
  if (!title || title.length < 8 || JUNK_TITLE.test(title) || FLUFF_TITLE.test(title)) {
    return false;
  }

  const audience = item.audience || {};
  const mode = String(audience.mode || 'none').toLowerCase();
  const actionKey = String(audience.actionKey || '').toLowerCase();
  const emails = Array.isArray(audience.emails) ? audience.emails : [];

  if (mode === 'manual') return emails.length > 0;
  if (mode === 'action') return !!actionKey;
  if (mode === 'subscribers' || mode === 'subscribe') return true;
  if (mode === 'none' || mode === 'task' || mode === '') return true;

  return false;
}

function isEmailableAction(raw) {
  const item = normalizeQueueItem(raw);
  const mode = String((item.audience && item.audience.mode) || 'none').toLowerCase();
  if (mode === 'none' || mode === 'task' || !mode) return false;
  if (mode === 'manual') {
    return Array.isArray(item.audience.emails) && item.audience.emails.length > 0;
  }
  if (mode === 'action') return !!(item.audience && item.audience.actionKey);
  if (mode === 'subscribers' || mode === 'subscribe') return true;
  return false;
}

function scrubQueueItems(items) {
  let changed = false;
  const next = (items || []).map(function (item) {
    if (!item || item.status === 'cancelled' || item.status === 'sent' || item.status === 'done') {
      return item;
    }
    if (passesScrutiny(item)) return item;
    changed = true;
    return Object.assign({}, item, {
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
      aiHint: (item.aiHint ? item.aiHint + ' · ' : '') + 'auto-cancelled: failed action scrutiny'
    });
  });
  return { items: next, changed: changed };
}

async function addQueueItems(blobStore, workspaceId, actions) {
  const queue = await readQueue(blobStore, workspaceId);
  const added = [];
  (actions || []).forEach(function (action) {
    if (!passesScrutiny(action)) return;
    const item = normalizeQueueItem(
      Object.assign({}, action, {
        status: 'queued',
        subject: '',
        body: '',
        id: newId()
      })
    );
    queue.items.unshift(item);
    added.push(item);
  });
  await writeQueue(blobStore, workspaceId, queue.items);
  return added;
}

async function updateQueueItem(blobStore, workspaceId, id, patch) {
  const queue = await readQueue(blobStore, workspaceId);
  let updated = null;
  queue.items = queue.items.map(function (item) {
    if (item.id !== id) return item;
    const next = normalizeQueueItem(
      Object.assign({}, item, patch || {}, {
        id: item.id,
        createdAt: item.createdAt,
        updatedAt: new Date().toISOString()
      })
    );
    if (next.body && next.subject && next.status === 'queued') {
      next.status = 'ready';
    }
    if (patch && patch.status) next.status = patch.status;
    updated = next;
    return next;
  });
  if (!updated) return null;
  await writeQueue(blobStore, workspaceId, queue.items);
  return updated;
}

async function audienceSummary(blobStore, workspaceId, event) {
  const fans = await readFans(blobStore, 'legacy');
  const byAction = {};
  fans.events.forEach(function (row) {
    if (!byAction[row.actionKey]) {
      byAction[row.actionKey] = { actionKey: row.actionKey, label: row.label || row.actionKey, emails: {} };
    }
    byAction[row.actionKey].emails[row.email] = true;
  });
  const actions = Object.keys(byAction).map(function (k) {
    const row = byAction[k];
    return {
      actionKey: row.actionKey,
      label: row.label,
      count: Object.keys(row.emails).length
    };
  });
  const subscribers = await listSubscribers(event);
  return {
    subscribers: subscribers.length,
    actions: actions,
    note:
      'anonymous site plays cannot be emailed. addressable = subscribers + tip/shop/digital emails we have stored.'
  };
}

module.exports = {
  store,
  readQueue,
  writeQueue,
  readFans,
  recordFanAction,
  resolveAudience,
  addQueueItems,
  updateQueueItem,
  normalizeQueueItem,
  passesScrutiny,
  isEmailableAction,
  scrubQueueItems,
  audienceSummary,
  listSubscribers,
  uniqueEmails,
  normalizeEmail,
  newId,
  QUEUE_KEY,
  FANS_KEY
};
