const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { parseBooking } = require('./lib/booking');

// Offers are authorized only (manual capture); accept = Capture, decline = Cancel in the Stripe dashboard.
exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const booking = parseBooking(body);
    if (booking.error) {
      return { statusCode: 400, body: JSON.stringify({ error: booking.error }) };
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: booking.amountCents,
      currency: 'usd',
      capture_method: 'manual',
      automatic_payment_methods: { enabled: true },
      description: booking.label,
      metadata: booking.metadata,
      receipt_email: booking.email || undefined
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
