const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');
const { newsletterStore, appendBlast } = require('./lib/newsletter-stats-store');
const { connectLambda, getStore } = require('@netlify/blobs');

const STORE_NAME = 'burnfolder-newsletter';
const LIST_KEY = 'subscriber-emails';
const FROM_EMAIL = 'nathaniel@burnfolder.com';
const FROM_NAME = 'burnfolder';

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return null;
  }
}

function textToHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split(/\n\n+/)
    .map(function (p) {
      return '<p>' + p.trim().replace(/\n/g, '<br>') + '</p>';
    })
    .join('\n');
}

async function getSubscribers(event) {
  connectLambda(event);
  const store = getStore(STORE_NAME);
  const list = await store.get(LIST_KEY, { type: 'json' });
  const subscribers = Array.isArray(list) ? list : [];
  return subscribers.filter(function (email) {
    return typeof email === 'string' && email.indexOf('@') > -1;
  });
}

async function sendWithSendGrid(apiKey, subscribers, subject, text, html) {
  const personalizations = subscribers.map(function (email) {
    return { to: [{ email: email }] };
  });

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: personalizations,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject: subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html }
      ]
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(function () {
      return 'sendgrid error';
    });
    throw new Error('SendGrid ' + res.status + ': ' + detail);
  }
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const access = await requireWorkspaceAccess(event, { requirePublish: true });
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  if (event.httpMethod === 'GET') {
    const subscribers = await getSubscribers(event);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        count: subscribers.length,
        subscribers: subscribers
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const body = parseBody(event);
  if (!body) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
  }

  const subject = String(body.subject || '').trim();
  const text = String(body.text || '').trim();
  if (!subject || !text) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'subject and text required' }) };
  }

  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, headers, body: JSON.stringify({ message: 'SendGrid API key not configured' }) };
  }

  const subscribers = await getSubscribers(event);
  if (!subscribers.length) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, sent: 0, message: 'no subscribers to send' })
    };
  }

  const html = typeof body.html === 'string' ? body.html : textToHtml(text);
  await sendWithSendGrid(apiKey, subscribers, subject, text, html);

  const store = newsletterStore(event);
  const row = await appendBlast(store, {
    kind: 'blast',
    campaign: 'photonegative',
    sent: subscribers.length,
    failed: 0,
    at: new Date().toISOString()
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      sent: subscribers.length,
      blast: row
    })
  };
};
