/**
 * IndexedDB image persistence — stores full-res reference images (1024px)
 * that survive page refreshes. localStorage only stores metadata flags.
 */

const DB_NAME = 'vf-image-store';
const DB_VERSION = 1;
const STORE = 'images';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveImage(key: string, b64: string): Promise<void> {
  try {
    const db = await open();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error('Transaction aborted'));
        tx.objectStore(STORE).put(b64, key);
        tx.oncomplete = () => resolve();
      } catch (e) { reject(e); }
    });
  } catch (e) {
    throw new Error(`IndexedDB save failed for ${key}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function loadImage(key: string): Promise<string | undefined> {
  try {
    const db = await open();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        tx.onerror = () => reject(tx.error);
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result as string | undefined);
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    });
  } catch { return undefined; }
}

export async function deleteImage(key: string): Promise<void> {
  try {
    const db = await open();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.onerror = () => resolve(); // best-effort delete
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
      } catch { resolve(); }
    });
  } catch { /* ignore */ }
}

export async function clearAll(): Promise<void> {
  try {
    const db = await open();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.onerror = () => resolve();
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
      } catch { resolve(); }
    });
  } catch { /* ignore */ }
}
