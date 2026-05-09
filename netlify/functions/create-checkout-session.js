
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

exports.handler = async function(event, context) {
  try {
    const { cart } = JSON.parse(event.body || '{}');
    if (!Array.isArray(cart) || cart.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Cart is empty.' })
      };
    }

    const lineItems = cart.map((item) => {
      const unitAmount = Math.round(Number(item.price) * 100);
      const quantity = Math.max(1, Math.floor(Number(item.qty) || 1));

      if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
        throw new Error('Invalid cart item amount.');
      }

      return {
        price_data: {
          currency: 'usd',
          product_data: {
            name: String(item.name || 'Burnfolder Item').slice(0, 120)
          },
          unit_amount: unitAmount
        },
        quantity
      };
    });

    const baseUrl = getBaseUrl(event);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${baseUrl}/success.html`,
      cancel_url: `${baseUrl}/cancel.html`,
      shipping_address_collection: { allowed_countries: ['US'] },
      payment_intent_data: {
        description: 'burnfolder.com shop purchase',
        metadata: {
          order_type: 'shop',
          requires_shipping: 'true',
          items: cart.map((i) => String(i.name || 'item')).join(', ')
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
