const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async function(event) {
  try {
    const { amount, email } = JSON.parse(event.body || '{}');
    const numericAmount = Number(amount);
    const allowedAmounts = [1, 2, 3];

    if (!allowedAmounts.includes(numericAmount)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid tip amount.' })
      };
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: numericAmount * 100,
      currency: 'usd',
      payment_method_types: ['card'],
      description: `burnfolder.com support tip ($${numericAmount})`,
      metadata: {
        order_type: 'tip',
        requires_shipping: 'false',
        tip_amount: String(numericAmount),
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