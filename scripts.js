// Dark mode functionality
function initializeDarkMode() {
  const themeToggle = document.getElementById('themeToggle');
  const body = document.body;

  if (themeToggle) {
    // Check for saved theme preference or default to light mode
    const currentTheme = localStorage.getItem('theme') || 'light';
    if (currentTheme === 'dark') {
      body.classList.add('dark-mode');
    }

    themeToggle.addEventListener('click', () => {
      body.classList.toggle('dark-mode');
      const theme = body.classList.contains('dark-mode') ? 'dark' : 'light';
      localStorage.setItem('theme', theme);
    });
  }
}

// Initialize dark mode when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeDarkMode);

// --- Spotify-like Streaming Service Audio Logic ---
// Load allSongs from songs.js (must be included in HTML before scripts.js)
let allSongs = window.allSongs || [];

// Determine which songs to show on this page
const pathParts = window.location.pathname.split('/');
const fileName = pathParts[pathParts.length - 1].replace('.html', '');
window.currentSongs = allSongs;

// Entry pages + archive: pull directly from the keyed catalog — no string matching needed
if ((fileName.match(/^\d+\.\d+\.\d+$/) || fileName === 'archive') && window.songsByPage) {
  if (fileName !== 'archive') sessionStorage.removeItem('playbackState');
  window.currentSongs = window.songsByPage[fileName] || [];
  if (window.globalMuxPlayer) {
    window.globalMuxPlayer.pause();
    window.globalMuxPlayer.removeAttribute('playback-id');
  }
}

const audioList = document.getElementById('audioList');
const progressEl = document.getElementById('progress');
const bottomBar = document.getElementById('bottomBar');
const progressBarArea = document.getElementById('progressBarArea');
const bottomPlayBtn = document.getElementById('bottomPlayPause');
const songTitleEl = document.getElementById('songTitle');
const closeBtn = document.getElementById('closeBtn');
const loadingSpinner = document.getElementById('loadingSpinner');
const activeMuxPlayer = document.getElementById('activeMuxPlayer');
let stripeClient = null;
let checkoutElements = null;
let checkoutCard = null;
let checkoutPaymentRequest = null;
let checkoutPaymentRequestButton = null;
let checkoutMode = 'cart';
let checkoutTipAmount = 1;

function formatTipAmount(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) return '1';
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/\.00$/, '');
}

function parseCustomTipAmount(rawValue) {
  const normalized = String(rawValue || '').replace(/[^0-9.]/g, '');
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100) / 100;
  if (rounded < 1 || rounded > 500) return null;
  return rounded;
}

function createHoverTimeElement(className) {
  const tooltip = document.createElement('div');
  tooltip.className = className;
  tooltip.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tooltip);
  return tooltip;
}

function formatTimecode(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';

  const wholeSeconds = Math.floor(totalSeconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function showHoverTime(tooltip, clientX, top, seconds) {
  tooltip.textContent = formatTimecode(seconds);
  tooltip.style.left = `${clientX}px`;
  tooltip.style.top = `${top}px`;
  tooltip.classList.add('visible');
}

function hideHoverTime(tooltip) {
  tooltip.classList.remove('visible');
}

const progressHoverTime = createHoverTimeElement('progress-hover-time');
const videoProgressHoverTime = createHoverTimeElement('video-progress-hover-time');

function ensureStripeClient() {
  if (window.Stripe && !stripeClient) {
    stripeClient = window.Stripe('pk_live_51TJGQcBKbG6lpNutrYNDhGV6aFM66hoqLakruHGC4omCXn0Nc9fXAqGzpqRIpq97v6tGP67Vx3vd1vpZbK1YkSks00ZFMq7fjN');
  }
}

function loadStripeScript() {
  return new Promise((resolve, reject) => {
    if (window.Stripe) {
      ensureStripeClient();
      resolve();
      return;
    }

    let script = document.querySelector('script[data-stripe-js="true"]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.async = true;
      script.dataset.stripeJs = 'true';
      document.head.appendChild(script);
    }

    script.addEventListener('load', () => {
      ensureStripeClient();
      resolve();
    }, { once: true });

    script.addEventListener('error', () => {
      reject(new Error('Failed to load Stripe.'));
    }, { once: true });
  });
}

function createTipUI() {
  if (!bottomPlayBtn) return;
  if (document.getElementById('tipToggleBtn')) return;

  const controls = document.querySelector('.bottom-bar-controls');
  if (!controls) return;

  const wrap = document.createElement('div');
  wrap.className = 'bottom-tip-wrap';

  const tipBtn = document.createElement('button');
  tipBtn.type = 'button';
  tipBtn.className = 'icon-btn now-playing-tip-btn';
  tipBtn.id = 'tipToggleBtn';
  tipBtn.setAttribute('aria-expanded', 'false');
  tipBtn.textContent = 'Tip';

  const menu = document.createElement('div');
  menu.className = 'tip-options';
  menu.id = 'tipOptions';

  [1, 3].forEach(amount => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'icon-btn tip-option-btn';
    option.textContent = `$${amount}`;
    option.addEventListener('click', () => {
      const customPanel = document.getElementById('tipCustomPanel');
      if (customPanel) customPanel.classList.remove('open');
      menu.classList.remove('open');
      tipBtn.setAttribute('aria-expanded', 'false');
      openCheckoutPopup('tip', amount);
    });
    menu.appendChild(option);
  });

  const customBtn = document.createElement('button');
  customBtn.type = 'button';
  customBtn.className = 'icon-btn tip-option-btn';
  customBtn.id = 'tipCustomToggle';
  customBtn.textContent = '+';

  const customPanel = document.createElement('div');
  customPanel.className = 'tip-custom-panel';
  customPanel.id = 'tipCustomPanel';
  customPanel.innerHTML = `
    <label class="tip-custom-label" for="tipCustomAmount">Custom $</label>
    <div class="tip-custom-row">
      <input id="tipCustomAmount" class="tip-custom-input" type="number" inputmode="decimal" min="1" max="500" step="0.01" placeholder="5" aria-label="Custom tip amount">
      <button type="button" class="icon-btn tip-custom-go" id="tipCustomGo">Go</button>
    </div>
  `;

  const closeCustomPanel = () => {
    customPanel.classList.remove('open');
  };

  const submitCustomAmount = () => {
    const input = customPanel.querySelector('#tipCustomAmount');
    if (!input) return;
    const parsed = parseCustomTipAmount(input.value);

    if (!parsed) {
      input.focus();
      input.select();
      return;
    }

    input.value = '';
    closeCustomPanel();
    menu.classList.remove('open');
    tipBtn.setAttribute('aria-expanded', 'false');
    openCheckoutPopup('tip', parsed);
  };

  customBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !customPanel.classList.contains('open');
    customPanel.classList.toggle('open', opening);
    if (opening) {
      const input = customPanel.querySelector('#tipCustomAmount');
      if (input) {
        input.value = '';
        input.focus();
      }
    }
  });

  customPanel.querySelector('#tipCustomGo').addEventListener('click', submitCustomAmount);
  customPanel.querySelector('#tipCustomAmount').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitCustomAmount();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCustomPanel();
    }
  });

  menu.appendChild(customBtn);
  menu.appendChild(customPanel);

  tipBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.toggle('open');
    tipBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  wrap.appendChild(tipBtn);
  wrap.appendChild(menu);
  controls.insertBefore(wrap, progressBarArea);

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      closeCustomPanel();
      menu.classList.remove('open');
      tipBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

function createCheckoutPopup() {
  if (document.getElementById('purchaseOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'purchaseOverlay';
  overlay.className = 'checkout-popup-overlay';
  overlay.innerHTML = `
    <div class="checkout-popup" role="dialog" aria-modal="true" aria-labelledby="purchaseTitle">
      <div class="checkout-popup-header">
        <p class="checkout-popup-eyebrow" id="purchaseTitle">Checkout</p>
        <button type="button" class="icon-btn checkout-close-btn" id="purchaseClose">Close</button>
      </div>
      <div class="checkout-popup-body">
        <div id="purchaseSummary" class="checkout-summary"></div>
        <form id="purchaseForm" class="checkout-form minimal-checkout" autocomplete="on">
          <div id="purchaseShippingFields">
            <label class="checkout-label">Name
              <input class="checkout-input" type="text" name="name" required>
            </label>
            <label class="checkout-label">Email
              <input class="checkout-input" type="email" name="email" required>
            </label>
            <label class="checkout-label">Street Address
              <input class="checkout-input" type="text" name="address_line1" required>
            </label>
            <label class="checkout-label">Apt / Suite (optional)
              <input class="checkout-input" type="text" name="address_line2">
            </label>
            <div style="display:flex;gap:12px;">
              <label class="checkout-label" style="flex:1;">City
                <input class="checkout-input" type="text" name="city" required>
              </label>
              <label class="checkout-label" style="flex:1;">State
                <input class="checkout-input" type="text" name="state" required maxlength="2" placeholder="NY">
              </label>
            </div>
            <label class="checkout-label">ZIP
              <input class="checkout-input" type="text" name="zip" required maxlength="10" placeholder="10001">
            </label>
          </div>
          <div id="purchaseWalletWrap" class="checkout-wallet-wrap" style="display:none;">
            <div id="purchaseApplePayElement" class="checkout-wallet-button"></div>
            <div class="checkout-wallet-divider">or pay with card</div>
          </div>
          <div id="purchaseCardElement" class="checkout-input" style="padding:16px 0 8px 0;"></div>
          <div id="purchaseCardErrors" style="color:#c00;font-size:0.95em;margin-top:4px;"></div>
          <button type="submit" class="icon-btn" id="purchasePayBtn">Pay</button>
          <div id="purchaseStatus" class="checkout-popup-status"></div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeCheckoutPopup();
  });
  document.getElementById('purchaseClose').addEventListener('click', closeCheckoutPopup);
  document.getElementById('purchaseForm').addEventListener('submit', handlePopupCheckoutSubmit);
}

function getCartItems() {
  try {
    return JSON.parse(localStorage.getItem('cart') || '[]');
  } catch {
    return [];
  }
}

function updateCartFloat() {
  const float = document.getElementById('cartFloat');
  if (!float) return;
  const cart = getCartItems();
  float.style.display = cart.length > 0 ? 'inline-flex' : 'none';
}

function renderCheckoutSummary() {
  const summary = document.getElementById('purchaseSummary');
  const shippingFields = document.getElementById('purchaseShippingFields');

  if (!summary || !shippingFields) return;

  if (checkoutMode === 'tip') {
    summary.innerHTML = `
      <p class="checkout-popup-title">Support Burnfolder</p>
      <p class="checkout-popup-line">Tip amount: $${formatTipAmount(checkoutTipAmount)}</p>
    `;
    shippingFields.style.display = 'none';
  } else {
    const cart = getCartItems();
    const total = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);

    if (cart.length === 0) {
      summary.innerHTML = '<p class="checkout-popup-line">Your cart is empty.</p>';
    } else {
      const rows = cart.map(item => `<div class="checkout-popup-line">${item.name} x${item.qty} - $${item.price * item.qty}</div>`).join('');
      summary.innerHTML = `
        <p class="checkout-popup-title">Your Cart</p>
        ${rows}
        <div class="checkout-popup-total">Total: $${total}</div>
      `;
    }

    shippingFields.style.display = 'block';
  }
}

function getCheckoutAmountCents() {
  if (checkoutMode === 'tip') {
    return Math.max(0, Number(checkoutTipAmount) * 100);
  }

  const cart = getCartItems();
  const total = cart.reduce((acc, item) => acc + (Number(item.price) * Number(item.qty)), 0);
  return Math.max(0, Math.round(total * 100));
}

function resetCheckoutWalletButton() {
  if (checkoutPaymentRequestButton) {
    try {
      checkoutPaymentRequestButton.unmount();
    } catch {
      // no-op
    }
  }

  checkoutPaymentRequestButton = null;
  checkoutPaymentRequest = null;

  const walletContainer = document.getElementById('purchaseApplePayElement');
  if (walletContainer) walletContainer.innerHTML = '';
}

function getShippingFromWalletEvent(ev) {
  const shippingAddress = ev.shippingAddress || {};
  const line1 = Array.isArray(shippingAddress.addressLine) ? (shippingAddress.addressLine[0] || '') : '';
  const line2 = Array.isArray(shippingAddress.addressLine) ? (shippingAddress.addressLine[1] || '') : '';

  return {
    name: ev.payerName || '',
    email: ev.payerEmail || '',
    address_line1: line1,
    address_line2: line2,
    city: shippingAddress.city || shippingAddress.locality || '',
    state: (shippingAddress.region || '').toUpperCase(),
    zip: shippingAddress.postalCode || ''
  };
}

async function mountCheckoutWalletButton() {
  const walletWrap = document.getElementById('purchaseWalletWrap');
  const walletContainer = document.getElementById('purchaseApplePayElement');
  const status = document.getElementById('purchaseStatus');
  const errors = document.getElementById('purchaseCardErrors');

  if (!walletWrap || !walletContainer) return;

  walletWrap.style.display = 'none';
  resetCheckoutWalletButton();

  await loadStripeScript();
  if (!stripeClient) return;

  const amount = getCheckoutAmountCents();
  if (!amount) return;

  checkoutPaymentRequest = stripeClient.paymentRequest({
    country: 'US',
    currency: 'usd',
    total: {
      label: checkoutMode === 'tip' ? 'Burnfolder Tip' : 'Burnfolder Order',
      amount
    },
    requestPayerName: true,
    requestPayerEmail: true,
    requestShipping: checkoutMode === 'cart',
    disableWallets: ['link']
  });

  const canMakePayment = await checkoutPaymentRequest.canMakePayment();
  const safariApplePayAvailable = Boolean(
    window.ApplePaySession && typeof window.ApplePaySession.canMakePayments === 'function' && window.ApplePaySession.canMakePayments()
  );
  const hasAppleOrGoogleWallet = Boolean(
    canMakePayment === true ||
    (canMakePayment && (canMakePayment.applePay || canMakePayment.googlePay)) ||
    safariApplePayAvailable
  );
  if (!hasAppleOrGoogleWallet) {
    if (status) {
      status.textContent = 'Apple Pay / Google Pay unavailable on this device or browser.';
    }
    return;
  }

  const walletElements = stripeClient.elements();
  checkoutPaymentRequestButton = walletElements.create('paymentRequestButton', {
    paymentRequest: checkoutPaymentRequest,
    style: {
      paymentRequestButton: {
        type: 'buy',
        theme: 'dark',
        height: '40px'
      }
    }
  });

  checkoutPaymentRequestButton.mount('#purchaseApplePayElement');
  walletWrap.style.display = 'block';

  checkoutPaymentRequest.on('paymentmethod', async (ev) => {
    if (errors) errors.textContent = '';
    if (status) status.textContent = 'Processing wallet payment...';

    try {
      let clientSecret = '';
      let confirmOpts = {
        payment_method: ev.paymentMethod.id
      };

      if (checkoutMode === 'tip') {
        const res = await fetch('/.netlify/functions/create-tip-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: checkoutTipAmount, email: ev.payerEmail || '' })
        });
        const data = await res.json();
        if (!res.ok || !data.clientSecret) {
          ev.complete('fail');
          throw new Error(data.error || 'Could not create tip payment intent.');
        }

        clientSecret = data.clientSecret;
        confirmOpts = {
          payment_method: ev.paymentMethod.id,
          receipt_email: ev.payerEmail || undefined
        };
      } else {
        const cart = getCartItems();
        if (cart.length === 0) {
          ev.complete('fail');
          throw new Error('Your cart is empty.');
        }

        const shipping = getShippingFromWalletEvent(ev);
        const res = await fetch('/.netlify/functions/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cart, shipping })
        });
        const data = await res.json();
        if (!res.ok || !data.clientSecret) {
          ev.complete('fail');
          throw new Error(data.error || 'Could not create payment intent.');
        }

        clientSecret = data.clientSecret;
        confirmOpts = {
          payment_method: ev.paymentMethod.id,
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
          },
          receipt_email: shipping.email || undefined
        };
      }

      const initial = await stripeClient.confirmCardPayment(clientSecret, confirmOpts, { handleActions: false });
      if (initial.error) {
        ev.complete('fail');
        throw new Error(initial.error.message || 'Wallet payment failed.');
      }

      ev.complete('success');

      if (initial.paymentIntent && initial.paymentIntent.status === 'requires_action') {
        const followUp = await stripeClient.confirmCardPayment(clientSecret);
        if (followUp.error) {
          throw new Error(followUp.error.message || 'Payment authentication failed.');
        }
      }

      if (checkoutMode === 'cart') {
        localStorage.removeItem('cart');
        updateCartFloat();
        if (status) status.textContent = 'Payment successful. Your order is confirmed.';
      } else {
        if (status) status.textContent = 'Payment successful. Thank you for supporting burnfolder.';
      }

      setTimeout(() => {
        closeCheckoutPopup();
      }, 1200);
    } catch (err) {
      try {
        ev.complete('fail');
      } catch {
        // no-op
      }
      if (errors) errors.textContent = err.message || 'Wallet payment failed.';
      if (status) status.textContent = '';
    }
  });
}

async function ensureCheckoutCardMounted() {
  await loadStripeScript();
  if (!stripeClient) throw new Error('Stripe unavailable.');

  if (!checkoutElements) {
    checkoutElements = stripeClient.elements();
  }

  if (!checkoutCard) {
    checkoutCard = checkoutElements.create('card', {
      style: {
        base: {
          fontFamily: 'monospace',
          fontSize: '1em',
          color: '#000',
          '::placeholder': { color: '#888' },
          iconColor: '#000'
        },
        invalid: { color: '#c00' }
      }
    });
    checkoutCard.mount('#purchaseCardElement');
  }
}

async function openCheckoutPopup(mode, amount) {
  createCheckoutPopup();
  checkoutMode = mode;
  checkoutTipAmount = amount || 1;

  const overlay = document.getElementById('purchaseOverlay');
  const title = document.getElementById('purchaseTitle');
  const status = document.getElementById('purchaseStatus');
  const errors = document.getElementById('purchaseCardErrors');
  const payBtn = document.getElementById('purchasePayBtn');

  if (!overlay || !title || !status || !errors || !payBtn) return;

  title.textContent = mode === 'tip' ? 'Support Burnfolder' : 'Checkout';
  payBtn.textContent = mode === 'tip' ? `Pay $${checkoutTipAmount}` : 'Pay';
  if (mode === 'tip') {
    payBtn.textContent = `Pay $${formatTipAmount(checkoutTipAmount)}`;
  }
  status.textContent = '';
  errors.textContent = '';

  renderCheckoutSummary();

  overlay.classList.add('open');
  document.body.classList.add('checkout-open');

  try {
    await ensureCheckoutCardMounted();
    await mountCheckoutWalletButton();
  } catch (err) {
    status.textContent = err.message || 'Checkout unavailable.';
  }
}

function closeCheckoutPopup() {
  const overlay = document.getElementById('purchaseOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.classList.remove('checkout-open');
  resetCheckoutWalletButton();
}

async function handlePopupCheckoutSubmit(e) {
  e.preventDefault();

  const form = e.currentTarget;
  const status = document.getElementById('purchaseStatus');
  const errors = document.getElementById('purchaseCardErrors');
  const payBtn = document.getElementById('purchasePayBtn');

  if (!status || !errors || !payBtn || !checkoutCard) return;

  errors.textContent = '';
  payBtn.disabled = true;
  status.textContent = 'Processing payment...';

  try {
    let clientSecret = '';
    let confirmOpts = { payment_method: { card: checkoutCard } };

    if (checkoutMode === 'tip') {
      const res = await fetch('/.netlify/functions/create-tip-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: checkoutTipAmount })
      });
      const data = await res.json();
      if (!res.ok || !data.clientSecret) {
        throw new Error(data.error || 'Could not create tip payment intent.');
      }

      clientSecret = data.clientSecret;
      confirmOpts = { payment_method: { card: checkoutCard } };
    } else {
      const cart = getCartItems();
      if (cart.length === 0) throw new Error('Your cart is empty.');

      const shipping = {
        name: form.name.value,
        email: form.email.value,
        address_line1: form.address_line1.value,
        address_line2: form.address_line2.value || '',
        city: form.city.value,
        state: form.state.value,
        zip: form.zip.value
      };

      const res = await fetch('/.netlify/functions/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart, shipping })
      });
      const data = await res.json();
      if (!res.ok || !data.clientSecret) {
        throw new Error(data.error || 'Could not create payment intent.');
      }

      clientSecret = data.clientSecret;
      confirmOpts = {
        payment_method: {
          card: checkoutCard,
          billing_details: {
            name: shipping.name,
            email: shipping.email
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
      };
    }

    const result = await stripeClient.confirmCardPayment(clientSecret, confirmOpts);
    if (result.error) {
      errors.textContent = result.error.message || 'Payment failed.';
      status.textContent = '';
      payBtn.disabled = false;
      return;
    }

    if (checkoutMode === 'cart') {
      localStorage.removeItem('cart');
      updateCartFloat();
      status.textContent = 'Payment successful. Your order is confirmed.';
    } else {
      status.textContent = 'Payment successful. Thank you for supporting burnfolder.';
    }

    setTimeout(() => {
      closeCheckoutPopup();
    }, 1200);
  } catch (err) {
    status.textContent = err.message || 'Checkout failed.';
    payBtn.disabled = false;
  }
}

window.openCheckoutPopup = openCheckoutPopup;

document.addEventListener('click', (e) => {
  const cartBtn = e.target.closest('#cartFloat');
  if (!cartBtn) return;
  if (cartBtn.hasAttribute('onclick')) cartBtn.removeAttribute('onclick');
  e.preventDefault();
  e.stopPropagation();
  openCheckoutPopup('cart');
}, true);

window.addEventListener('storage', updateCartFloat);
document.addEventListener('DOMContentLoaded', updateCartFloat);

createTipUI();

let activeIdx = null;

// Store reference to active player globally
if (!window.globalMuxPlayer) {
  window.globalMuxPlayer = activeMuxPlayer;
}

// Restore playback state from previous page
const savedState = sessionStorage.getItem('playbackState');
if (savedState && audioList) {
  try {
    const state = JSON.parse(savedState);
    // Only restore if the song is valid for the current page
    const songIndex = window.currentSongs.findIndex(s => s.playbackId === state.playbackId);
    if (songIndex !== -1) {
      activeIdx = songIndex;
      // Check if player already has this track loaded
      const currentPlaybackId = activeMuxPlayer.getAttribute('playback-id');
      if (currentPlaybackId === state.playbackId) {
        // Same track, just update UI - don't reload
        bottomBar.style.display = 'block';
        updateUI();
        initializeVolumeControl();
      } else {
        // Different track or first load
        setTimeout(() => {
          activeMuxPlayer.setAttribute('playback-id', state.playbackId);
          activeMuxPlayer.setAttribute('metadata-video-title', state.title);
          // mux-player reacts to playback-id changes automatically — no .load() needed
          activeMuxPlayer.addEventListener('loadedmetadata', () => {
            activeMuxPlayer.currentTime = state.currentTime || 0;
            if (state.isPlaying) {
              activeMuxPlayer.play().catch(() => {
                // Auto-play blocked
                console.log('Auto-play prevented');
              });
            }
            updateUI();
            initializeVolumeControl();
          }, { once: true });
        }, 50);
      }
    } else {
      // If the saved song is not valid for this page, reset player state
      activeIdx = null;
      if (window.globalMuxPlayer) {
        window.globalMuxPlayer.pause();
        window.globalMuxPlayer.removeAttribute('playback-id');
        window.globalMuxPlayer.load();
      }
      updateUI();
    }
  } catch (e) {
    console.error('Failed to restore playback state:', e);
  }
}

// Save playback state before page unload
window.addEventListener('beforeunload', () => {
  if (activeIdx !== null && activeMuxPlayer) {
    const state = {
      playbackId: window.currentSongs[activeIdx].playbackId,
      title: window.currentSongs[activeIdx].title,
      currentTime: activeMuxPlayer.currentTime || 0,
      isPlaying: !activeMuxPlayer.paused
    };
    sessionStorage.setItem('playbackState', JSON.stringify(state));
  }
});

// Update playback state periodically
setInterval(() => {
  if (activeIdx !== null && activeMuxPlayer) {
    const state = {
      playbackId: window.currentSongs[activeIdx].playbackId,
      title: window.currentSongs[activeIdx].title,
      currentTime: activeMuxPlayer.currentTime || 0,
      isPlaying: !activeMuxPlayer.paused
    };
    sessionStorage.setItem('playbackState', JSON.stringify(state));
  }
}, 1000);

// Render song list — only when spa-router hasn't already populated it
// (spa-router.js runs before scripts.js and calls updateAudioListForPage on load;
//  if audioList already has children, skip to avoid duplicates)
const didRenderInitially = !audioList || audioList.children.length > 0;

if (audioList && !didRenderInitially) {
  window.currentSongs.forEach((song, idx) => {
    const titleSpan = document.createElement('span');
    titleSpan.className = 'page-song-title';
    titleSpan.id = `pageSongTitle${idx+1}`;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = song.title;
    const durationSpan = document.createElement('span');
    durationSpan.className = 'song-duration';
    durationSpan.textContent = '--:--';
    titleSpan.appendChild(nameSpan);
    titleSpan.appendChild(durationSpan);
    titleSpan.setAttribute('tabindex', '0');
    titleSpan.setAttribute('role', 'button');
    titleSpan.setAttribute('aria-label', `Play ${song.title}`);
    titleSpan.addEventListener('click', () => { playTrack(idx); });
    titleSpan.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (activeIdx === idx) { togglePlayPause(); } else { playTrack(idx); }
      }
    });
    const container = document.createElement('div');
    container.className = 'mux-audio-container';
    if (idx > 0) container.style.marginTop = '32px';
    container.appendChild(titleSpan);
    audioList.appendChild(container);
  });
}

// Preload all track durations — skip if spa-router already did it via makeSongRow()
if (!didRenderInitially) {
window.currentSongs.forEach((song, idx) => {
  const tempPlayer = document.createElement('mux-player');
  tempPlayer.setAttribute('playback-id', song.playbackId);
  tempPlayer.setAttribute('metadata-video-title', song.title);
  tempPlayer.style.display = 'none';
  tempPlayer.muted = true;
  document.body.appendChild(tempPlayer);
  
  tempPlayer.addEventListener('loadedmetadata', () => {
    const duration = tempPlayer.duration;
    if (duration && !isNaN(duration)) {
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      const formattedDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      const durationEl = document.querySelector(`#pageSongTitle${idx + 1} .song-duration`);
      if (durationEl) {
        durationEl.textContent = formattedDuration;
      }
    }
    // Remove temp player after getting duration
    tempPlayer.remove();
  }, { once: true });
});
}

function updateUI() {
  document.querySelectorAll('.page-song-title').forEach((el, i) => {
    el.classList.toggle('active', i === activeIdx && !activeMuxPlayer.paused);
  });
  if (activeIdx !== null) {
    if (!activeMuxPlayer.paused) {
      bottomPlayBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/></svg>';
    } else {
      bottomPlayBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="6,4 20,12 6,20" fill="currentColor"/></svg>';
    }
    songTitleEl.textContent = window.currentSongs[activeIdx].title;
    bottomBar.style.display = 'block';
    bottomPlayBtn.focus();
  } else {
    bottomBar.style.display = 'none';
    songTitleEl.textContent = '';
  }
}

function playTrack(idx) {
  activeMuxPlayer.pause();
  activeMuxPlayer.currentTime = 0;
  // Set playback-id — mux-player reacts to attribute changes automatically.
  // Do NOT call .load() after this; it resets the player to the previous src.
  activeMuxPlayer.setAttribute('playback-id', window.currentSongs[idx].playbackId);
  activeMuxPlayer.setAttribute('metadata-video-title', window.currentSongs[idx].title);
  activeIdx = idx;
  updateUI();
  
  // Initialize volume control when track starts
  setTimeout(() => {
    initializeVolumeControl();
  }, 100);
  
  // Try to play directly
  const playPromise = activeMuxPlayer.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      // Fallback: dispatch synthetic click to play/pause button
      bottomPlayBtn.click();
    });
  }
  // Fallback: dispatch synthetic click after short delay if still paused
  setTimeout(() => {
    if (activeMuxPlayer.paused) {
      bottomPlayBtn.click();
    }
    bottomPlayBtn.focus();
  }, 100);
}

function togglePlayPause() {
  if (activeIdx !== null) {
    if (activeMuxPlayer.paused) {
      activeMuxPlayer.play();
    } else {
      activeMuxPlayer.pause();
    }
    updateUI();
    bottomPlayBtn.focus();
  }
}

bottomPlayBtn.addEventListener('click', () => {
  togglePlayPause();
});

document.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.key === ' ') && activeIdx !== null && bottomBar.style.display === 'block') {
    e.preventDefault();
    togglePlayPause();
    bottomPlayBtn.focus();
  }
});

closeBtn.addEventListener('click', () => {
  if (activeIdx !== null) {
    activeMuxPlayer.pause();
    activeIdx = null;
    sessionStorage.removeItem('playbackState');
    updateUI();
  }
});

function showLoading(show) {
  if (loadingSpinner) loadingSpinner.style.display = show ? 'block' : 'none';
}

function updateProgress() {
  if (activeIdx !== null) {
    if (activeMuxPlayer.duration) {
      const percent = (activeMuxPlayer.currentTime / activeMuxPlayer.duration) * 100;
      progressEl.style.width = percent + '%';
      const playhead = document.getElementById('progressPlayhead');
      if (playhead) playhead.style.left = percent + '%';
    } else {
      progressEl.style.width = '0%';
    }
  }
}
activeMuxPlayer.addEventListener('timeupdate', updateProgress);
activeMuxPlayer.addEventListener('ended', () => {
  updateUI();
  progressEl.style.width = '0%';
});
activeMuxPlayer.addEventListener('waiting', () => {
  showLoading(true);
});
activeMuxPlayer.addEventListener('playing', () => {
  showLoading(false);
  updateUI();
});
activeMuxPlayer.addEventListener('pause', () => {
  updateUI();
});
activeMuxPlayer.addEventListener('error', () => {
  alert(`Failed to load "${window.currentSongs[activeIdx].title}". Please try again later.`);
  activeMuxPlayer.pause();
  showLoading(false);
  updateUI();
});
progressBarArea.addEventListener('click', (e) => {
  if (activeIdx !== null) {
    const rect = progressBarArea.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    if (activeMuxPlayer.duration) {
      activeMuxPlayer.currentTime = percent * activeMuxPlayer.duration;
    }
  }
});

progressBarArea.addEventListener('mousemove', (e) => {
  if (activeIdx === null || !activeMuxPlayer.duration) {
    hideHoverTime(progressHoverTime);
    return;
  }

  const rect = progressBarArea.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  showHoverTime(progressHoverTime, e.clientX, rect.top, percent * activeMuxPlayer.duration);
});

progressBarArea.addEventListener('mouseleave', () => {
  hideHoverTime(progressHoverTime);
});

// Enhanced progress bar interaction with dragging support
let isProgressDragging = false;
let pendingProgressUpdate = null;
let cachedProgressRect = null;
let lastUpdateTime = 0;
const UPDATE_THROTTLE = 16; // ~60fps, update every 16ms

const updateProgressFromEvent = (e) => {
  if (activeIdx !== null && activeMuxPlayer.duration) {
    const now = performance.now();
    
    // Cache rect when dragging starts, don't recalculate every time
    if (!cachedProgressRect) {
      cachedProgressRect = progressBarArea.getBoundingClientRect();
    }
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const x = clientX - cachedProgressRect.left;
    const percent = Math.max(0, Math.min(1, x / cachedProgressRect.width));

    showHoverTime(progressHoverTime, clientX, cachedProgressRect.top, percent * activeMuxPlayer.duration);

    // Immediate visual feedback — update fill and playhead without waiting for throttle
    progressEl.style.width = (percent * 100) + '%';
    const ph = document.getElementById('progressPlayhead');
    if (ph) ph.style.left = (percent * 100) + '%';

    // Throttle updates for better performance during fast dragging
    if (now - lastUpdateTime >= UPDATE_THROTTLE) {
      // Cancel any pending update
      if (pendingProgressUpdate) {
        cancelAnimationFrame(pendingProgressUpdate);
      }
      
      // Use requestAnimationFrame for smooth updates
      pendingProgressUpdate = requestAnimationFrame(() => {
        try {
          // Batch the audio update to reduce audio engine overhead
          const newTime = percent * activeMuxPlayer.duration;
          if (Math.abs(activeMuxPlayer.currentTime - newTime) > 0.1) {
            activeMuxPlayer.currentTime = newTime;
          }
        } catch (error) {
          // Ignore errors during rapid seeking
        }
        pendingProgressUpdate = null;
      });
      
      lastUpdateTime = now;
    }
  }
};

// Mouse events for progress bar dragging
progressBarArea.addEventListener('mousedown', (e) => {
  if (activeIdx !== null) {
    isProgressDragging = true;
    progressBarArea.classList.add('dragging');
    cachedProgressRect = null;
    updateProgressFromEvent(e);
    e.preventDefault();
  }
});

document.addEventListener('mousemove', (e) => {
  if (isProgressDragging) {
    // Immediate update for responsiveness
    updateProgressFromEvent(e);
    e.preventDefault();
  }
});

document.addEventListener('mouseup', () => {
  if (isProgressDragging) {
    isProgressDragging = false;
    progressBarArea.classList.remove('dragging');
    hideHoverTime(progressHoverTime);
    cachedProgressRect = null;
    lastUpdateTime = 0;
    if (pendingProgressUpdate) {
      cancelAnimationFrame(pendingProgressUpdate);
      pendingProgressUpdate = null;
    }
  }
});

window.addEventListener('blur', () => {
  isProgressDragging = false;
  progressBarArea.classList.remove('dragging');
  hideHoverTime(progressHoverTime);
  cachedProgressRect = null;
  lastUpdateTime = 0;
  if (pendingProgressUpdate) {
    cancelAnimationFrame(pendingProgressUpdate);
    pendingProgressUpdate = null;
  }
});

document.addEventListener('pointermove', (e) => {
  if (!isProgressDragging && !progressBarArea.contains(e.target)) {
    hideHoverTime(progressHoverTime);
  }
});

// Touch events for progress bar dragging
progressBarArea.addEventListener('touchstart', (e) => {
  if (activeIdx !== null) {
    isProgressDragging = true;
    progressBarArea.classList.add('dragging');
    cachedProgressRect = null;
    updateProgressFromEvent(e);
    e.preventDefault();
  }
});

document.addEventListener('touchmove', (e) => {
  if (isProgressDragging) {
    // Immediate update for responsiveness
    updateProgressFromEvent(e);
    e.preventDefault(); // Prevent scrolling
  }
}, { passive: false }); // Important: non-passive for preventDefault

document.addEventListener('touchend', () => {
  if (isProgressDragging) {
    isProgressDragging = false;
    progressBarArea.classList.remove('dragging');
    hideHoverTime(progressHoverTime);
    cachedProgressRect = null;
    lastUpdateTime = 0;
    if (pendingProgressUpdate) {
      cancelAnimationFrame(pendingProgressUpdate);
      pendingProgressUpdate = null;
    }
  }
});

progressBarArea.addEventListener('touchcancel', () => {
  isProgressDragging = false;
  progressBarArea.classList.remove('dragging');
  hideHoverTime(progressHoverTime);
  cachedProgressRect = null;
  lastUpdateTime = 0;
  if (pendingProgressUpdate) {
    cancelAnimationFrame(pendingProgressUpdate);
    pendingProgressUpdate = null;
  }
});

// Volume control functionality
let currentVolume = 0.75; // Default volume at 75%

function initializeVolumeControl() {
  const volumeControl = document.getElementById('volumeControl');
  const volumeFader = document.getElementById('volumeFader');
  const volumeTrack = volumeFader?.querySelector('.volume-track');
  const volumeFill = document.getElementById('volumeFill');
  
  if (volumeControl && activeMuxPlayer) {
    // Set initial volume display and player volume
    updateVolumeDisplay();
    
    // Set initial volume - access the underlying media element for mux-player
    try {
      const mediaElement = activeMuxPlayer.media || activeMuxPlayer;
      if (mediaElement) {
        mediaElement.volume = currentVolume;
        mediaElement.muted = false;
        console.log('Initial volume set to:', currentVolume);
      }
    } catch (error) {
      console.log('Initial volume setting error:', error);
    }
    
    // Also set volume on any other audio elements after a delay
    setTimeout(() => {
      const audioElements = document.querySelectorAll('audio, video');
      audioElements.forEach(element => {
        try {
          element.volume = currentVolume;
          element.muted = false;
        } catch (error) {
          console.log('Initial audio element volume error:', error);
        }
      });
    }, 500); // Delay to ensure elements are loaded
    
    // Keep fader visible while interacting
    let faderTimeout;
    
    volumeControl.addEventListener('mouseenter', () => {
      clearTimeout(faderTimeout);
      volumeFader.classList.add('active');
    });
    
    volumeControl.addEventListener('mouseleave', () => {
      faderTimeout = setTimeout(() => {
        volumeFader.classList.remove('active');
      }, 300);
    });
    
    // Handle volume track interactions (mouse and touch)
    if (volumeTrack) {
      let isDragging = false;
      
      const updateVolumeFromEvent = (e) => {
        const rect = volumeTrack.getBoundingClientRect();
        // Handle both mouse and touch events
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const y = clientY - rect.top;
        const percent = Math.max(0, Math.min(1, 1 - (y / rect.height))); // Invert y for bottom-up
        
        currentVolume = percent;
        updateVolumeDisplay();
        
        // Set volume on the active Mux player
        if (activeMuxPlayer) {
          try {
            // For mux-player-audio, we need to access the underlying media element
            const mediaElement = activeMuxPlayer.media || activeMuxPlayer;
            if (mediaElement) {
              mediaElement.volume = percent;
              mediaElement.muted = false; // Ensure not muted
              console.log('Volume set to:', percent);
            }
          } catch (error) {
            console.log('Volume setting error:', error);
          }
        }
        
        // Also try to find any audio/video elements and set their volume
        const audioElements = document.querySelectorAll('audio, video');
        audioElements.forEach(element => {
          try {
            element.volume = percent;
            element.muted = false;
          } catch (error) {
            console.log('Audio element volume error:', error);
          }
        });
      };
      
      // Mouse events
      volumeTrack.addEventListener('mousedown', (e) => {
        isDragging = true;
        updateVolumeFromEvent(e);
        e.preventDefault();
      });
      
      volumeTrack.addEventListener('mousemove', (e) => {
        if (isDragging) {
          updateVolumeFromEvent(e);
        }
      });
      
      document.addEventListener('mouseup', () => {
        isDragging = false;
      });
      
      // Touch events for mobile - show fader only when touching
      volumeTrack.addEventListener('touchstart', (e) => {
        isDragging = true;
        clearTimeout(faderTimeout);
        volumeFader.classList.add('active');
        updateVolumeFromEvent(e);
        e.preventDefault();
        e.stopPropagation();
      });
      
      volumeTrack.addEventListener('touchmove', (e) => {
        if (isDragging) {
          updateVolumeFromEvent(e);
          e.preventDefault();
          e.stopPropagation();
        }
      });
      
      volumeTrack.addEventListener('touchend', (e) => {
        isDragging = false;
        e.preventDefault();
        // Hide fader after touch ends
        faderTimeout = setTimeout(() => {
          volumeFader.classList.remove('active');
        }, 1000);
      });
      
      // Speaker icon events to toggle fader
      const speakerIcon = document.getElementById('speakerIcon');
      if (speakerIcon) {
        // Click event for desktop (toggle on/off)
        speakerIcon.addEventListener('click', (e) => {
          e.stopPropagation();
          clearTimeout(faderTimeout);
          
          if (volumeFader.classList.contains('active')) {
            // Hide fader
            volumeFader.classList.remove('active');
          } else {
            // Show fader
            volumeFader.classList.add('active');
          }
        });
        
        // Touch events for mobile (toggle on/off)
        if ('ontouchstart' in window) {
          speakerIcon.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            e.preventDefault();
            clearTimeout(faderTimeout);
            
            if (volumeFader.classList.contains('active')) {
              // Hide fader
              volumeFader.classList.remove('active');
            } else {
              // Show fader
              volumeFader.classList.add('active');
            }
          });
        }
      }
      
      // Close volume fader when clicking/touching outside
      document.addEventListener('click', (e) => {
        if (!volumeControl.contains(e.target)) {
          volumeFader.classList.remove('active');
          clearTimeout(faderTimeout);
        }
      });
      
      if ('ontouchstart' in window) {
        document.addEventListener('touchstart', (e) => {
          if (!volumeControl.contains(e.target)) {
            volumeFader.classList.remove('active');
            clearTimeout(faderTimeout);
          }
        });
      }
      
      // Fallback click event for volume track (for non-touch devices)
      volumeTrack.addEventListener('click', (e) => {
        if (!isDragging) {
          updateVolumeFromEvent(e);
        }
      });
    }
  }
}

function updateVolumeDisplay() {
  const volumeFill = document.getElementById('volumeFill');
  
  if (volumeFill) {
    const fillHeight = (currentVolume * 100) + '%';
    volumeFill.style.height = fillHeight;
  }
}
