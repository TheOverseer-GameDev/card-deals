/**
 * Scan notes saved on this phone only.
 * The store is IndexedDB when the browser has it, and a memory store in tests.
 * A full photo is not kept. A storage limit drops the oldest note, then stops.
 */

export const HISTORY_VERSION = 2;

// Rows saved before the version tag can contain an automatic centering pair.
// New rows are tagged and shown as stored. Old pairs are not repeated.
export function presentScan(row) {
  const summary = String((row && row.summary) || '');
  if (row && row.version >= HISTORY_VERSION) return summary;
  const cleaned = summary
    .replace(/\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?/g, '')
    .replace(/Centering:[^.]*(?:\.|$)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim();
  if (cleaned === summary.trim()) return summary;
  return `${cleaned} An older automatic centering number is hidden.`.replace(/\s{2,}/g, ' ').trim();
}

const DB = 'card-deals-scan-history';
const STORE = 'scans';

export function createMemoryHistory() {
  const rows = [];
  let next = 1;
  return {
    persistent: false,
    async list() {
      return rows.map((row) => ({ ...row }));
    },
    async add(entry) {
      const row = { ...entry, id: next };
      next += 1;
      rows.unshift(row);
      return row.id;
    },
    async delete(id) {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    async clear() {
      rows.length = 0;
    },
  };
}

function quotaError(err) {
  const name = err && (err.name || err.code);
  return name === 'QuotaExceededError' || name === 22;
}

export async function saveScan(store, entry) {
  try {
    await store.add(entry);
    const all = await store.list();
    while (all.length > 40) {
      const oldest = all[all.length - 1];
      await store.delete(oldest.id);
      all.pop();
    }
    return { saved: true };
  } catch (err) {
    if (!quotaError(err)) throw err;
    const all = await store.list();
    if (all.length) await store.delete(all[all.length - 1].id);
    try {
      await store.add(entry);
      return { saved: true, trimmed: true };
    } catch (again) {
      if (quotaError(again)) {
        return { saved: false, reason: 'This phone is out of room. The scan was not saved.' };
      }
      throw again;
    }
  }
}

function requestDb() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
}

function idbStore(db) {
  function run(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return {
    persistent: true,
    async list() {
      const rows = await run('readonly', (store) => store.getAll());
      return (rows || []).sort((a, b) => (b.at || 0) - (a.at || 0));
    },
    add(entry) {
      return run('readwrite', (store) => store.add(entry));
    },
    delete(id) {
      return run('readwrite', (store) => store.delete(id));
    },
    clear() {
      return run('readwrite', (store) => store.clear());
    },
  };
}

let opening = null;

export function openScanHistory() {
  if (typeof indexedDB === 'undefined') {
    if (!opening) opening = Promise.resolve(createMemoryHistory());
    return opening;
  }
  if (!opening) {
    opening = requestDb().then(idbStore);
  }
  return opening;
}
