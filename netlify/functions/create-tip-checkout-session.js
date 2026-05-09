const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

exports.handler = async function(event) {
  try {
    const { amount } = JSON.parse(event.body || '{}');
    const numericAmount = Number(amount);
    const roundedAmount = Math.round(numericAmount * 100) / 100;

    if (!Number.isFinite(roundedAmount) || roundedAmount < 1 || roundedAmount > 500) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Tip amount must be between $1 and $500.' })
      };
    }

    const baseUrl = getBaseUrl(event);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Support Tip' },
            unit_amount: Math.round(roundedAmount * 100)
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${baseUrl}/success.html?type=tip`,
      cancel_url: `${baseUrl}/cancel.html?type=tip`,
      payment_intent_data: {
        description: `burnfolder.com support tip ($${roundedAmount})`,
        metadata: {
          order_type: 'tip',
          requires_shipping: 'false',
          tip_amount: String(roundedAmount)
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