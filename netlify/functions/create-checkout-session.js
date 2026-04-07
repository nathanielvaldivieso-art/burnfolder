
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const shippo = require('shippo')(process.env.SHIPPO_API_KEY);

exports.handler = async function(event, context) {
  try {
    const { cart } = JSON.parse(event.body);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: cart.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: { name: item.name },
          unit_amount: item.price * 100, // $500 -> 50000 cents
        },
        quantity: item.qty,
      })),
      mode: 'payment',
      success_url: 'https://burnfolder.com/success',
      cancel_url: 'https://burnfolder.com/cancel',
      shipping_address_collection: { allowed_countries: ['US'] }
    });

    // --- Shippo integration setup (label creation should be triggered after payment confirmation) ---
    // FROM address (your info)
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
    // TO address placeholder (replace with real customer address after payment)
    const toAddress = {
      name: 'Customer',
      street1: 'CUSTOMER_STREET',
      city: 'CUSTOMER_CITY',
      state: 'CUSTOMER_STATE',
      zip: 'CUSTOMER_ZIP',
      country: 'US',
      phone: '',
      email: ''
    };
    // TIN CAN package info
    const parcel = {
      length: 10,
      width: 10,
      height: 10,
      distance_unit: 'in',
      weight: 1,
      mass_unit: 'lb'
    };
    // Example: create shipment (uncomment and use after payment confirmation)
    // const shipment = await shippo.shipment.create({
    //   address_from: fromAddress,
    //   address_to: toAddress,
    //   parcels: [parcel],
    //   async: false
    // });
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
