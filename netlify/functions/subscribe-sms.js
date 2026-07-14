const { connectLambda } = require('@netlify/blobs');
const { getNewsletterStore, addPhone } = require('./lib/sms-subscribers');

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
    const store = getNewsletterStore();

    const body = JSON.parse(event.body || '{}');
    const rawPhone = typeof body.phone === 'string' ? body.phone : '';
    const { phone, alreadySubscribed } = await addPhone(store, rawPhone);

    if (!phone) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'invalid phone — use a 10-digit us number' }),
      };
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    if (!GITHUB_TOKEN) {
      return {
        statusCode: 202,
        headers,
        body: JSON.stringify({
          message: alreadySubscribed
            ? 'already on the list, but welcome text needs GITHUB_TOKEN on netlify'
            : 'subscribed, but welcome text needs GITHUB_TOKEN on netlify',
        }),
      };
    }

    const owner = 'nathanielvaldivieso-art';
    const repo = 'burnfolder';
    const dispatchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: 'send_welcome_sms',
        client_payload: { phone },
      }),
    });

    if (!dispatchRes.ok) {
      const dispatchBody = await dispatchRes.text();
      console.error('Welcome SMS dispatch failed:', dispatchRes.status, dispatchBody);
      return {
        statusCode: 202,
        headers,
        body: JSON.stringify({
          message: alreadySubscribed
            ? 'already on the list, but welcome text dispatch failed'
            : 'subscribed, but welcome text dispatch failed',
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: alreadySubscribed ? 'already on the list — welcome text resent' : 'subscribed — check your texts',
      }),
    };
  } catch (error) {
    console.error('Subscribe SMS error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'server error', error: error.message }) };
  }
};
