/**
 * IndexedDB wrapper for the scanner.
 *
 * Three stores:
 *   roster   — one record per attendee, keyed by check-in token. Holds the
 *              local check-in state too, so a scan is decided offline.
 *   queue    — pending check-ins waiting to reach n8n, keyed by scan_id.
 *   meta     — small key/value bag (last roster sync, roster count).
 *
 * Everything here is attendee personal data. It is wiped by clearAll(), which
 * the runbook requires staff to run after the event.
 */
const DB = (() => {
  const NAME = 'ls2026-checkin';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('roster')) db.createObjectStore('roster', { keyPath: 'token' });
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'scan_id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(store, mode);
          const result = fn(t.objectStore(store));
          t.oncomplete = () => resolve(result && result.__value !== undefined ? result.__value : result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  }

  function reqValue(request) {
    const box = { __value: undefined };
    request.onsuccess = () => {
      box.__value = request.result;
    };
    return box;
  }

  return {
    /** Replace the whole roster, preserving any local check-ins already made. */
    async replaceRoster(attendees) {
      const existing = await this.allAttendees();
      const localState = new Map();
      for (const a of existing) {
        if (a.local_checked_in_at) {
          localState.set(a.token, {
            local_checked_in_at: a.local_checked_in_at,
            local_device: a.local_device,
            local_method: a.local_method,
          });
        }
      }
      return tx('roster', 'readwrite', (store) => {
        store.clear();
        for (const a of attendees) {
          const record = Object.assign({}, a, localState.get(a.token) || {});
          record.search = [a.first_name, a.last_name, a.company, a.email, a.short_code]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          store.put(record);
        }
      });
    },

    getAttendee(token) {
      return tx('roster', 'readonly', (store) => reqValue(store.get(token)));
    },

    allAttendees() {
      return tx('roster', 'readonly', (store) => reqValue(store.getAll())).then((r) => r || []);
    },

    putAttendee(attendee) {
      return tx('roster', 'readwrite', (store) => store.put(attendee));
    },

    enqueue(job) {
      return tx('queue', 'readwrite', (store) => store.put(job));
    },

    queueAll() {
      return tx('queue', 'readonly', (store) => reqValue(store.getAll())).then((r) => r || []);
    },

    dequeue(scanId) {
      return tx('queue', 'readwrite', (store) => store.delete(scanId));
    },

    queueCount() {
      return tx('queue', 'readonly', (store) => reqValue(store.count())).then((n) => n || 0);
    },

    setMeta(key, value) {
      return tx('meta', 'readwrite', (store) => store.put(value, key));
    },

    getMeta(key) {
      return tx('meta', 'readonly', (store) => reqValue(store.get(key)));
    },

    /** Wipe every trace of attendee data from this device. */
    async clearAll() {
      await tx('roster', 'readwrite', (store) => store.clear());
      await tx('queue', 'readwrite', (store) => store.clear());
      await tx('meta', 'readwrite', (store) => store.clear());
    },
  };
})();
