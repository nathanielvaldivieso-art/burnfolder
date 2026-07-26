(function (root) {
  'use strict';

  /**
   * Shared helpers for the studio's localStorage + personal-cloud content
   * stores (drafts, journal days, album/song/press pages, shop products).
   * Cloud (Netlify Blobs via BurnfolderCloudState) is the source of truth;
   * an empty cloud is seeded from whatever is local on first run.
   */

  function makeId(prefix) {
    return (prefix || 'item') + '-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
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

  /**
   * config:
   *  - storageKey, cloudKey (string, required)
   *  - emptyState() -> default store object
   *  - isValidLocal(parsed) -> bool, guards a parsed localStorage record
   *  - isValidCloudValue(value) -> bool, guards a value pulled from the cloud
   *      (defaults to isValidLocal; some stores require it stricter)
   *  - hasLocalContent(store) -> truthy if local data should seed an empty cloud
   *  - syncEventName -> optional CustomEvent name dispatched after a cloud pull
   *  - toCloudValue(store) -> optional, strips fields that shouldn't leave the device
   *      (e.g. pending base64 uploads)
   *  - mergeCloudValue(cloudValue, localStore) -> optional, reconciles a pulled
   *      cloud value with any local-only fields (e.g. a pending upload) before
   *      it's written back to localStorage
   */
  function createLocalCloudStore(config) {
    const storageKey = config.storageKey;
    const cloudKey = config.cloudKey;
    const emptyState = config.emptyState;
    const isValidLocal = config.isValidLocal || function () {
      return true;
    };
    const isValidCloudValue = config.isValidCloudValue || isValidLocal;
    const hasLocalContent = config.hasLocalContent || function () {
      return false;
    };
    const syncEventName = config.syncEventName || null;
    const toCloudValue = config.toCloudValue || null;
    const mergeCloudValue = config.mergeCloudValue || null;

    function readStore() {
      try {
        const raw = root.localStorage.getItem(storageKey);
        if (!raw) return emptyState();
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !isValidLocal(parsed)) return emptyState();
        return parsed;
      } catch (e) {
        return emptyState();
      }
    }

    function writeStore(store) {
      root.localStorage.setItem(storageKey, JSON.stringify(store));
      const cs = root.BurnfolderCloudState;
      if (cs && cs.put) {
        cs.put(cloudKey, toCloudValue ? toCloudValue(store) : store);
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
        .get(cloudKey)
        .then(function (value) {
          if (value && isValidCloudValue(value)) {
            const next = mergeCloudValue ? mergeCloudValue(value, readStore()) : value;
            root.localStorage.setItem(storageKey, JSON.stringify(next));
            if (syncEventName) root.dispatchEvent(new root.CustomEvent(syncEventName));
          } else if (value === null) {
            const local = readStore();
            if (hasLocalContent(local) && cs.put) cs.put(cloudKey, local);
          }
        })
        .catch(function () {});
      return hydratePromise;
    }

    return {
      readStore: readStore,
      writeStore: writeStore,
      ensureHydrated: ensureHydrated
    };
  }

  root.BurnfolderCloudStoreKit = {
    makeId: makeId,
    getFunctionsBase: getFunctionsBase,
    fileToBase64: fileToBase64,
    createLocalCloudStore: createLocalCloudStore
  };
})(typeof window !== 'undefined' ? window : globalThis);
