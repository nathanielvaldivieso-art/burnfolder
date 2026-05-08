const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async function(event, context) {
  try {
    const { cart, shipping } = JSON.parse(event.body);
    const requiresShipping = cart.some(item => item.requiresShipping !== 'false' && item.requiresShipping !== false);
    // Calculate total amount in cents
    let amount = 0;
    cart.forEach(item => {
      amount += item.price * 100 * item.qty;
    });
    // Store shipping info in metadata so the webhook can create a Shippo label
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      payment_method_types: ['card'],
      description: 'burnfolder.com shop purchase',
      metadata: {
        order_type: 'shop',
        requires_shipping: String(requiresShipping),
        customer_name: shipping.name,
        customer_email: shipping.email,
        address_line1: shipping.address_line1,
        address_line2: shipping.address_line2 || '',
        city: shipping.city,
        state: shipping.state,
        zip: shipping.zip,
        items: cart.map(i => i.name).join(', ')
      },
      receipt_email: shipping.email,
      shipping: {
        name: shipping.name,
        address: {
          line1: shipping.address_line1,
          line2: shipping.address_line2 || '',
          city: shipping.city,
          state: shipping.state,
          postal_code: shipping.zip,
          country: 'US'
        }
      }
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
