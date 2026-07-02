// IndexedDB store for photo data URLs. Photos are the one thing that blows the
// ~5MB localStorage quota (each is a 200–500KB base64 string), so the place
// records stay in localStorage and the photo bytes live here, keyed by photo id.
// The store layer (lib/store.ts) is the only consumer; components never see this.

const DB_NAME = "imhungry";
const STORE = "photos";

export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null; // allow a retry on the next call
      reject(req.error);
    };
  });
  return dbPromise;
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
