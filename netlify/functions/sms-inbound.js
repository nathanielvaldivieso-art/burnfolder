const { connectLambda } = require('@netlify/blobs');
const { getNewsletterStore, addPhone, removePhone } = require('./lib/sms-subscribers');

function parseFormBody(raw) {
  const params = new URLSearchParams(raw || '');
  const out = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}

function twiml(message) {
  const escaped = String(message)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

function keywordOf(body) {
  return String(body || '')
    .trim()
    .split(/\s+/)[0]
    .toUpperCase();
}

exports.handler = async (event) => {
  const xmlHeaders = {
    'Content-Type': 'text/xml; charset=utf-8',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: xmlHeaders, body: twiml('method not allowed') };
  }

  try {
    connectLambda(event);
    const store = getNewsletterStore();
    const form = parseFormBody(event.body);
    const from = form.From || '';
    const keyword = keywordOf(form.Body);

    // Twilio auto-handles STOP at the carrier level; mirror our list on explicit opt-out.
    if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(keyword)) {
      await removePhone(store, from);
      return {
        statusCode: 200,
        headers: xmlHeaders,
        body: twiml('burnfolder — you are off the list. text JOIN anytime.'),
      };
    }

    if (['HELP', 'INFO'].includes(keyword)) {
      return {
        statusCode: 200,
        headers: xmlHeaders,
        body: twiml('burnfolder texts when a new entry goes live. reply STOP to leave. burnfolder.com'),
      };
    }

    if (['JOIN', 'START', 'YES', 'SUBSCRIBE', 'UNSTOP'].includes(keyword)) {
      const { alreadySubscribed } = await addPhone(store, from);
      const msg = alreadySubscribed
        ? 'burnfolder — you are already on the list. new entries land here.'
        : 'burnfolder — you are on the text list. new entries land here. reply STOP to leave.';
      return { statusCode: 200, headers: xmlHeaders, body: twiml(msg) };
    }

    return {
      statusCode: 200,
      headers: xmlHeaders,
      body: twiml('burnfolder — text JOIN to get new entries. STOP to leave. HELP for info.'),
    };
  } catch (error) {
    console.error('sms-inbound:', error);
    return {
      statusCode: 200,
      headers: xmlHeaders,
      body: twiml('burnfolder — something broke. try again later.'),
    };
  }
};
