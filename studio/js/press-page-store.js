(function (root) {
  'use strict';

  const STORAGE_KEY = 'burnfolderStudioPressPage';
  const CLOUD_KEY = 'pressPage';

  function makeId(prefix) {
    return (prefix || 'item') + '-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
  }

  function readStore() {
    try {
      const raw = root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 1, page: null };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { version: 1, page: null };
      return parsed;
    } catch (e) {
      return { version: 1, page: null };
    }
  }

  function writeStore(store) {
    root.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    const cs = root.BurnfolderCloudState;
    if (cs && cs.put) cs.put(CLOUD_KEY, store);
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
        if (value && value.page && typeof value.page === 'object') {
          root.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
          root.dispatchEvent(new CustomEvent('burnfolder-press-page-synced'));
        } else if (value === null) {
          const local = readStore();
          if (local.page && cs.put) cs.put(CLOUD_KEY, local);
        }
      })
      .catch(function () {});
    return hydratePromise;
  }

  function normalizeLinkRow(item) {
    if (!item || typeof item !== 'object') return null;
    return {
      id: item.id || makeId('link'),
      label: String(item.label || '').trim(),
      href: String(item.href || '').trim(),
      pending: !!item.pending
    };
  }

  function normalizeAssetRow(item) {
    if (!item || typeof item !== 'object') return null;
    return {
      id: item.id || makeId('asset'),
      label: String(item.label || '').trim(),
      href: String(item.href || '').trim(),
      pending: !!item.pending,
      download: !!item.download
    };
  }

  function emptyPage() {
    return {
      pressPhoto: '',
      bio: '',
      releaseLine: '',
      pullQuote: '',
      contactEmail: '',
      links: [],
      assets: [],
      published: false,
      updatedAt: new Date().toISOString()
    };
  }

  function normalizePage(page) {
    const base = emptyPage();
    if (!page || typeof page !== 'object') return base;
    const bio =
      typeof page.bio === 'string'
        ? page.bio.trim()
        : typeof page.artist === 'string'
          ? page.artist.trim()
          : '';
    return {
      pressPhoto: typeof page.pressPhoto === 'string' ? page.pressPhoto.trim() : '',
      bio: bio,
      releaseLine: typeof page.releaseLine === 'string' ? page.releaseLine.trim() : '',
      pullQuote: typeof page.pullQuote === 'string' ? page.pullQuote.trim() : '',
      contactEmail: typeof page.contactEmail === 'string' ? page.contactEmail.trim() : '',
      links: Array.isArray(page.links)
        ? page.links.map(normalizeLinkRow).filter(Boolean)
        : [],
      assets: Array.isArray(page.assets)
        ? page.assets.map(normalizeAssetRow).filter(Boolean)
        : [],
      published: !!page.published,
      updatedAt: page.updatedAt || base.updatedAt
    };
  }

  function hasContent(page) {
    const p = normalizePage(page);
    if (
      p.pressPhoto ||
      p.bio ||
      p.releaseLine ||
      p.pullQuote ||
      p.contactEmail
    ) {
      return true;
    }
    return (
      p.links.some(function (row) {
        return !!row.label;
      }) ||
      p.assets.some(function (row) {
        return !!row.label;
      })
    );
  }

  function getPublishedPage() {
    const published = root.burnfolderPressPage;
    if (!published || typeof published !== 'object') return null;
    return normalizePage(published);
  }

  function getPage() {
    return ensureHydrated().then(function () {
      const store = readStore();
      return normalizePage(store.page);
    });
  }

  function savePage(patch) {
    return ensureHydrated().then(function () {
      const store = readStore();
      const current = normalizePage(store.page);
      const next = normalizePage(
        Object.assign({}, current, patch || {}, {
          updatedAt: new Date().toISOString()
        })
      );
      if (hasContent(next)) next.published = true;
      store.page = next;
      writeStore(store);
      return next;
    });
  }

  function resolvePage(preferStudio) {
    if (preferStudio) {
      return getPage().then(function (studioPage) {
        if (hasContent(studioPage)) return studioPage;
        const pub = getPublishedPage();
        return pub || studioPage;
      });
    }
    const pub = getPublishedPage();
    if (pub && hasContent(pub)) return Promise.resolve(pub);
    return getPage();
  }

  function getPublishedPayload() {
    const store = readStore();
    const page = normalizePage(store.page);
    if (!page.published || !hasContent(page)) return null;
    return {
      pressPhoto: page.pressPhoto,
      bio: page.bio,
      releaseLine: page.releaseLine,
      pullQuote: page.pullQuote,
      contactEmail: page.contactEmail,
      links: page.links.map(function (row) {
        return {
          label: row.label,
          href: row.href,
          pending: row.pending
        };
      }),
      assets: page.assets.map(function (row) {
        return {
          label: row.label,
          href: row.href,
          pending: row.pending,
          download: row.download
        };
      }),
      updatedAt: page.updatedAt
    };
  }

  function setPendingPhoto(asset) {
    return ensureHydrated().then(function () {
      const store = readStore();
      store.pendingPhoto = asset || null;
      writeStore(store);
      return store.pendingPhoto;
    });
  }

  function getPendingPhoto() {
    return ensureHydrated().then(function () {
      return readStore().pendingPhoto || null;
    });
  }

  function clearPendingPhoto() {
    return setPendingPhoto(null);
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

  function pushToSite() {
    return ensureHydrated().then(function () {
      const page = getPublishedPayload();
      if (!page) {
        return Promise.reject(new Error('nothing to push — add press page content first'));
      }

      const authReady =
        root.BurnfolderStudioAuth && root.BurnfolderStudioAuth.whenReady
          ? root.BurnfolderStudioAuth.whenReady()
          : Promise.resolve();

      return authReady
        .then(function () {
          return getPendingPhoto();
        })
        .then(function (pendingPhoto) {
          const body = { page: page };
          if (pendingPhoto && pendingPhoto.path && pendingPhoto.base64) {
            body.photoAsset = {
              path: pendingPhoto.path,
              base64: pendingPhoto.base64
            };
          }
          return root.fetch(getFunctionsBase() + '/studio-publish-press-page', {
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
              root.burnfolderPressPage = page;
              return clearPendingPhoto().then(function () {
                return data;
              });
            });
        });
    });
  }

  root.BurnfolderPressPageStore = {
    makeId: makeId,
    emptyPage: emptyPage,
    normalizePage: normalizePage,
    normalizeLinkRow: normalizeLinkRow,
    normalizeAssetRow: normalizeAssetRow,
    hasContent: hasContent,
    ensureHydrated: ensureHydrated,
    getPage: getPage,
    savePage: savePage,
    getPublishedPage: getPublishedPage,
    resolvePage: resolvePage,
    getPublishedPayload: getPublishedPayload,
    setPendingPhoto: setPendingPhoto,
    getPendingPhoto: getPendingPhoto,
    clearPendingPhoto: clearPendingPhoto,
    fileToBase64: fileToBase64,
    pushToSite: pushToSite
  };
})(typeof window !== 'undefined' ? window : globalThis);
