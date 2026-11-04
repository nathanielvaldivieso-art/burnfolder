const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { parseBooking, PRODUCT_TITLE } = require('./lib/booking');

function getBaseUrl(event) {
  const headers = event.headers || {};
  const origin = headers.origin;
  if (origin && /^https?:\/\//i.test(origin)) {
    return origin.replace(/\/$/, '');
  }

  const host = headers['x-forwarded-host'] || headers.host;
  const proto = headers['x-forwarded-proto'] || 'https';
  if (host) {
    return `${proto}://${host}`;
  }

  return 'https://burnfolder.com';
}

// Offers are authorized only (manual capture); accept = Capture, decline = Cancel in the Stripe dashboard.
exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const booking = parseBooking(body);
    if (booking.error) {
      return { statusCode: 400, body: JSON.stringify({ error: booking.error }) };
    }

    const baseUrl = getBaseUrl(event);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: `${PRODUCT_TITLE} (offer)` },
            unit_amount: booking.amountCents
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      customer_email: booking.email || undefined,
      success_url: `${baseUrl}/success.html?type=offer&amount=${encodeURIComponent(booking.amount)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/shop.html`,
      payment_intent_data: {
        capture_method: 'manual',
        description: booking.label,
        metadata: booking.metadata
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ id: session.id, url: session.url || '' })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
