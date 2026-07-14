'use strict';

const { newsletterStore, appendBlast } = require('./lib/newsletter-stats-store');

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!process.env.SUBSCRIBERS_EXPORT_SECRET || token !== process.env.SUBSCRIBERS_EXPORT_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ message: 'Unauthorized' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const kind = typeof body.kind === 'string' ? body.kind.trim() : 'entry';
    const entry = typeof body.entry === 'string' ? body.entry.trim() : '';
    const campaign =
      typeof body.campaign === 'string' && body.campaign.trim()
        ? body.campaign.trim()
        : kind === 'welcome'
          ? 'welcome'
          : entry
            ? 'entry-' + entry
            : 'newsletter';
    const sent = Math.max(0, Math.round(Number(body.sent) || 0));
    const failed = Math.max(0, Math.round(Number(body.failed) || 0));

    if (sent === 0 && failed === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'sent or failed required' })
      };
    }

    const store = newsletterStore(event);
    const row = await appendBlast(store, {
      kind: kind,
      campaign: campaign,
      entry: entry || null,
      sent: sent,
      failed: failed,
      at: typeof body.at === 'string' ? body.at : new Date().toISOString()
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, blast: row })
    };
  } catch (error) {
    console.error('record-newsletter-send:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: error.message || 'record failed' })
    };
  }
};
