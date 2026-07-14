'use strict';

const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');
const desk = require('./lib/market-desk-store');
const { newsletterStore, appendBlast } = require('./lib/newsletter-stats-store');

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

async function sendPennedEmail(to, subject, bodyText) {
  const from = process.env.NEWSLETTER_FROM || 'burnfolder <nathaniel@burnfolder.com>';
  const resendKey = process.env.RESEND_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!resendKey && !sendgridKey) {
    throw new Error('email not configured — set RESEND_API_KEY or SENDGRID_API_KEY');
  }

  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + resendKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: from,
        to: [to],
        subject: subject,
        text: bodyText
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error('resend failed: ' + (err || res.status));
    }
    return;
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + sendgridKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: 'nathaniel@burnfolder.com', name: 'burnfolder' },
      subject: subject,
      content: [{ type: 'text/plain', value: bodyText }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('sendgrid failed: ' + (err || res.status));
  }
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const access = await requireWorkspaceAccess(event, {
    requireWrite: event.httpMethod === 'POST'
  });
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  const workspaceId = access.workspaceId || 'legacy';
  let blobStore;
  try {
    blobStore = desk.store(event);
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'store failed' }) };
  }

  if (event.httpMethod === 'GET') {
    const queue = await desk.readQueue(blobStore, workspaceId);
    const scrubbed = desk.scrubQueueItems(queue.items);
    if (scrubbed.changed) {
      await desk.writeQueue(blobStore, workspaceId, scrubbed.items);
    }
    const visible = scrubbed.items.filter(function (item) {
      return (
        item.status !== 'cancelled' &&
        item.status !== 'sent' &&
        item.status !== 'done' &&
        desk.passesScrutiny(item)
      );
    });
    const audiences = await desk.audienceSummary(blobStore, workspaceId, event);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        queue: visible,
        audiences: audiences
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
  }

  const action = String(body.action || '').trim();

  if (action === 'queue') {
    const actions = Array.isArray(body.actions) ? body.actions : body.item ? [body.item] : [];
    if (!actions.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'actions required' }) };
    }
    const added = await desk.addQueueItems(blobStore, workspaceId, actions);
    if (!added.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: 'no actions passed scrutiny — need a concrete titled move'
        })
      };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, added: added }) };
  }

  if (action === 'update') {
    const id = String(body.id || '');
    if (!id) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'id required' }) };
    }
    const patch = {};
    if (typeof body.subject === 'string') patch.subject = body.subject;
    if (typeof body.body === 'string') patch.body = body.body;
    if (typeof body.shareHint === 'string') patch.shareHint = body.shareHint;
    if (typeof body.status === 'string') patch.status = body.status;
    if (body.audience && typeof body.audience === 'object') patch.audience = body.audience;
    const updated = await desk.updateQueueItem(blobStore, workspaceId, id, patch);
    if (!updated) {
      return { statusCode: 404, headers, body: JSON.stringify({ message: 'not found' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, item: updated }) };
  }

  if (action === 'cancel') {
    const id = String(body.id || '');
    const updated = await desk.updateQueueItem(blobStore, workspaceId, id, { status: 'cancelled' });
    if (!updated) {
      return { statusCode: 404, headers, body: JSON.stringify({ message: 'not found' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, item: updated }) };
  }

  if (action === 'send') {
    const id = String(body.id || '');
    const queue = await desk.readQueue(blobStore, workspaceId);
    const item = queue.items.find(function (row) {
      return row.id === id;
    });
    if (!item) {
      return { statusCode: 404, headers, body: JSON.stringify({ message: 'not found' }) };
    }
    if (!desk.isEmailableAction(item)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: 'this is a studio task — mark it done instead of sending email'
        })
      };
    }
    const subject = String(item.subject || '').trim();
    const bodyText = String(item.body || '').trim();
    if (!subject || !bodyText) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: 'pen subject and body first — AI never sends generation to fans'
        })
      };
    }

    const resolved = await desk.resolveAudience(blobStore, workspaceId, item.audience, event);
    if (!resolved.emails.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message:
            'no addressable emails for this audience yet (' +
            (resolved.note || 'empty') +
            '). anonymous plays cannot be emailed.'
        })
      };
    }

    let sent = 0;
    let failed = 0;
    for (let i = 0; i < resolved.emails.length; i++) {
      try {
        await sendPennedEmail(resolved.emails[i], subject, bodyText);
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error('market-desk send failed', resolved.emails[i], err.message);
      }
    }

    try {
      const newsStore = newsletterStore(event);
      await appendBlast(newsStore, {
        kind: 'loyalty',
        campaign: item.move || 'loyalty',
        entry: item.cohortLabel || item.title || '',
        sent: sent,
        failed: failed,
        at: new Date().toISOString()
      });
    } catch (err) {
      console.error('blast log failed', err.message);
    }

    const updated = await desk.updateQueueItem(blobStore, workspaceId, id, {
      status: 'sent',
      sentAt: new Date().toISOString(),
      sentCount: sent
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        item: updated,
        sent: sent,
        failed: failed,
        audienceNote: resolved.note
      })
    };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ message: 'unknown action' }) };
};
