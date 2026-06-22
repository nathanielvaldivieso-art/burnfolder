(function (root) {
  'use strict';

  const STORAGE_KEY = 'burnfolderStudioAlbumPages';
  const CLOUD_KEY = 'albumPages';

  function makeId(prefix) {
    return (prefix || 'item') + '-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
  }

  function readStore() {
    try {
      const raw = root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 1, pages: {} };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.pages !== 'object') return { version: 1, pages: {} };
      return parsed;
    } catch (e) {
      return { version: 1, pages: {} };
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
        if (value && value.pages && typeof value.pages === 'object') {
          root.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
          root.dispatchEvent(new CustomEvent('burnfolder-album-pages-synced'));
        } else if (value === null) {
          const local = readStore();
          if (Object.keys(local.pages).length && cs.put) cs.put(CLOUD_KEY, local);
        }
      })
      .catch(function () {});
    return hydratePromise;
  }

  function normalizeMediaItem(item) {
    if (!item || typeof item !== 'object') return null;
    return {
      id: item.id || makeId('media'),
      kind: String(item.kind || 'note').trim(),
      title: String(item.title || '').trim(),
      playbackId: String(item.playbackId || '').trim(),
      href: String(item.href || '').trim(),
      text: String(item.text || '').trim(),
      imageData: String(item.imageData || '').trim()
    };
  }

  function emptyPage(albumId) {
    return {
      albumId: albumId,
      notes: '',
      heroVideoPlaybackId: '',
      media: [],
      published: false,
      updatedAt: new Date().toISOString()
    };
  }

  function normalizePage(albumId, page) {
    const id = String(albumId || (page && page.albumId) || '').trim();
    const base = emptyPage(id);
    if (!page || typeof page !== 'object') return base;
    return {
      albumId: id,
      notes: typeof page.notes === 'string' ? page.notes.trim() : '',
      heroVideoPlaybackId: String(page.heroVideoPlaybackId || '').trim(),
      media: Array.isArray(page.media)
        ? page.media.map(normalizeMediaItem).filter(Boolean)
        : [],
      published: !!page.published,
      updatedAt: page.updatedAt || base.updatedAt
    };
  }

  function hasContent(page) {
    const p = normalizePage('', page);
    if (p.notes.trim()) return true;
    if (p.heroVideoPlaybackId) return true;
    return p.media.some(function (item) {
      return !!(item.title || item.playbackId || item.href || item.text || item.imageData);
    });
  }

  function getPage(albumId) {
    const id = String(albumId || '').trim();
    return ensureHydrated().then(function () {
      const store = readStore();
      return normalizePage(id, store.pages[id]);
    });
  }

  function savePage(albumId, patch) {
    const id = String(albumId || '').trim();
    if (!id) return Promise.reject(new Error('missing album id'));
    return ensureHydrated().then(function () {
      const store = readStore();
      const current = normalizePage(id, store.pages[id]);
      const next = normalizePage(
        id,
        Object.assign({}, current, patch || {}, {
          albumId: id,
          updatedAt: new Date().toISOString()
        })
      );
      if (hasContent(next)) next.published = true;
      store.pages[id] = next;
      writeStore(store);
      return next;
    });
  }

  function getPublishedPage(albumId) {
    const id = String(albumId || '').trim();
    const published = root.burnfolderAlbumPages || {};
    if (published[id]) return normalizePage(id, published[id]);
    return null;
  }

  function resolvePage(albumId, preferStudio) {
    const id = String(albumId || '').trim();
    if (preferStudio) {
      return getPage(id).then(function (studioPage) {
        if (hasContent(studioPage)) return studioPage;
        const pub = getPublishedPage(id);
        return pub || studioPage;
      });
    }
    const pub = getPublishedPage(id);
    if (pub && hasContent(pub)) return Promise.resolve(pub);
    return getPage(id);
  }

  function buildTrackSnapshot(group, shared, versionsApi, songCatalog, itemLabel, resolveTrack) {
    const tracks = [];
    if (!group || !Array.isArray(group.tracks)) return tracks;
    group.tracks.forEach(function (track) {
      const item = typeof resolveTrack === 'function' ? resolveTrack(track) : track;
      if (!item || !item.playbackId) return;
      if (shared && shared.canPlayAsVideo && shared.canPlayAsVideo(item)) return;
      const title = typeof itemLabel === 'function' ? itemLabel(item) : item.title || 'untitled';
      const groupKey =
        versionsApi && versionsApi.getTrackGroupKey
          ? versionsApi.getTrackGroupKey(title)
          : '';
      tracks.push({
        title: title,
        playbackId: item.playbackId,
        groupKey: groupKey
      });
    });
    return tracks;
  }

  function getPublishedPayload(groupContext) {
    const store = readStore();
    const ctx = groupContext || {};
    const shared = ctx.shared || root.BurnfolderStreamShared;
    const out = {};
    Object.keys(store.pages).forEach(function (key) {
      const page = normalizePage(key, store.pages[key]);
      if (!page.published || !hasContent(page)) return;
      const group = shared && shared.findGroupById ? shared.findGroupById(key) : null;
      const meta = group && group.meta ? group.meta : shared && shared.loadStackMeta ? shared.loadStackMeta(key) : {};
      out[key] = {
        notes: page.notes,
        heroVideoPlaybackId: page.heroVideoPlaybackId,
        media: page.media,
        title: (meta && meta.title) || '',
        coverArt: (meta && meta.coverArt) || '',
        tracks: buildTrackSnapshot(
          group,
          shared,
          ctx.versionsApi,
          ctx.songCatalog,
          ctx.itemLabel,
          ctx.resolveTrack
        ),
        updatedAt: page.updatedAt
      };
    });
    return out;
  }

  function getFunctionsBase() {
    const cfg = root.BurnfolderStudioConfig || {};
    if (cfg.muxApiBase) return String(cfg.muxApiBase).replace(/\/$/, '');
    const host = root.location && root.location.hostname;
    const port = root.location && root.location.port;
    const isLocalDevServer =
      (host === 'localhost' || host === '127.0.0.1') && port && port !== '8888';
    if (isLocalDevServer) return 'http://localhost:8888/.netlify/functions';
    return '/.netlify/functions';
  }

  function pushToSite(groupContext) {
    return ensureHydrated().then(function () {
      const pages = getPublishedPayload(groupContext);
      const count = Object.keys(pages).length;
      if (!count) {
        return Promise.reject(new Error('nothing to push — add album page content first'));
      }

      const authReady =
        root.BurnfolderStudioAuth && root.BurnfolderStudioAuth.whenReady
          ? root.BurnfolderStudioAuth.whenReady()
          : Promise.resolve();

      return authReady.then(function () {
        return root.fetch(getFunctionsBase() + '/studio-publish-album-pages', {
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
          root.burnfolderAlbumPages = pages;
          return data;
        });
      });
    });
  }

  root.BurnfolderAlbumPageStore = {
    makeId: makeId,
    emptyPage: emptyPage,
    normalizePage: normalizePage,
    hasContent: hasContent,
    ensureHydrated: ensureHydrated,
    getPage: getPage,
    savePage: savePage,
    getPublishedPage: getPublishedPage,
    resolvePage: resolvePage,
    getPublishedPayload: getPublishedPayload,
    pushToSite: pushToSite
  };
})(typeof window !== 'undefined' ? window : globalThis);
