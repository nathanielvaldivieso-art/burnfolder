const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Shippo = require('shippo');
const shippo = Shippo(process.env.SHIPPO_API_KEY);

// Your return address
const FROM_ADDRESS = {
  name: 'burnfolder.com',
  street1: '652 E 187th St',
  city: 'Bronx',
  state: 'NY',
  zip: '10458',
  country: 'US',
  phone: '',
  email: process.env.OWNER_EMAIL || ''
};

// TIN CAN parcel dimensions
const PARCEL = {
  length: '6',
  width: '3',
  height: '3',
  distance_unit: 'in',
  weight: '1',
  mass_unit: 'lb'
};

exports.handler = async function(event) {
  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Handle successful payment
  if (stripeEvent.type === 'payment_intent.succeeded') {
    const pi = stripeEvent.data.object;
    const meta = pi.metadata || {};
    const requiresShipping = String(meta.requires_shipping || '').toLowerCase() === 'true';
    const orderType = meta.order_type || 'shop';

    if (!requiresShipping || orderType === 'tip' || orderType === 'digital_album') {
      console.log('Skipping Shippo label for non-shippable payment:', pi.id, orderType);
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, skipped_shipping: true })
      };
    }

    const shippingInfo = pi.shipping || {};
    const addr = shippingInfo.address || {};

    const toAddress = {
      name: meta.customer_name || shippingInfo.name || 'Customer',
      street1: meta.address_line1 || addr.line1 || '',
      street2: meta.address_line2 || addr.line2 || '',
      city: meta.city || addr.city || '',
      state: meta.state || addr.state || '',
      zip: meta.zip || addr.postal_code || '',
      country: 'US',
      email: meta.customer_email || ''
    };

    console.log('Creating Shippo shipment for:', toAddress.name, toAddress.street1, toAddress.city, toAddress.state, toAddress.zip);

    try {
      // 1. Create shipment and get rates
      const shipment = await shippo.shipment.create({
        address_from: FROM_ADDRESS,
        address_to: toAddress,
        parcels: [PARCEL],
        async: false
      });

      if (!shipment.rates || shipment.rates.length === 0) {
        console.error('No shipping rates returned by Shippo');
        return { statusCode: 200, body: JSON.stringify({ error: 'No rates available' }) };
      }

      // 2. Find cheapest USPS rate
      const uspsRates = shipment.rates.filter(r => r.provider === 'USPS');
      const rates = uspsRates.length > 0 ? uspsRates : shipment.rates;
      rates.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));
      const chosenRate = rates[0];

      console.log(`Purchasing label: ${chosenRate.provider} ${chosenRate.servicelevel.name} - $${chosenRate.amount}`);

      // 3. Purchase the label
      const transaction = await shippo.transaction.create({
        rate: chosenRate.object_id,
        label_file_type: 'PDF',
        async: false
      });

      if (transaction.status === 'SUCCESS') {
        console.log('Label purchased successfully!');
        console.log('Label URL:', transaction.label_url);
        console.log('Tracking #:', transaction.tracking_number);
        console.log('Tracking URL:', transaction.tracking_url_provider);

        // 4. Add tracking to Stripe PaymentIntent for your records
        await stripe.paymentIntents.update(pi.id, {
          metadata: {
            ...meta,
            tracking_number: transaction.tracking_number,
            tracking_url: transaction.tracking_url_provider,
            label_url: transaction.label_url,
            shipping_cost: chosenRate.amount,
            carrier: chosenRate.provider,
            service: chosenRate.servicelevel.name
          }
        });

        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            label_url: transaction.label_url,
            tracking_number: transaction.tracking_number,
            tracking_url: transaction.tracking_url_provider
          })
        };
      } else {
        console.error('Label purchase failed:', JSON.stringify(transaction.messages));
        return {
          statusCode: 200,
          body: JSON.stringify({ error: 'Label creation failed', messages: transaction.messages })
        };
      }
    } catch (err) {
      console.error('Shippo error:', err.message);
      return { statusCode: 200, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 200, body: 'Event received.' };
};
