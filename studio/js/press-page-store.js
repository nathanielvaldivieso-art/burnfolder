(function (root) {
  'use strict';

  const kit = root.BurnfolderCloudStoreKit;
  const cloudStore = kit.createLocalCloudStore({
    storageKey: 'burnfolderStudioPressPage',
    cloudKey: 'pressPage',
    emptyState: function () {
      return { version: 1, page: null };
    },
    isValidCloudValue: function (value) {
      return !!(value.page && typeof value.page === 'object');
    },
    hasLocalContent: function (local) {
      return !!local.page;
    },
    syncEventName: 'burnfolder-press-page-synced',
    toCloudValue: function (store) {
      return {
        version: store.version || 1,
        page: store.page,
        pendingPhoto: null
      };
    }
  });
  const readStore = cloudStore.readStore;
  const writeStore = cloudStore.writeStore;
  const ensureHydrated = cloudStore.ensureHydrated;
  const makeId = kit.makeId;
  const getFunctionsBase = kit.getFunctionsBase;
  const fileToBase64 = kit.fileToBase64;

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
