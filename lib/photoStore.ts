// IndexedDB store for photo data URLs. Photos are the one thing that blows the
// ~5MB localStorage quota (each is a 200–500KB base64 string), so the place
// records stay in localStorage and the photo bytes live here, keyed by photo id.
// The store layer (lib/store.ts) is the only consumer; components never see this.

const DB_NAME = "wheredoigokeerthan";
const LEGACY_DB_NAME = "imhungry"; // pre-rename DB — copied into the new one on first open
const STORE = "photos";

export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    let fresh = false; // DB didn't exist yet → pull photos over from the pre-rename DB
    req.onupgradeneeded = (e) => {
      fresh = e.oldVersion === 0;
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (fresh) {
        migrateLegacyPhotos(db).then(() => resolve(db));
      } else {
        resolve(db);
      }
    };
    req.onerror = () => {
      dbPromise = null; // allow a retry on the next call
      reject(req.error);
    };
  });
  return dbPromise;
}

// One-time copy out of the pre-rename "imhungry" DB when the new DB is first
// created, so existing devices keep their photos across the rename. The legacy
// DB is left intact as a rollback safety net (unless this open just created it
// empty, in which case it's removed again). Never rejects — a failed copy means
// missing photos, not a broken photo store.
function migrateLegacyPhotos(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open(LEGACY_DB_NAME); // no version — never upgrades an existing DB
    let created = false; // legacy DB never existed — nothing to copy
    req.onupgradeneeded = () => {
      created = true;
    };
    req.onerror = () => resolve();
    req.onsuccess = async () => {
      const legacy = req.result;
      try {
        if (!created && legacy.objectStoreNames.contains(STORE)) {
          const src = legacy.transaction(STORE, "readonly").objectStore(STORE);
          const [keys, values] = await Promise.all([
            request(src.getAllKeys()),
            request(src.getAll()),
          ]);
          const dst = tx(db, "readwrite");
          await Promise.all(keys.map((k, i) => request(dst.put(values[i], k))));
        }
      } catch {
        /* non-fatal — see above */
      }
      legacy.close();
      if (created) indexedDB.deleteDatabase(LEGACY_DB_NAME);
      resolve();
    };
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPutPhoto(id: string, dataUrl: string): Promise<void> {
  const db = await openDb();
  await request(tx(db, "readwrite").put(dataUrl, id));
}

export async function idbDeletePhoto(id: string): Promise<void> {
  const db = await openDb();
  await request(tx(db, "readwrite").delete(id));
}

// All photos as { id → dataUrl }, loaded once at boot to hydrate the in-memory
// place cache.
export async function idbGetAllPhotos(): Promise<Map<string, string>> {
  const db = await openDb();
  const store = tx(db, "readonly");
  const [keys, values] = await Promise.all([
    request(store.getAllKeys()),
    request(store.getAll()),
  ]);
  const out = new Map<string, string>();
  keys.forEach((k, i) => out.set(String(k), String(values[i])));
  return out;
}
