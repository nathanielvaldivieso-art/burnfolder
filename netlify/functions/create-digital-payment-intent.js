const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const numericAmount = Number(body.amount);
    const roundedAmount = Math.round(numericAmount * 100) / 100;
    const productId = String(body.productId || '').trim();
    const productTitle = String(body.productTitle || 'Digital album').trim() || 'Digital album';
    const minAmount = Math.max(1, Number(body.minAmount) || 1);
    const maxAmount = Math.min(500, Math.max(minAmount, Number(body.maxAmount) || 500));
    const email = body.email ? String(body.email).trim() : '';

    if (!productId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing product.' })
      };
    }

    if (!Number.isFinite(roundedAmount) || roundedAmount < minAmount || roundedAmount > maxAmount) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: `Amount must be between $${minAmount} and $${maxAmount}.`
        })
      };
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(roundedAmount * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      description: `${productTitle} ($${roundedAmount})`,
      metadata: {
        order_type: 'digital_album',
        requires_shipping: 'false',
        product_id: productId,
        product_title: productTitle,
        amount: String(roundedAmount),
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
