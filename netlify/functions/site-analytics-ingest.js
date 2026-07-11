'use strict';

const { studioCorsHeaders } = require('./lib/studio-auth');
const { analyticsStore, ingestEvents } = require('./lib/site-analytics-store');

const MAX_EVENTS = 80;
const MAX_BODY = 96 * 1024;

function corsHeaders() {
  return studioCorsHeaders('POST, OPTIONS');
}

function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '');
  if (
    type !== 'land' &&
    type !== 'play_start' &&
    type !== 'play_progress' &&
    type !== 'play_end' &&
    type !== 'outbound' &&
    type !== 'pathway'
  ) {
    return null;
  }

  const event = {
    type: type,
    ts: typeof raw.ts === 'string' ? raw.ts.slice(0, 40) : new Date().toISOString(),
    page: typeof raw.page === 'string' ? raw.page.slice(0, 160) : '',
    sessionId:
      typeof raw.sessionId === 'string' ? raw.sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) : ''
  };

  if (type === 'pathway') {
    const steps = Array.isArray(raw.steps)
      ? raw.steps
          .map(function (s) {
            return String(s || '')
              .trim()
              .slice(0, 48);
          })
          .filter(Boolean)
          .slice(0, 8)
      : [];
    if (steps.length < 2) return null;
    event.steps = steps;
    event.finalized = true;
    return event;
  }

  if (type === 'land') {
    event.referrerHost = typeof raw.referrerHost === 'string' ? raw.referrerHost.slice(0, 80) : '';
    event.utm = {
      source: raw.utm && typeof raw.utm.source === 'string' ? raw.utm.source.slice(0, 64) : '',
      medium: raw.utm && typeof raw.utm.medium === 'string' ? raw.utm.medium.slice(0, 64) : '',
      campaign: raw.utm && typeof raw.utm.campaign === 'string' ? raw.utm.campaign.slice(0, 64) : ''
    };
    return event;
  }

  if (type === 'outbound') {
    event.dest = typeof raw.dest === 'string' ? raw.dest.slice(0, 32) : 'other';
    event.href = typeof raw.href === 'string' ? raw.href.slice(0, 240) : '';
    return event;
  }

  event.groupKey = typeof raw.groupKey === 'string' ? raw.groupKey.slice(0, 80) : 'unknown';
  event.title = typeof raw.title === 'string' ? raw.title.slice(0, 120) : '';
  event.playbackId = typeof raw.playbackId === 'string' ? raw.playbackId.slice(0, 80) : '';
  event.cut = typeof raw.cut === 'string' ? raw.cut.slice(0, 32) : 'unknown';
  event.seconds = Math.max(0, Math.min(Number(raw.seconds) || 0, 60 * 60));
  event.prevSeconds = Math.max(0, Math.min(Number(raw.prevSeconds) || 0, 60 * 60));
  event.startSeconds = Math.max(0, Math.min(Number(raw.startSeconds) || 0, 60 * 60));
  event.stopSeconds = Math.max(0, Math.min(Number(raw.stopSeconds) || event.seconds || 0, 60 * 60));
  event.duration = Math.max(0, Math.min(Number(raw.duration) || 0, 60 * 60));
  event.completed = !!raw.completed;
  event.listenSeconds = Math.max(0, Math.min(Number(raw.listenSeconds) || 0, 60 * 60));
  if (raw.heatCounts && typeof raw.heatCounts === 'object') {
    const counts = {};
    Object.keys(raw.heatCounts).slice(0, 1200).forEach(function (key) {
      const sec = Math.max(0, Math.min(Math.floor(Number(key) || 0), 20 * 60 - 1));
      const n = Math.max(0, Math.min(Math.floor(Number(raw.heatCounts[key]) || 0), 1000));
      if (n > 0) counts[sec] = (counts[sec] || 0) + n;
    });
    event.heatCounts = counts;
  } else if (Array.isArray(raw.heatPasses)) {
    // Legacy list form — keep duplicates (each entry is one pass).
    event.heatPasses = raw.heatPasses
      .map(function (n) {
        return Math.max(0, Math.min(Math.floor(Number(n) || 0), 20 * 60 - 1));
      })
      .slice(0, 1200);
  }
  return event;
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  if ((event.body || '').length > MAX_BODY) {
    return { statusCode: 413, headers, body: JSON.stringify({ message: 'Payload too large' }) };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON' }) };
  }

  const rawEvents = Array.isArray(body.events) ? body.events : [];
  if (!rawEvents.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'events required' }) };
  }

  const events = rawEvents
    .slice(0, MAX_EVENTS)
    .map(sanitizeEvent)
    .filter(Boolean);

  if (!events.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'no valid events' }) };
  }

  try {
    const store = analyticsStore(event);
    await ingestEvents(store, events);
    return { statusCode: 204, headers, body: '' };
  } catch (error) {
    console.error('site-analytics-ingest:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: error.message || 'ingest failed' })
    };
  }
};
