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

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const numericAmount = Number(body.amount);
    const roundedAmount = Math.round(numericAmount * 100) / 100;
    const productId = String(body.productId || '').trim();
    const productTitle = String(body.productTitle || 'Digital album').trim() || 'Digital album';
    const minAmount = Math.max(1, Number(body.minAmount) || 1);
    const maxAmount = Math.min(500, Math.max(minAmount, Number(body.maxAmount) || 500));

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

    const baseUrl = getBaseUrl(event);
    const successQs =
      'type=digital&product=' + encodeURIComponent(productId);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: productTitle },
            unit_amount: Math.round(roundedAmount * 100)
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${baseUrl}/success.html?${successQs}`,
      cancel_url: `${baseUrl}/cancel.html?type=digital`,
      payment_intent_data: {
        description: `${productTitle} ($${roundedAmount})`,
        metadata: {
          order_type: 'digital_album',
          requires_shipping: 'false',
          product_id: productId,
          product_title: productTitle,
          amount: String(roundedAmount)
        }
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ id: session.id, url: session.url || '' })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
