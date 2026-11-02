// Lớp lưu trữ IndexedDB: toàn bộ dữ liệu nằm trên điện thoại, không gửi đi đâu.

const DB_NAME = 'sothuchi';
const DB_VERSION = 1;
export const STORES = ['accounts', 'categories', 'transactions', 'recurring', 'budgets', 'goals', 'debts', 'photos', 'settings'];

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of STORES) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'settings' ? 'key' : 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    const r = fn(os);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  getAll: (s) => run(s, 'readonly', (os) => os.getAll()),
  get: (s, k) => run(s, 'readonly', (os) => os.get(k)),
  put: (s, v) => run(s, 'readwrite', (os) => os.put(v)),
  del: (s, k) => run(s, 'readwrite', (os) => os.delete(k)),
  clear: (s) => run(s, 'readwrite', (os) => os.clear()),
  bulkPut: (s, arr) => run(s, 'readwrite', (os) => { for (const v of arr) os.put(v); }),
};
