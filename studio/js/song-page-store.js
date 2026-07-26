(function (root) {
  'use strict';

  const kit = root.BurnfolderCloudStoreKit;
  const cloudStore = kit.createLocalCloudStore({
    storageKey: 'burnfolderStudioSongPages',
    cloudKey: 'songPages',
    emptyState: function () {
      return { version: 1, pages: {} };
    },
    isValidLocal: function (parsed) {
      return typeof parsed.pages === 'object';
    },
    isValidCloudValue: function (value) {
      return !!(value.pages && typeof value.pages === 'object');
    },
    hasLocalContent: function (local) {
      return Object.keys(local.pages).length;
    },
    syncEventName: 'burnfolder-song-pages-synced'
  });
  const readStore = cloudStore.readStore;
  const writeStore = cloudStore.writeStore;
  const ensureHydrated = cloudStore.ensureHydrated;
  const makeId = kit.makeId;
  const getFunctionsBase = kit.getFunctionsBase;

  function emptyPage(groupKey) {
    return {
      groupKey: groupKey,
      notes: '',
      lyrics: '',
      versions: {},
      heroVideoPlaybackId: '',
      coverArt: '',
      coverAssetId: '',
      media: [],
      published: false,
      updatedAt: new Date().toISOString()
    };
  }

  function resolveNotes(page) {
    if (!page) return '';
    if (typeof page.notes === 'string' && page.notes.trim()) return page.notes.trim();
    if (typeof page.backstory === 'string' && page.backstory.trim()) return page.backstory.trim();
    return '';
  }

  function normalizeVersionEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return { lyrics: '', notes: '' };
    }
    return {
      lyrics: typeof entry.lyrics === 'string' ? entry.lyrics : '',
      notes: typeof entry.notes === 'string' ? entry.notes : ''
    };
  }

  function normalizeVersions(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (id) {
      const key = String(id || '').trim();
      if (!key) return;
      out[key] = normalizeVersionEntry(raw[id]);
    });
    return out;
  }

  function versionHasContent(entry) {
    const row = normalizeVersionEntry(entry);
    return !!(row.lyrics.trim() || row.notes.trim());
  }

  function normalizeMediaItem(item) {
    if (!item || typeof item !== 'object') return null;
    const kind = String(item.kind || 'note').trim();
    return {
      id: item.id || makeId('media'),
      kind: kind,
      title: String(item.title || '').trim(),
      playbackId: String(item.playbackId || '').trim(),
      href: String(item.href || '').trim(),
      text: String(item.text || '').trim(),
      imageData: String(item.imageData || '').trim()
    };
  }

  function versionsHaveLyrics(versions) {
    return Object.keys(versions || {}).some(function (id) {
      return normalizeVersionEntry(versions[id]).lyrics.trim();
    });
  }

  function normalizePage(groupKey, page) {
    const key = String(groupKey || (page && page.groupKey) || '')
      .toLowerCase()
      .trim();
    const base = emptyPage(key);
    if (!page || typeof page !== 'object') return base;
    const versions = normalizeVersions(page.versions);
    const legacyLyrics = typeof page.lyrics === 'string' ? page.lyrics.trim() : '';
    return {
      groupKey: key,
      notes: resolveNotes(page),
      lyrics: legacyLyrics && !versionsHaveLyrics(versions) ? legacyLyrics : '',
      versions: versions,
      heroVideoPlaybackId: String(page.heroVideoPlaybackId || '').trim(),
      coverArt: String(page.coverArt || '').trim(),
      coverAssetId: String(page.coverAssetId || '').trim(),
      media: Array.isArray(page.media)
        ? page.media.map(normalizeMediaItem).filter(Boolean)
        : [],
      published: !!page.published,
      updatedAt: page.updatedAt || base.updatedAt
    };
  }

  function pruneVersions(versions) {
    const out = {};
    Object.keys(versions || {}).forEach(function (id) {
      const row = normalizeVersionEntry(versions[id]);
      if (!versionHasContent(row)) return;
      out[id] = row;
    });
    return out;
  }

  function reconcileVersionsToCatalog(versions, catalogPlaybackIds) {
    const allowed = new Set(
      (catalogPlaybackIds || []).map(function (id) {
        return String(id || '').trim();
      }).filter(Boolean)
    );
    if (!allowed.size) return versions || {};
    const out = {};
    Object.keys(versions || {}).forEach(function (id) {
      const key = String(id || '').trim();
      if (!key || !allowed.has(key)) return;
      out[key] = normalizeVersionEntry(versions[id]);
    });
    return out;
  }

  function hasContent(page) {
    const p = normalizePage('', page);
    if (p.notes.trim()) return true;
    if (p.lyrics.trim()) return true;
    if (p.heroVideoPlaybackId) return true;
    if (p.coverArt) return true;
    if (
      Object.keys(p.versions || {}).some(function (id) {
        return versionHasContent(p.versions[id]);
      })
    ) {
      return true;
    }
    return p.media.some(function (item) {
      return !!(item.title || item.playbackId || item.href || item.text || item.imageData);
    });
  }

  function getPage(groupKey) {
    const key = String(groupKey || '')
      .toLowerCase()
      .trim();
    return ensureHydrated().then(function () {
      const store = readStore();
      return normalizePage(key, store.pages[key]);
    });
  }

  function savePage(groupKey, patch) {
    const key = String(groupKey || '')
      .toLowerCase()
      .trim();
    if (!key) return Promise.reject(new Error('missing song key'));
    return ensureHydrated().then(function () {
      const store = readStore();
      const current = normalizePage(key, store.pages[key]);
      const mergedVersions = Object.assign(
        {},
        current.versions || {},
        (patch && patch.versions) || {}
      );
      const next = normalizePage(
        key,
        Object.assign({}, current, patch || {}, {
          groupKey: key,
          versions: pruneVersions(mergedVersions),
          updatedAt: new Date().toISOString()
        })
      );
      if (hasContent(next)) next.published = true;
      store.pages[key] = next;
      writeStore(store);
      root.dispatchEvent(
        new CustomEvent('burnfolder-song-page-changed', { detail: { groupKey: key, page: next } })
      );
      return next;
    });
  }

  function listPages() {
    return ensureHydrated().then(function () {
      const store = readStore();
      return Object.keys(store.pages)
        .map(function (key) {
          return normalizePage(key, store.pages[key]);
        })
        .filter(hasContent)
        .sort(function (a, b) {
          return String(b.updatedAt).localeCompare(String(a.updatedAt));
        });
    });
  }

  function getPublishedPage(groupKey) {
    const key = String(groupKey || '')
      .toLowerCase()
      .trim();
    const published = root.burnfolderSongPages || {};
    if (published[key]) return normalizePage(key, published[key]);
    return null;
  }

  function resolvePage(groupKey, preferStudio) {
    const key = String(groupKey || '')
      .toLowerCase()
      .trim();
    if (preferStudio) {
      return getPage(key).then(function (studioPage) {
        if (hasContent(studioPage)) return studioPage;
        const pub = getPublishedPage(key);
        return pub || studioPage;
      });
    }
    const pub = getPublishedPage(key);
    if (pub && hasContent(pub)) return Promise.resolve(pub);
    return getPage(key);
  }

  function getPublishedPayload() {
    const store = readStore();
    const out = {};
    Object.keys(store.pages).forEach(function (key) {
      const page = normalizePage(key, store.pages[key]);
      if (!page.published || !hasContent(page)) return;
      out[key] = {
        notes: page.notes,
        lyrics: '',
        versions: pruneVersions(page.versions),
        heroVideoPlaybackId: page.heroVideoPlaybackId,
        coverArt: page.coverArt,
        coverAssetId: page.coverAssetId || '',
        media: page.media,
        updatedAt: page.updatedAt
      };
    });
    return out;
  }

  function exportPublishedJs() {
    return (
      '// Song page content — save as song-pages.js in your site root\n' +
      'window.burnfolderSongPages = ' +
      JSON.stringify(getPublishedPayload(), null, 2) +
      ';\n'
    );
  }

  function pushToSite() {
    return ensureHydrated().then(function () {
      const pages = getPublishedPayload();
      const count = Object.keys(pages).length;
      if (!count) {
        return Promise.reject(new Error('nothing to push — add content first'));
      }

      const authReady =
        root.BurnfolderStudioAuth && root.BurnfolderStudioAuth.whenReady
          ? root.BurnfolderStudioAuth.whenReady()
          : Promise.resolve();

      return authReady.then(function () {
        return root.fetch(getFunctionsBase() + '/studio-publish-song-pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pages: pages })
        });
      }).then(function (res) {
        return res.json().catch(function () {
          return {};
        }).then(function (data) {
          if (!res.ok) {
            const msg = (data && data.message) || 'push failed (' + res.status + ')';
            return Promise.reject(new Error(msg));
          }
          root.burnfolderSongPages = pages;
          return data;
        });
      });
    });
  }

  root.BurnfolderSongPageStore = {
    makeId: makeId,
    emptyPage: emptyPage,
    normalizePage: normalizePage,
    normalizeVersionEntry: normalizeVersionEntry,
    reconcileVersionsToCatalog: reconcileVersionsToCatalog,
    versionHasContent: versionHasContent,
    hasContent: hasContent,
    ensureHydrated: ensureHydrated,
    getPage: getPage,
    savePage: savePage,
    listPages: listPages,
    getPublishedPage: getPublishedPage,
    resolvePage: resolvePage,
    getPublishedPayload: getPublishedPayload,
    exportPublishedJs: exportPublishedJs,
    pushToSite: pushToSite
  };
})(typeof window !== 'undefined' ? window : globalThis);
