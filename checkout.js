// checkout.js - Handles checkout logic for burnfolder.com

function getCart() {
  return JSON.parse(localStorage.getItem('cart') || '[]');
}

function renderCheckout() {
  const cart = getCart();
  const itemsDiv = document.getElementById('checkout-items');
  const totalDiv = document.getElementById('checkout-total');
  let total = 0;
  itemsDiv.innerHTML = '';
  if (cart.length === 0) {
    itemsDiv.textContent = 'Your cart is empty.';
    totalDiv.textContent = '';
    document.querySelector('button[type="submit"]').disabled = true;
    return;
  }
  cart.forEach(item => {
    total += item.price * item.qty;
    const div = document.createElement('div');
    div.className = 'checkout-item';
    div.innerHTML = `<img src="${item.image}" alt="${item.name}" style="width:40px;vertical-align:middle;"> ${item.name} x${item.qty} - $${item.price * item.qty}`;
    itemsDiv.appendChild(div);
  });
  totalDiv.textContent = `Total: $${total}`;
}

window.addEventListener('DOMContentLoaded', renderCheckout);

// Stripe Elements integration
const form = document.getElementById('checkout-form');
const stripe = Stripe('pk_live_51TJGQcBKbG6lpNutrYNDhGV6aFM66hoqLakruHGC4omCXn0Nc9fXAqGzpqRIpq97v6tGP67Vx3vd1vpZbK1YkSks00ZFMq7fjN');
const elements = stripe.elements();
const card = elements.create('card', {
  style: {
    base: {
      fontFamily: 'monospace',
      fontSize: '1em',
      color: '#000',
      '::placeholder': { color: '#888' },
      iconColor: '#000',
    },
    invalid: { color: '#c00' }
  }
});
card.mount('#card-element');

form.addEventListener('submit', function(e) {
  e.preventDefault();
  const statusEl = document.getElementById('checkout-status');
  const errorsEl = document.getElementById('card-errors');
  statusEl.textContent = 'Processing payment...';
  errorsEl.textContent = '';

  const shipping = {
    name: form.name.value,
    email: form.email.value,
    address_line1: form.address_line1.value,
    address_line2: form.address_line2.value || '',
    city: form.city.value,
    state: form.state.value,
    zip: form.zip.value
  };

  fetch('/.netlify/functions/create-payment-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cart: getCart(), shipping })
  })
    .then(res => res.json())
    .then(async data => {
      if (data.clientSecret) {
        const result = await stripe.confirmCardPayment(data.clientSecret, {
          payment_method: {
            card: card,
            billing_details: {
              name: shipping.name,
              email: shipping.email,
            }
          },
          shipping: {
            name: shipping.name,
            address: {
              line1: shipping.address_line1,
              line2: shipping.address_line2,
              city: shipping.city,
              state: shipping.state,
              postal_code: shipping.zip,
              country: 'US'
            }
          }
        });
        if (result.error) {
          errorsEl.textContent = result.error.message;
          statusEl.textContent = '';
        } else if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
          localStorage.removeItem('cart');
          window.location.href = 'success.html';
        }
      } else {
        statusEl.textContent = 'Error: ' + (data.error || 'Could not create payment.');
      }
    })
    .catch(err => {
      statusEl.textContent = 'Error: ' + err.message;
    });
});
