'use strict';

const { parsePitch, PRODUCT_TITLE } = require('./lib/booking');
const { sendOfferEmail, offerText } = require('./lib/offer-email');

// Pitches with no money offered: nothing to authorize, so they're emailed instead of going to Stripe.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const pitch = parsePitch(JSON.parse(event.body || '{}'));
    if (pitch.error) {
      return { statusCode: 400, body: JSON.stringify({ error: pitch.error }) };
    }

    await sendOfferEmail(`${PRODUCT_TITLE} — pitch from ${pitch.name || pitch.email}`, offerText(pitch), pitch.email);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
