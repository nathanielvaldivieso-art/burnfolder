'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { PRODUCT_TITLE } = require('./lib/booking');
const { sendOfferEmail, offerText } = require('./lib/offer-email');

function joinChunks(meta, key) {
  let out = '';
  for (let i = 1; meta[`${key}_${i}`] != null; i += 1) out += meta[`${key}_${i}`];
  return out;
}

async function resolvePaymentIntentId(body) {
  if (typeof body.paymentIntentId === 'string' && body.paymentIntentId) return body.paymentIntentId;
  if (typeof body.sessionId === 'string' && body.sessionId) {
    const session = await stripe.checkout.sessions.retrieve(body.sessionId);
    const pi = session.payment_intent;
    return typeof pi === 'string' ? pi : (pi && pi.id) || '';
  }
  return '';
}

// Emails an authorized offer once. Everything is read back from Stripe, so the client only supplies an id.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const piId = await resolvePaymentIntentId(JSON.parse(event.body || '{}'));
    if (!/^pi_/.test(piId)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing payment.' }) };
    }

    const pi = await stripe.paymentIntents.retrieve(piId);
    const meta = pi.metadata || {};
    if (meta.order_type !== 'offer' || pi.status !== 'requires_capture') {
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
    }
    if (meta.offer_emailed === 'true') {
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // Claim before sending so a repeat call doesn't double-send; release if the send fails.
    await stripe.paymentIntents.update(pi.id, { metadata: { offer_emailed: 'true' } });

    const amount = (pi.amount / 100).toFixed(2).replace(/\.00$/, '');
    const text =
      offerText({
        name: meta.customer_name,
        email: meta.customer_email,
        amount,
        pitch: joinChunks(meta, 'pitch'),
        links: joinChunks(meta, 'links')
      }) + `\n\nhttps://dashboard.stripe.com${pi.livemode ? '' : '/test'}/payments/${pi.id}`;

    try {
      await sendOfferEmail(
        `${PRODUCT_TITLE} — $${amount} offer from ${meta.customer_name || meta.customer_email || 'someone'}`,
        text,
        meta.customer_email
      );
    } catch (err) {
      await stripe.paymentIntents.update(pi.id, { metadata: { offer_emailed: '' } });
      throw err;
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
