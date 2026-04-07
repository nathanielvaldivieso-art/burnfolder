// cart.js - Handles cart logic for burnfolder.com

function getCart() {
  return JSON.parse(localStorage.getItem('cart') || '[]');
}

function setCart(cart) {
  localStorage.setItem('cart', JSON.stringify(cart));
}

function renderCart() {
  const cart = getCart();
  const cartItemsDiv = document.getElementById('cart-items');
  const cartTotalDiv = document.getElementById('cart-total');
  const checkoutBtn = document.getElementById('checkout-btn');
  const emptyMsg = document.getElementById('empty-cart-msg');
  cartItemsDiv.innerHTML = '';
  let total = 0;
  if (cart.length === 0) {
    cartTotalDiv.textContent = '';
    checkoutBtn.style.display = 'none';
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';
  checkoutBtn.style.display = 'inline-block';
  cart.forEach((item, idx) => {
    total += item.price * item.qty;
    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `
      <img src="${item.image}" alt="${item.name}" style="width:60px;vertical-align:middle;"> 
      <span>${item.name}</span> 
      <span>$${item.price}</span> 
      <span>Qty: ${item.qty}</span>
      <button onclick="removeFromCart(${idx})">Remove</button>
    `;
    cartItemsDiv.appendChild(div);
  });
  cartTotalDiv.textContent = `Total: $${total}`;
}

function removeFromCart(idx) {
  const cart = getCart();
  cart.splice(idx, 1);
  setCart(cart);
  renderCart();
}

window.addEventListener('DOMContentLoaded', renderCart);
