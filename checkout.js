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

// Stripe integration
const form = document.getElementById('checkout-form');
const stripe = Stripe('pk_live_51TJGQcBKbG6lpNutrYNDhGV6aFM66hoqLakruHGC4omCXn0Nc9fXAqGzpqRIpq97v6tGP67Vx3vd1vpZbK1YkSks00ZFMq7fjN');
form.addEventListener('submit', function(e) {
  e.preventDefault();
  document.getElementById('checkout-status').textContent = 'Redirecting to Stripe...';
  fetch('/.netlify/functions/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cart: getCart() })
  })
    .then(res => res.json())
    .then(data => {
      if (data.id) {
        stripe.redirectToCheckout({ sessionId: data.id });
      } else {
        document.getElementById('checkout-status').textContent = 'Error: ' + (data.error || 'Could not create session.');
      }
    })
    .catch(err => {
      document.getElementById('checkout-status').textContent = 'Error: ' + err.message;
    });
});
