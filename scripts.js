// --- Spotify-like Streaming Service Audio Logic ---
// Load allSongs from songs.js (must be included in HTML before scripts.js)
let allSongs = window.allSongs || [];

// Determine which songs to show on this page
const pathParts = window.location.pathname.split('/');
const fileName = pathParts[pathParts.length - 1].replace('.html', '') || 'index';
const noAudioChromePages = new Set(['index', 'shop', 'cart', 'checkout', 'cancel', 'success']);
window.currentSongs = noAudioChromePages.has(fileName) ? [] : allSongs;

// Dated entry pages: pull directly from the keyed catalog — no string matching needed
if (fileName.match(/^\d+\.\d+\.\d+$/) && window.songsByPage) {
  sessionStorage.removeItem('playbackState');
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
let versionPickerMenu = null;
let versionPickerList = null;
let songTitleWrap = null;
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
  const pk = window.STRIPE_PUBLISHABLE_KEY;
  if (window.Stripe && pk && !stripeClient) {
    stripeClient = window.Stripe(pk);
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

function extractDateFromText(text) {
  const match = String(text || '').match(/(?:\(|\s)(\d{1,2}\.\d{1,2}\.\d{2})(?:\)|\s|$)/);
  return match ? match[1] : null;
}

function getTrackDateLabel(song) {
  const fromTitle = extractDateFromText(song && song.title);
  if (fromTitle) return fromTitle;
  if (song && /^\d+\.\d+\.\d+$/.test(song.page || '')) return song.page;
  return '';
}

function parseTrackDateValue(song) {
  const label = getTrackDateLabel(song);
  if (!label) return -Infinity;

  const [monthRaw, dayRaw, yearRaw] = label.split('.').map(Number);
  if (![monthRaw, dayRaw, yearRaw].every(Number.isFinite)) return -Infinity;

  const year = 2000 + yearRaw;
  return new Date(year, monthRaw - 1, dayRaw).getTime();
}

function stripTrailingDate(title) {
  return String(title || '')
    .replace(/\s*\(\d{1,2}\.\d{1,2}\.\d{2}\)\s*$/i, '')
    .replace(/\s+\d{1,2}\.\d{1,2}\.\d{2}\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTrackGroupKey(title) {
  return stripTrailingDate(title).toLowerCase();
}

function getSongHubHref(song) {
  if (!song || !song.title) return 'song.html';
  return `song.html?song=${encodeURIComponent(getTrackGroupKey(song.title))}`;
}

/** Journal entry page for this recording (`M.DD.YY.html`), if applicable. */
function getEntryPageHref(song) {
  if (!song) return '';
  let p = song.page != null ? String(song.page).trim() : '';
  if (!p || !/^\d+\.\d+\.\d+$/.test(p)) {
    const pathParts = window.location.pathname.split('/');
    const fn = pathParts[pathParts.length - 1].replace('.html', '');
    if (/^\d+\.\d+\.\d+$/.test(fn)) p = fn;
  }
  if (!/^\d+\.\d+\.\d+$/.test(p)) return '';
  return `${p}.html`;
}

function getVersionCandidatesForActiveSong() {
  const activeSong = getActiveSong();
  if (!activeSong) return [];
  const groupKey = getTrackGroupKey(activeSong.title);
  const source = Array.isArray(window.allSongs) && window.allSongs.length ? window.allSongs : window.currentSongs;

  const byPlaybackId = new Map();
  source.forEach((song) => {
    if (!song || !song.playbackId) return;
    if (getTrackGroupKey(song.title) === groupKey) byPlaybackId.set(song.playbackId, song);
  });

  if (!byPlaybackId.has(activeSong.playbackId)) {
    byPlaybackId.set(activeSong.playbackId, activeSong);
  }

  return Array.from(byPlaybackId.values()).sort((a, b) => {
    const aDate = parseTrackDateValue(a);
    const bDate = parseTrackDateValue(b);
    if (aDate !== bDate) return bDate - aDate;
    return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
  });
}

function closeVersionPicker() {
  if (!versionPickerMenu || !songTitleEl) return;
  versionPickerMenu.classList.remove('open');
  songTitleEl.setAttribute('aria-expanded', 'false');
}

function playTrackBySong(song) {
  if (!song || !song.playbackId) return;

  const idx = window.currentSongs.findIndex((item) => item.playbackId === song.playbackId);
  if (idx !== -1) {
    playTrack(idx);
    return;
  }

  activeSongOverride = song;
  activeIdx = -1;

  activeMuxPlayer.pause();
  activeMuxPlayer.currentTime = 0;
  activeMuxPlayer.setAttribute('playback-id', song.playbackId);
  activeMuxPlayer.setAttribute('metadata-video-title', song.title);
  updateUI();

  setTimeout(() => {
    initializeVolumeControl();
  }, 100);

  const playPromise = activeMuxPlayer.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      bottomPlayBtn.click();
    });
  }
  setTimeout(() => {
    if (activeMuxPlayer.paused) {
      bottomPlayBtn.click();
    }
    bottomPlayBtn.focus();
  }, 100);
}

function renderVersionPicker() {
  const actionsEl = document.getElementById('versionPickerActions');
  if (!versionPickerList || !versionPickerMenu || !songTitleEl || !actionsEl) return;

  actionsEl.innerHTML = '';
  versionPickerList.innerHTML = '';

  const activeSong = getActiveSong();
  if (!activeSong) {
    closeVersionPicker();
    return;
  }

  const versions = getVersionCandidatesForActiveSong();

  const goToSongLink = document.createElement('a');
  goToSongLink.className = 'icon-btn version-picker-go-link';
  goToSongLink.href = getSongHubHref(activeSong);
  goToSongLink.textContent = 'go to song';
  goToSongLink.addEventListener('click', () => {
    closeVersionPicker();
  });
  actionsEl.appendChild(goToSongLink);

  const entryHref = getEntryPageHref(activeSong);
  if (entryHref) {
    const goToEntryLink = document.createElement('a');
    goToEntryLink.className = 'icon-btn version-picker-go-link';
    goToEntryLink.href = entryHref;
    goToEntryLink.textContent = 'go to entry';
    goToEntryLink.addEventListener('click', () => {
      closeVersionPicker();
    });
    actionsEl.appendChild(goToEntryLink);
  }

  versions.forEach((song) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn version-picker-item';
    button.textContent = song.title;
    if (activeSong && song.playbackId === activeSong.playbackId) {
      button.classList.add('active');
    }

    button.addEventListener('click', () => {
      closeVersionPicker();
      if (activeSong && song.playbackId === activeSong.playbackId) return;
      playTrackBySong(song);
    });

    versionPickerList.appendChild(button);
  });
}

function toggleVersionPicker() {
  if (!versionPickerMenu || !songTitleEl) return;
  if (!getActiveSong()) return;

  renderVersionPicker();
  const opening = !versionPickerMenu.classList.contains('open');
  versionPickerMenu.classList.toggle('open', opening);
  songTitleEl.setAttribute('aria-expanded', opening ? 'true' : 'false');
}

function createVersionPickerUI() {
  if (!songTitleEl || !songTitleEl.parentElement || document.getElementById('versionPickerMenu')) return;

  songTitleWrap = document.createElement('div');
  songTitleWrap.className = 'song-title-wrap';

  const parent = songTitleEl.parentElement;
  parent.insertBefore(songTitleWrap, songTitleEl);
  songTitleWrap.appendChild(songTitleEl);

  songTitleEl.classList.add('song-title-trigger');
  songTitleEl.setAttribute('tabindex', '0');
  songTitleEl.setAttribute('role', 'button');
  songTitleEl.setAttribute('aria-haspopup', 'dialog');
  songTitleEl.setAttribute('aria-expanded', 'false');
  songTitleEl.setAttribute('aria-label', 'Open now playing menu');

  versionPickerMenu = document.createElement('div');
  versionPickerMenu.className = 'version-picker-menu';
  versionPickerMenu.id = 'versionPickerMenu';
  versionPickerMenu.innerHTML = `
    <div class="version-picker-actions" id="versionPickerActions"></div>
    <div class="version-picker-heading">versions</div>
    <div class="version-picker-list" id="versionPickerList"></div>
  `;

  songTitleWrap.appendChild(versionPickerMenu);
  versionPickerList = versionPickerMenu.querySelector('#versionPickerList');

  songTitleEl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleVersionPicker();
  });

  songTitleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleVersionPicker();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeVersionPicker();
    }
  });

  versionPickerMenu.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.addEventListener('click', (e) => {
    if (!songTitleWrap || !songTitleWrap.contains(e.target)) {
      closeVersionPicker();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeVersionPicker();
  });
}

function renderSongHubPage() {
  const hubRoot = document.getElementById('songHubPage');
  if (!hubRoot) return;

  const titleEl = document.getElementById('songHubTitle');
  const subtitleEl = document.getElementById('songHubSubtitle');
  const versionsEl = document.getElementById('songHubVersions');
  const sortEl = document.getElementById('songHubSort');
  const lyricsPanel = document.getElementById('songHubLyricsPanel');
  const lyricsToggle = document.getElementById('songHubLyricsToggle');

  if (!titleEl || !subtitleEl || !versionsEl || !sortEl || !lyricsPanel || !lyricsToggle) return;

  const params = new URLSearchParams(window.location.search);
  const requestedSongKey = (params.get('song') || '').toLowerCase().trim();
  const activeSong = getActiveSong();
  const fallbackKey = activeSong ? getTrackGroupKey(activeSong.title) : '';
  const targetKey = requestedSongKey || fallbackKey;

  const allSongs = Array.isArray(window.allSongs) ? window.allSongs : [];
  const matchingVersions = allSongs.filter((song) => getTrackGroupKey(song.title) === targetKey);

  if (!matchingVersions.length) {
    titleEl.textContent = 'Song';
    subtitleEl.textContent = 'No versions found yet.';
    versionsEl.innerHTML = '<p class="song-hub-empty">Versions will appear here as they are added.</p>';
    return;
  }

  const baseTitle = stripTrailingDate(matchingVersions[0].title);
  titleEl.textContent = baseTitle;
  subtitleEl.textContent = `${matchingVersions.length} version${matchingVersions.length === 1 ? '' : 's'}`;

  const renderVersions = () => {
    const sortMode = sortEl.value || 'newest';
    const sorted = [...matchingVersions].sort((a, b) => {
      const aDate = parseTrackDateValue(a);
      const bDate = parseTrackDateValue(b);
      if (aDate === bDate) {
        return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
      }
      return sortMode === 'oldest' ? aDate - bDate : bDate - aDate;
    });

    versionsEl.innerHTML = '';
    sorted.forEach((song) => {
      const row = document.createElement('div');
      row.className = 'song-hub-version-row';

      const info = document.createElement('div');
      info.className = 'song-hub-version-info';

      const songTitle = document.createElement('p');
      songTitle.className = 'song-hub-version-title';
      songTitle.textContent = song.title;

      const meta = document.createElement('p');
      meta.className = 'song-hub-version-meta';
      const label = getTrackDateLabel(song) || 'undated';
      const page = song.page ? ` | entry ${song.page}` : '';
      meta.textContent = `${label}${page}`;

      info.appendChild(songTitle);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'song-hub-version-actions';

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'icon-btn';
      playBtn.textContent = 'Play';
      playBtn.addEventListener('click', () => {
        playTrackBySong(song);
      });
      actions.appendChild(playBtn);

      if (song.page && /^\d/.test(song.page)) {
        const entryLink = document.createElement('a');
        entryLink.className = 'icon-btn';
        entryLink.href = `${song.page}.html`;
        entryLink.textContent = 'Open entry';
        actions.appendChild(entryLink);
      }

      row.appendChild(info);
      row.appendChild(actions);
      versionsEl.appendChild(row);
    });
  };

  sortEl.onchange = renderVersions;
  renderVersions();

  lyricsToggle.onclick = () => {
    const opening = !lyricsPanel.classList.contains('open');
    lyricsPanel.classList.toggle('open', opening);
    lyricsToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
    lyricsToggle.textContent = opening ? 'Hide lyrics' : 'Open lyrics';
  };
}

window.renderSongHubPage = renderSongHubPage;

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
          <div id="purchaseHostedWalletWrap" class="checkout-wallet-wrap" style="display:none;">
            <button type="button" class="icon-btn checkout-hosted-wallet-btn" id="purchaseHostedWalletBtn">Continue to secure wallet checkout</button>
            <div class="checkout-wallet-divider">opens secure Stripe checkout</div>
          </div>
          <div id="purchaseWalletHint" class="checkout-wallet-hint" style="display:none;"></div>
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
  document.getElementById('purchaseHostedWalletBtn').addEventListener('click', startHostedWalletCheckout);
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
  const hasItems = getCartItems().length > 0;
  float.classList.toggle('site-cart-btn--hidden', !hasItems);
  float.setAttribute('aria-hidden', hasItems ? 'false' : 'true');
}

window.updateCartFloat = updateCartFloat;

function addTinCanToCart() {
  const cart = getCartItems();
  if (cart.some((item) => item.id === 'seltzer-can')) {
    alert('already in cart.');
    return;
  }
  cart.push({
    id: 'seltzer-can',
    name: 'tin can',
    price: 1,
    qty: 1,
    image: 'IMAGES/tin-can.png',
    requiresShipping: 'true',
  });
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartFloat();
  if (typeof openCheckoutPopup === 'function') {
    openCheckoutPopup('cart');
  }
}

window.addTinCanToCart = addTinCanToCart;

function removeCartItemAt(rawIndex) {
  const idx = Math.floor(Number(rawIndex));
  const cart = getCartItems();
  if (!Number.isFinite(idx) || idx < 0 || idx >= cart.length) return;
  cart.splice(idx, 1);
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartFloat();
  window.dispatchEvent(new CustomEvent('burnfolder-cart-changed'));

  const overlay = document.getElementById('purchaseOverlay');
  const popupOpen = overlay && overlay.classList.contains('open') && checkoutMode === 'cart';
  if (popupOpen) {
    if (cart.length === 0) {
      closeCheckoutPopup();
    } else {
      renderCheckoutSummary();
    }
  }
}

window.removeCartItemAt = removeCartItemAt;

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

    summary.innerHTML = '';
    if (cart.length === 0) {
      summary.innerHTML = '<p class="checkout-popup-line">Your cart is empty.</p>';
    } else {
      const title = document.createElement('p');
      title.className = 'checkout-popup-title';
      title.textContent = 'Your Cart';
      summary.appendChild(title);

      cart.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'checkout-popup-line checkout-popup-cart-row';

        const info = document.createElement('span');
        info.className = 'checkout-popup-cart-info';
        info.textContent = `${item.name} x${item.qty} - $${item.price * item.qty}`;

        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'icon-btn checkout-cart-remove';
        rm.textContent = 'remove';
        rm.setAttribute('aria-label', `remove ${item.name} from cart`);
        rm.addEventListener('click', () => removeCartItemAt(i));

        row.appendChild(info);
        row.appendChild(rm);
        summary.appendChild(row);
      });

      const tot = document.createElement('div');
      tot.className = 'checkout-popup-total';
      tot.textContent = `Total: $${total}`;
      summary.appendChild(tot);
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

function setHostedWalletVisibility(visible) {
  const hostedWrap = document.getElementById('purchaseHostedWalletWrap');
  if (hostedWrap) hostedWrap.style.display = visible ? 'block' : 'none';
}

function setWalletHint(message) {
  const hint = document.getElementById('purchaseWalletHint');
  if (!hint) return;

  const text = String(message || '').trim();
  hint.textContent = text;
  hint.style.display = text ? 'block' : 'none';
}

async function startHostedWalletCheckout() {
  const status = document.getElementById('purchaseStatus');
  const errors = document.getElementById('purchaseCardErrors');
  const hostedBtn = document.getElementById('purchaseHostedWalletBtn');

  if (errors) errors.textContent = '';
  if (status) status.textContent = 'Redirecting to secure checkout...';
  if (hostedBtn) hostedBtn.disabled = true;

  try {
    let endpoint = '';
    let payload = {};

    if (checkoutMode === 'tip') {
      endpoint = '/.netlify/functions/create-tip-checkout-session';
      payload = { amount: checkoutTipAmount };
    } else {
      const cart = getCartItems();
      if (cart.length === 0) throw new Error('Your cart is empty.');
      endpoint = '/.netlify/functions/create-checkout-session';
      payload = { cart };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || (!data.id && !data.url)) {
      throw new Error(data.error || 'Could not start secure checkout.');
    }

    if (data.url && /^https:\/\//i.test(data.url)) {
      window.location.href = data.url;
      return;
    }

    throw new Error('Secure checkout URL unavailable. Please try again.');
  } catch (err) {
    if (status) status.textContent = '';
    if (errors) errors.textContent = err.message || 'Wallet checkout unavailable.';
    if (hostedBtn) hostedBtn.disabled = false;
  }
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
  setHostedWalletVisibility(false);
  setWalletHint('');
  resetCheckoutWalletButton();

  try {
    await loadStripeScript();
  } catch {
    setHostedWalletVisibility(true);
    setWalletHint('Quick wallet is unavailable in this browser context. Use secure wallet checkout.');
    return;
  }

  if (!stripeClient) {
    setHostedWalletVisibility(true);
    setWalletHint('Quick wallet is unavailable in this browser context. Use secure wallet checkout.');
    return;
  }

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
    requestShipping: checkoutMode === 'cart'
  });

  const canMakePayment = await checkoutPaymentRequest.canMakePayment();
  if (!canMakePayment) {
    setHostedWalletVisibility(true);
    setWalletHint('Apple Pay / Google Pay is not available in this browser. Use secure wallet checkout.');
    return;
  }

  setWalletHint('');

  try {
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
  } catch {
    setHostedWalletVisibility(true);
    setWalletHint('Quick wallet could not initialize here. Use secure wallet checkout.');
    if (status) status.textContent = 'Quick wallet unavailable in this checkout context.';
    return;
  }

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
  setHostedWalletVisibility(false);
  setWalletHint('');
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

let activeIdx = null;
let activeSongOverride = null;

function getActiveSong() {
  if (activeIdx === null) return null;
  if (activeIdx >= 0 && window.currentSongs[activeIdx]) return window.currentSongs[activeIdx];
  return activeSongOverride;
}

createTipUI();
createVersionPickerUI();
renderSongHubPage();

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
    let songIndex = window.currentSongs.findIndex(s => s.playbackId === state.playbackId);
    const fallbackSong = songIndex === -1 && Array.isArray(window.allSongs)
      ? window.allSongs.find(s => s.playbackId === state.playbackId)
      : null;
    if (songIndex !== -1) {
      activeSongOverride = null;
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
    } else if (fallbackSong) {
      activeSongOverride = fallbackSong;
      activeIdx = -1;
      setTimeout(() => {
        activeMuxPlayer.setAttribute('playback-id', fallbackSong.playbackId);
        activeMuxPlayer.setAttribute('metadata-video-title', fallbackSong.title);
        activeMuxPlayer.addEventListener('loadedmetadata', () => {
          activeMuxPlayer.currentTime = state.currentTime || 0;
          if (state.isPlaying) {
            activeMuxPlayer.play().catch(() => {
              console.log('Auto-play prevented');
            });
          }
          updateUI();
          initializeVolumeControl();
        }, { once: true });
      }, 50);
    } else {
      // If the saved song is not valid for this page, reset player state
      activeIdx = null;
      activeSongOverride = null;
      if (window.globalMuxPlayer) {
        window.globalMuxPlayer.pause();
        window.globalMuxPlayer.removeAttribute('playback-id');
      }
      updateUI();
    }
  } catch (e) {
    console.error('Failed to restore playback state:', e);
  }
}

// Save playback state before page unload
window.addEventListener('beforeunload', () => {
  const activeSong = getActiveSong();
  if (activeIdx !== null && activeMuxPlayer && activeSong) {
    const state = {
      playbackId: activeSong.playbackId,
      title: activeSong.title,
      currentTime: activeMuxPlayer.currentTime || 0,
      isPlaying: !activeMuxPlayer.paused
    };
    sessionStorage.setItem('playbackState', JSON.stringify(state));
  }
});

// Update playback state periodically
setInterval(() => {
  const activeSong = getActiveSong();
  if (activeIdx !== null && activeMuxPlayer && activeSong) {
    const state = {
      playbackId: activeSong.playbackId,
      title: activeSong.title,
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
    nameSpan.className = 'audio-track-name';
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
    el.classList.toggle('active', i === activeIdx && activeIdx >= 0 && !activeMuxPlayer.paused);
  });
  const activeSong = getActiveSong();
  if (activeIdx !== null && activeSong) {
    if (!activeMuxPlayer.paused) {
      bottomPlayBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/></svg>';
    } else {
      bottomPlayBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="6,4 20,12 6,20" fill="currentColor"/></svg>';
    }
    songTitleEl.textContent = activeSong.title;
    songTitleEl.setAttribute('aria-label', `menu for ${activeSong.title}`);
    renderVersionPicker();
    bottomBar.style.display = 'block';
    bottomPlayBtn.focus();
  } else {
    closeVersionPicker();
    bottomBar.style.display = 'none';
    songTitleEl.textContent = '';
  }
  syncPlaybackChromeState();
}

function syncPlaybackChromeState() {
  const activeSong = getActiveSong();
  const barOn = bottomBar && bottomBar.style.display === 'block';
  const playing =
    activeIdx !== null &&
    activeSong &&
    barOn &&
    !activeMuxPlayer.paused;
  document.body.classList.toggle('playback-playing', !!playing);
}

window.syncPlaybackChromeState = syncPlaybackChromeState;

function playTrack(idx) {
  activeSongOverride = null;
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
    activeSongOverride = null;
    sessionStorage.removeItem('playbackState');
    closeVersionPicker();
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
  progressEl.style.width = '0%';
  const nextIdx = activeIdx !== null && activeIdx >= 0 ? activeIdx + 1 : null;
  if (nextIdx !== null && nextIdx < window.currentSongs.length) {
    playTrack(nextIdx);
    return;
  }
  updateUI();
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
  const activeSong = getActiveSong();
  if (activeSong) {
    console.warn(`Failed to load "${activeSong.title}".`, activeSong.playbackId);
  }
  const nextIdx = activeIdx !== null && activeIdx >= 0 ? activeIdx + 1 : null;
  if (nextIdx !== null && nextIdx < window.currentSongs.length) {
    playTrack(nextIdx);
    return;
  }
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
