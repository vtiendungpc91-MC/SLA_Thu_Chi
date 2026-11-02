// Lớp lưu trữ IndexedDB: toàn bộ dữ liệu nằm trên điện thoại, không gửi đi đâu.
// Mỗi người dùng (hồ sơ) có một database riêng; hồ sơ đầu tiên dùng tên cũ "sothuchi" để giữ dữ liệu sẵn có.

const DB_VERSION = 1;
export const STORES = ['accounts', 'categories', 'transactions', 'recurring', 'budgets', 'goals', 'debts', 'photos', 'settings'];

export const dbNameOf = (profileId) => (!profileId || profileId === 'main' ? 'sothuchi' : 'sothuchi-' + profileId);

let dbName = dbNameOf('main');
let dbPromise;

/** Chuyển sang database của hồ sơ khác. */
export async function useProfile(profileId) {
  const name = dbNameOf(profileId);
  if (name === dbName && dbPromise) return;
  if (dbPromise) (await dbPromise).close();
  dbName = name;
  dbPromise = null;
}

/** Xóa hẳn database của một hồ sơ. */
export function dropProfile(profileId) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbNameOf(profileId));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, DB_VERSION);
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
