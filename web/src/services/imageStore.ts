/**
 * IndexedDB image persistence — stores full-res reference images (1024px)
 * that survive page refreshes. localStorage only stores 300px thumbnails.
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
  const db = await open();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(b64, key);
    tx.oncomplete = () => resolve();
  });
}

export async function loadImage(key: string): Promise<string | undefined> {
  const db = await open();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as string | undefined);
  });
}

export async function deleteImage(key: string): Promise<void> {
  const db = await open();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
  });
}

export async function clearAll(): Promise<void> {
  const db = await open();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
  });
}
