const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async function(event) {
  try {
    const { amount, email } = JSON.parse(event.body || '{}');
    const numericAmount = Number(amount);
    const roundedAmount = Math.round(numericAmount * 100) / 100;

    if (!Number.isFinite(roundedAmount) || roundedAmount < 1 || roundedAmount > 500) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Tip amount must be between $1 and $500.' })
      };
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(roundedAmount * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      description: `burnfolder.com support tip ($${roundedAmount})`,
      metadata: {
        order_type: 'tip',
        requires_shipping: 'false',
        tip_amount: String(roundedAmount),
        customer_email: email || ''
      },
      receipt_email: email || undefined
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};