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

  function apply(rootEl, opts) {
    if (!rootEl) return;
    opts = opts || {};
    rootEl.innerHTML = '';

    const products = getActiveProducts();
    if (!products.length) {
      const empty = document.createElement('p');
      empty.className = 'page-annotation';
      empty.textContent = 'nothing for sale yet.';
      rootEl.appendChild(empty);
      return;
    }

    products.forEach(function (product) {
      rootEl.appendChild(renderProductCard(product, opts));
    });
  }

  root.BurnfolderShopProductsRender = {
    getCatalog: getCatalog,
    getActiveProducts: getActiveProducts,
    getProductById: getProductById,
    formatMoney: formatMoney,
    renderProductCard: renderProductCard,
    apply: apply
  };
})(typeof window !== 'undefined' ? window : globalThis);
