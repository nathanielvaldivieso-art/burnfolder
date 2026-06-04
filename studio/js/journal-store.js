(function () {
  'use strict';

  const DB_NAME = 'burnfolderStudioJournal';
  const DB_VERSION = 1;
  const STORE = 'notes';
  const CLOUD_KEY = 'notes';

  function cloud() {
    return window.BurnfolderCloudState;
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = function () { reject(req.error); };
      req.onupgradeneeded = function (event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
    });
  }

  function makeId() {
    return 'note-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
  }

  function putRecord(db, record) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = function () { resolve(record); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function rawListNotes() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () {
          db.close();
          const rows = (req.result || []).slice().sort(function (a, b) {
            return new Date(b.updatedAt) - new Date(a.updatedAt);
          });
          resolve(rows);
        };
        req.onerror = function () {
          db.close();
          reject(req.error);
        };
      });
    });
  }

  function replaceAll(rows) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.clear();
        (rows || []).forEach(function (r) {
          if (r && r.id) store.put(r);
        });
        tx.oncomplete = function () {
          db.close();
          resolve();
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
      });
    });
  }

  function pushAllToCloud() {
    const cs = cloud();
    if (!cs || !cs.put) return Promise.resolve();
    return rawListNotes().then(function (rows) {
      cs.put(CLOUD_KEY, rows);
    }).catch(function () {});
  }

  // Pull notes from the personal cloud once per load so journaling follows you
  // across devices. Cloud is the source of truth; an empty cloud is seeded from
  // local (first run).
  let hydratePromise = null;
  function ensureHydrated() {
    if (hydratePromise) return hydratePromise;
    const cs = cloud();
    if (!cs || !cs.get) {
      hydratePromise = Promise.resolve();
      return hydratePromise;
    }
    hydratePromise = cs.get(CLOUD_KEY).then(function (rows) {
      if (Array.isArray(rows)) {
        return replaceAll(rows).then(function () {
          window.dispatchEvent(new CustomEvent('burnfolder-notes-synced'));
        });
      }
      if (rows === null) {
        return rawListNotes().then(function (local) {
          if (local.length && cs.put) cs.put(CLOUD_KEY, local);
        });
      }
    }).catch(function () {});
    return hydratePromise;
  }

  function listNotes() {
    return ensureHydrated().then(rawListNotes);
  }

  function getNote(id) {
    return ensureHydrated().then(function () {
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(id);
          req.onsuccess = function () {
            db.close();
            resolve(req.result || null);
          };
          req.onerror = function () {
            db.close();
            reject(req.error);
          };
        });
      });
    });
  }

  function createNote(title, body) {
    const now = new Date().toISOString();
    const record = {
      id: makeId(),
      title: String(title || '').trim() || 'untitled note',
      body: String(body || ''),
      createdAt: now,
      updatedAt: now
    };
    return ensureHydrated().then(function () {
      return openDb().then(function (db) {
        return putRecord(db, record).then(function (saved) {
          db.close();
          return pushAllToCloud().then(function () {
            return saved;
          });
        });
      });
    });
  }

  function updateNote(id, patch) {
    return getNote(id).then(function (row) {
      if (!row) throw new Error('note not found');
      const next = Object.assign({}, row, patch || {}, {
        id: row.id,
        updatedAt: new Date().toISOString()
      });
      return openDb().then(function (db) {
        return putRecord(db, next).then(function (saved) {
          db.close();
          return pushAllToCloud().then(function () {
            return saved;
          });
        });
      });
    });
  }

  function deleteNote(id) {
    return ensureHydrated().then(function () {
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(id);
          tx.oncomplete = function () {
            db.close();
            resolve();
          };
          tx.onerror = function () {
            db.close();
            reject(tx.error);
          };
        });
      }).then(function () {
        return pushAllToCloud();
      });
    });
  }

  window.BurnfolderJournal = {
    listNotes: listNotes,
    getNote: getNote,
    createNote: createNote,
    updateNote: updateNote,
    deleteNote: deleteNote
  };
})();
