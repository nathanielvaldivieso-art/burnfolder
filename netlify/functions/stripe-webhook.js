const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const shippo = require('shippo')(process.env.SHIPPO_API_KEY);

// Your from address and parcel info
const fromAddress = {
  name: 'burnfolder.com',
  street1: '652 E 187th St',
  city: 'Bronx',
  state: 'NY',
  zip: '10458',
  country: 'US',
  phone: '',
  email: ''
};
const parcel = {
  length: 10,
  width: 10,
  height: 10,
  distance_unit: 'in',
  weight: 1,
  mass_unit: 'lb'
};

exports.handler = async function(event, context) {
  // Stripe requires the raw body to validate the webhook signature
  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    // Extract shipping address from session
    const shipping = session.shipping_details;
    if (!shipping) {
      return { statusCode: 400, body: 'No shipping details found.' };
    }
    const toAddress = {
      name: shipping.name,
      street1: shipping.address.line1,
      city: shipping.address.city,
      state: shipping.address.state,
      zip: shipping.address.postal_code,
      country: shipping.address.country,
      phone: '',
      email: session.customer_details ? session.customer_details.email : ''
    };
    // Create Shippo shipment
    try {
      const shipment = await shippo.shipment.create({
        address_from: fromAddress,
        address_to: toAddress,
        parcels: [parcel],
        async: false
      });
      // Optionally, you can purchase a label here or return shipment info
      return {
        statusCode: 200,
        body: JSON.stringify({ shipment })
      };
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: err.message })
      };
    }
  }
  return { statusCode: 200, body: 'Event received.' };
};
