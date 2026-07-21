(function (root) {
  'use strict';

  const STORAGE_KEY = 'burnfolderStudioShopProducts';
  const CLOUD_KEY = 'shopProducts';

  function makeId(prefix) {
    return (prefix || 'item') + '-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
  }

  function sanitizeId(raw) {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  function readStore() {
    try {
      const raw = root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 1, catalog: null, pendingCover: null };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { version: 1, catalog: null, pendingCover: null };
      return parsed;
    } catch (e) {
      return { version: 1, catalog: null, pendingCover: null };
    }
  }

  function writeStore(store) {
    root.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    const cs = root.BurnfolderCloudState;
    if (cs && cs.put) {
      const cloudSafe = {
        version: store.version || 1,
        catalog: store.catalog,
        pendingCover: null
      };
      cs.put(CLOUD_KEY, cloudSafe);
    }
  }

  let hydratePromise = null;
  function ensureHydrated() {
    if (hydratePromise) return hydratePromise;
    const cs = root.BurnfolderCloudState;
    if (!cs || !cs.get) {
      hydratePromise = Promise.resolve();
      return hydratePromise;
    }
    hydratePromise = cs
      .get(CLOUD_KEY)
      .then(function (value) {
        if (value && value.catalog && typeof value.catalog === 'object') {
          const local = readStore();
          const merged = {
            version: 1,
            catalog: value.catalog,
            pendingCover: local.pendingCover || null
          };
          root.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          root.dispatchEvent(new CustomEvent('burnfolder-shop-products-synced'));
        } else if (value === null) {
          const local = readStore();
          if (local.catalog && cs.put) {
            cs.put(CLOUD_KEY, { version: 1, catalog: local.catalog, pendingCover: null });
          }
        }
      })
      .catch(function () {});
    return hydratePromise;
  }

  function emptyProduct() {
    return {
      id: 'photonegative-digital',
      title: 'PHOTO NEGATIVE',
      subtitle: 'digital album — four songs',
      blurb: 'pay what you want. download after checkout.',
      coverArt: 'IMAGES/PHOTO-NEGATIVE-COVER.png',
      downloadHref: '',
      minAmount: 1,
      suggestedAmounts: [5, 10, 15],
      maxAmount: 500,
      active: true,
      updatedAt: new Date().toISOString()
    };
  }

  function emptyCatalog() {
    return {
      products: [emptyProduct()],
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeAmounts(list) {
    const src = Array.isArray(list) ? list : [5, 10, 15];
    const out = [];
    src.forEach(function (n) {
      const num = Math.round(Number(n) * 100) / 100;
      if (!Number.isFinite(num) || num < 1 || num > 500) return;
      if (out.indexOf(num) === -1) out.push(num);
    });
    return out.length ? out.slice(0, 6) : [5, 10, 15];
  }

  function normalizeProduct(product) {
    const base = emptyProduct();
    if (!product || typeof product !== 'object') return base;
    const id = sanitizeId(product.id) || base.id;
    const minAmount = Math.max(1, Math.min(500, Number(product.minAmount) || 1));
    const maxAmount = Math.max(minAmount, Math.min(500, Number(product.maxAmount) || 500));
    return {
      id: id,
      title: typeof product.title === 'string' ? product.title.trim() : '',
      subtitle: typeof product.subtitle === 'string' ? product.subtitle.trim() : '',
      blurb: typeof product.blurb === 'string' ? product.blurb.trim() : '',
      coverArt: typeof product.coverArt === 'string' ? product.coverArt.trim() : '',
      downloadHref: typeof product.downloadHref === 'string' ? product.downloadHref.trim() : '',
      minAmount: minAmount,
      suggestedAmounts: normalizeAmounts(product.suggestedAmounts),
      maxAmount: maxAmount,
      active: product.active !== false,
      updatedAt: product.updatedAt || base.updatedAt
    };
  }

  function normalizeCatalog(catalog) {
    if (!catalog || typeof catalog !== 'object') return emptyCatalog();
    const products = Array.isArray(catalog.products)
      ? catalog.products.map(normalizeProduct).filter(function (p) {
          return !!p.title;
        })
      : [];
    return {
      products: products.length ? products : [emptyProduct()],
      updatedAt: catalog.updatedAt || new Date().toISOString()
    };
  }

  function hasContent(catalog) {
    const c = normalizeCatalog(catalog);
    return c.products.some(function (p) {
      return !!p.title;
    });
  }

  function getPublishedCatalog() {
    const published = root.burnfolderShopProducts;
    if (!published || typeof published !== 'object') return null;
    return normalizeCatalog(published);
  }

  function getCatalog() {
    return ensureHydrated().then(function () {
      const store = readStore();
      return normalizeCatalog(store.catalog);
    });
  }

  function saveCatalog(patch) {
    return ensureHydrated().then(function () {
      const store = readStore();
      const next = normalizeCatalog(
        Object.assign({}, store.catalog || emptyCatalog(), patch || {}, {
          updatedAt: new Date().toISOString()
        })
      );
      store.catalog = next;
      writeStore(store);
      return next;
    });
  }

  function saveProduct(product) {
    return ensureHydrated().then(function () {
      const store = readStore();
      const catalog = normalizeCatalog(store.catalog);
      const nextProduct = normalizeProduct(
        Object.assign({}, product || {}, { updatedAt: new Date().toISOString() })
      );
      const idx = catalog.products.findIndex(function (p) {
        return p.id === nextProduct.id;
      });
      if (idx >= 0) catalog.products[idx] = nextProduct;
      else catalog.products = [nextProduct].concat(catalog.products);
      catalog.updatedAt = new Date().toISOString();
      store.catalog = catalog;
      writeStore(store);
      return nextProduct;
    });
  }

  function setPendingCover(asset) {
    return ensureHydrated().then(function () {
      const store = readStore();
      store.pendingCover = asset || null;
      writeStore(store);
      return store.pendingCover;
    });
  }

  function getPendingCover() {
    return ensureHydrated().then(function () {
      return readStore().pendingCover || null;
    });
  }

  function clearPendingCover() {
    return setPendingCover(null);
  }

  function resolveCatalog(preferStudio) {
    if (preferStudio) {
      return getCatalog().then(function (studioCatalog) {
        if (hasContent(studioCatalog)) return studioCatalog;
        const pub = getPublishedCatalog();
        return pub || studioCatalog;
      });
    }
    const pub = getPublishedCatalog();
    if (pub && hasContent(pub)) return Promise.resolve(pub);
    return getCatalog();
  }

  function getPublishedPayload() {
    const store = readStore();
    const catalog = normalizeCatalog(store.catalog);
    if (!hasContent(catalog)) return null;
    return {
      products: catalog.products.map(function (p) {
        return {
          id: p.id,
          title: p.title,
          subtitle: p.subtitle,
          blurb: p.blurb,
          coverArt: p.coverArt,
          downloadHref: p.downloadHref,
          minAmount: p.minAmount,
          suggestedAmounts: p.suggestedAmounts,
          maxAmount: p.maxAmount,
          active: p.active,
          updatedAt: p.updatedAt
        };
      }),
      updatedAt: catalog.updatedAt
    };
  }

  function getFunctionsBase() {
    const cs = root.BurnfolderCloudState;
    if (cs && cs.getFunctionsBase) return cs.getFunctionsBase();
    const cfg = root.BurnfolderStudioConfig || {};
    if (cfg.muxApiBase) return String(cfg.muxApiBase).replace(/\/$/, '');
    const host = root.location && root.location.hostname;
    const port = root.location && root.location.port;
    const isLocalDevServer =
      (host === 'localhost' || host === '127.0.0.1') && port && port !== '8888';
    if (isLocalDevServer) return 'http://localhost:8888/.netlify/functions';
    return '/.netlify/functions';
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = function () {
        reject(new Error('could not read file'));
      };
      reader.readAsDataURL(file);
    });
  }

  function pushToSite() {
    return ensureHydrated().then(function () {
      const catalog = getPublishedPayload();
      if (!catalog) {
        return Promise.reject(new Error('nothing to push — add a product first'));
      }

      const authReady =
        root.BurnfolderStudioAuth && root.BurnfolderStudioAuth.whenReady
          ? root.BurnfolderStudioAuth.whenReady()
          : Promise.resolve();

      return authReady
        .then(function () {
          return getPendingCover();
        })
        .then(function (pendingCover) {
          const body = { catalog: catalog };
          if (pendingCover && pendingCover.path && pendingCover.base64) {
            body.coverAsset = {
              path: pendingCover.path,
              base64: pendingCover.base64
            };
          }
          return root.fetch(getFunctionsBase() + '/studio-publish-shop-products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
        })
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (data) {
              if (!res.ok) {
                const msg = (data && data.message) || 'push failed (' + res.status + ')';
                return Promise.reject(new Error(msg));
              }
              root.burnfolderShopProducts = catalog;
              return clearPendingCover().then(function () {
                return data;
              });
            });
        });
    });
  }

  root.BurnfolderShopProductsStore = {
    makeId: makeId,
    sanitizeId: sanitizeId,
    emptyProduct: emptyProduct,
    emptyCatalog: emptyCatalog,
    normalizeProduct: normalizeProduct,
    normalizeCatalog: normalizeCatalog,
    hasContent: hasContent,
    ensureHydrated: ensureHydrated,
    getCatalog: getCatalog,
    saveCatalog: saveCatalog,
    saveProduct: saveProduct,
    getPublishedCatalog: getPublishedCatalog,
    resolveCatalog: resolveCatalog,
    getPublishedPayload: getPublishedPayload,
    setPendingCover: setPendingCover,
    getPendingCover: getPendingCover,
    clearPendingCover: clearPendingCover,
    fileToBase64: fileToBase64,
    pushToSite: pushToSite
  };
})(typeof window !== 'undefined' ? window : globalThis);
