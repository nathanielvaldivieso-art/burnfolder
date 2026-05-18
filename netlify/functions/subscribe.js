const { connectLambda, getStore } = require('@netlify/blobs');

const STORE_NAME = 'burnfolder-newsletter';
const LIST_KEY = 'subscriber-emails';

async function readEmails(store) {
  const data = await store.get(LIST_KEY, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

async function writeEmails(store, emails) {
  await store.setJSON(LIST_KEY, emails);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  try {
    connectLambda(event);
    const store = getStore(STORE_NAME);

    const body = JSON.parse(event.body || '{}');
    const rawEmail = typeof body.email === 'string' ? body.email : '';
    const email = normalizeEmail(rawEmail);

    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid email' }) };
    }

    let emails = await readEmails(store);

    if (emails.length === 0 && process.env.SUBSCRIBER_SEED_EMAILS) {
      const seeded = process.env.SUBSCRIBER_SEED_EMAILS.split(/[,;\s]+/)
        .map((s) => normalizeEmail(s))
        .filter((e) => e.includes('@'));
      if (seeded.length) {
        emails = [...new Set(seeded)];
        await writeEmails(store, emails);
      }
    }

    const alreadySubscribed = emails.some((e) => normalizeEmail(e) === email);

    if (!alreadySubscribed) {
      emails.push(rawEmail.trim());
      await writeEmails(store, emails);
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const owner = 'nathanielvaldivieso-art';
    const repo = 'burnfolder';
    const ghHeaders = {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };

    const dispatchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        event_type: 'send_welcome_email',
        client_payload: { email: rawEmail.trim() },
      }),
    });

    if (!dispatchRes.ok) {
      const dispatchBody = await dispatchRes.text();
      console.error('Welcome email dispatch failed:', dispatchRes.status, dispatchBody);
      return {
        statusCode: 202,
        headers,
        body: JSON.stringify({
          message: alreadySubscribed
            ? 'Already subscribed, but welcome email resend failed. Please check GitHub token scopes and workflow setup.'
            : 'Subscribed, but welcome email dispatch failed. Please check GitHub token scopes and workflow setup.',
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: alreadySubscribed ? 'Already subscribed - welcome email resent' : 'Subscribed successfully',
      }),
    };
  } catch (error) {
    console.error('Subscribe error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Server error', error: error.message }) };
  }
};
