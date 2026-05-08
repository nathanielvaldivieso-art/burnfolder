const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async function(event) {
  try {
    const { amount } = JSON.parse(event.body || '{}');
    const allowedAmounts = [1, 2, 3];

    if (!allowedAmounts.includes(Number(amount))) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid tip amount.' })
      };
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Support Tip' },
            unit_amount: Number(amount) * 100
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: 'https://burnfolder.com/success.html?type=tip',
      cancel_url: 'https://burnfolder.com/cancel.html?type=tip',
      payment_intent_data: {
        description: `burnfolder.com support tip ($${Number(amount)})`,
        metadata: {
          order_type: 'tip',
          requires_shipping: 'false',
          tip_amount: String(Number(amount))
        }
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ id: session.id })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};