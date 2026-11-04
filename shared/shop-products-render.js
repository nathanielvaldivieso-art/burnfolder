(function (root) {
  'use strict';

  function getCatalog() {
    const data = root.burnfolderShopProducts;
    if (!data || typeof data !== 'object') return { products: [] };
    return data;
  }

  function getActiveProducts() {
    const products = Array.isArray(getCatalog().products) ? getCatalog().products : [];
    return products.filter(function (p) {
      return p && p.active !== false && p.title;
    });
  }

  function getProductById(id) {
    const key = String(id || '').trim();
    if (!key) return null;
    const products = Array.isArray(getCatalog().products) ? getCatalog().products : [];
    for (let i = 0; i < products.length; i++) {
      if (products[i] && products[i].id === key) return products[i];
    }
    return null;
  }

  function formatMoney(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return '0';
    return Number.isInteger(num) ? String(num) : num.toFixed(2);
  }

  function renderProductCard(product, opts) {
    opts = opts || {};
    const article = document.createElement('article');
    article.className = 'shop-product';
    article.dataset.productId = product.id || '';

    if (product.coverArt) {
      const img = document.createElement('img');
      img.className = 'shop-product-cover';
      img.src = product.coverArt;
      img.alt = product.title || '';
      article.appendChild(img);
    }

    const title = document.createElement('p');
    title.className = 'shop-product-title';
    title.textContent = product.title || '';
    article.appendChild(title);

    if (product.subtitle) {
      const sub = document.createElement('p');
      sub.className = 'shop-product-subtitle';
      sub.textContent = product.subtitle;
      article.appendChild(sub);
    }

    if (product.blurb) {
      const blurb = document.createElement('p');
      blurb.className = 'shop-product-blurb';
      blurb.textContent = product.blurb;
      article.appendChild(blurb);
    }

    const amounts = Array.isArray(product.suggestedAmounts) && product.suggestedAmounts.length
      ? product.suggestedAmounts
      : [5, 10, 15];

    const actions = document.createElement('div');
    actions.className = 'shop-product-actions';

    amounts.forEach(function (amount) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-btn shop-amount-btn';
      btn.textContent = '$' + formatMoney(amount);
      btn.addEventListener('click', function () {
        if (typeof opts.onBuy === 'function') opts.onBuy(product, amount);
      });
      actions.appendChild(btn);
    });

    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'icon-btn shop-amount-btn';
    customBtn.textContent = 'other';
    customBtn.addEventListener('click', function () {
      if (typeof opts.onCustom === 'function') opts.onCustom(product);
    });
    actions.appendChild(customBtn);

    article.appendChild(actions);

    const min = Number(product.minAmount) || 1;
    const note = document.createElement('p');
    note.className = 'shop-product-note';
    note.textContent = 'minimum $' + formatMoney(min);
    article.appendChild(note);

    return article;
  }

  var MIN_OFFER = 0.5;
  var MAX_OFFER = 999999.99;

  function labeled(text, control) {
    var label = document.createElement('label');
    label.className = 'checkout-label';
    label.appendChild(document.createTextNode(text));
    label.appendChild(control);
    return label;
  }

  function renderHoursCard(opts) {
    opts = opts || {};
    var onBook = typeof opts.onBook === 'function' ? opts.onBook : function () {};
    var article = document.createElement('div');
    article.className = 'shop-board-item shop-hours';
    article.dataset.productId = 'hours';

    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'shop-hours-block';
    tile.setAttribute('aria-expanded', 'false');
    var tileTitle = document.createElement('span');
    tileTitle.className = 'shop-hours-block-title';
    tileTitle.textContent = 'hours of my time';
    tile.appendChild(tileTitle);
    article.appendChild(tile);

    var panel = document.createElement('form');
    panel.className = 'shop-hours-panel';
    panel.id = 'shopHoursPanel';
    panel.hidden = true;
    panel.noValidate = true;
    tile.setAttribute('aria-controls', panel.id);
    tile.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      tile.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
      article.classList.toggle('is-open', !panel.hidden);
    });

    var pitch = document.createElement('textarea');
    pitch.className = 'checkout-input';
    pitch.name = 'pitch';
    pitch.rows = 5;
    pitch.maxLength = 1500;
    panel.appendChild(labeled('pitch', pitch));

    var links = document.createElement('textarea');
    links.className = 'checkout-input';
    links.name = 'links';
    links.rows = 3;
    links.maxLength = 1000;
    panel.appendChild(labeled('links', links));

    var offer = document.createElement('input');
    offer.className = 'checkout-input';
    offer.type = 'number';
    offer.name = 'offer';
    offer.min = String(MIN_OFFER);
    offer.step = '0.01';
    offer.inputMode = 'decimal';
    offer.placeholder = '$ (if applicable)';
    offer.setAttribute('aria-label', 'offer');
    panel.appendChild(offer);

    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'icon-btn shop-amount-btn';
    submit.setAttribute('aria-label', 'send');
    submit.textContent = '\u2192';
    panel.appendChild(submit);

    function flag(field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }

    panel.addEventListener('input', function (e) {
      e.target.removeAttribute('aria-invalid');
    });

    panel.addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = String(offer.value || '').trim();
      var amount = raw === '' ? null : Number(raw);
      if (!pitch.value.trim()) {
        flag(pitch);
        return;
      }
      if (amount !== null && (!Number.isFinite(amount) || amount < MIN_OFFER || amount > MAX_OFFER)) {
        flag(offer);
        return;
      }
      onBook({ amount: amount === null ? '' : Math.round(amount * 100) / 100, pitch: pitch.value.trim(), links: links.value.trim() });
    });

    article.appendChild(panel);
    return article;
  }

  function bookHours(offer) {
    if (typeof root.openBookingCheckout === 'function') {
      root.openBookingCheckout(offer);
    }
  }

  function apply(rootEl, opts) {
    if (!rootEl) return;
    opts = opts || {};
    rootEl.innerHTML = '';

    const products = getActiveProducts();
    if (!products.length) {
      // Keep the page blank when no products are active.
      return;
    }

    products.forEach(function (product) {
      rootEl.appendChild(renderProductCard(product, opts));
    });
  }

  function promptCustomAmount(product) {
    const bounds = {
      min: Number(product.minAmount) || 1,
      max: Number(product.maxAmount) || 500
    };
    const raw = root.prompt(
      'amount ($' + bounds.min + '–$' + bounds.max + ')',
      String(product.suggestedAmounts && product.suggestedAmounts[0] ? product.suggestedAmounts[0] : bounds.min)
    );
    if (raw == null) return;
    if (typeof root.openDigitalCheckout === 'function') {
      root.openDigitalCheckout(product, raw);
    }
  }

  function mountShopProducts() {
    const rootEl = root.document && root.document.getElementById('shopProductsRoot');
    if (!rootEl) return;
    apply(rootEl, {
      onBuy: function (product, amount) {
        if (typeof root.openDigitalCheckout === 'function') {
          root.openDigitalCheckout(product, amount);
        }
      },
      onCustom: promptCustomAmount
    });
    var board = root.document.createElement('div');
    board.className = 'shop-board';
    board.appendChild(renderHoursCard({ onBook: bookHours }));
    rootEl.appendChild(board);
  }

  if (typeof root.document !== 'undefined') {
    if (root.document.readyState !== 'loading') {
      mountShopProducts();
    } else {
      root.document.addEventListener('DOMContentLoaded', mountShopProducts);
    }
    root.addEventListener('burnfolder-spa-navigated', mountShopProducts);
  }

  root.BurnfolderShopProductsRender = {
    getCatalog: getCatalog,
    getActiveProducts: getActiveProducts,
    getProductById: getProductById,
    formatMoney: formatMoney,
    renderProductCard: renderProductCard,
    renderHoursCard: renderHoursCard,
    apply: apply,
    init: mountShopProducts
  };
})(typeof window !== 'undefined' ? window : globalThis);
