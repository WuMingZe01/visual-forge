/**
 * IndexedDB 存储适配器 — 替代 localStorage 处理大容量数据
 * IndexedDB 配额远大于 localStorage（通常 50MB+ vs 5MB）
 */

const DB_NAME = 'visual-forge-db';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getStore(db: IDBDatabase, mode: IDBTransactionMode = 'readonly') {
  return db.transaction('kv', mode).objectStore('kv');
}

/** 读取 */
async function getItem(key: string): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = getStore(db).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** 写入 */
async function setItem(key: string, value: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = getStore(db, 'readwrite').put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // IndexedDB 不可用时降级到 localStorage
    try { localStorage.setItem(`idb_fallback_${key}`, value); } catch {}
  }
}

/** 删除 */
async function removeItem(key: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = getStore(db, 'readwrite').delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    try { localStorage.removeItem(`idb_fallback_${key}`); } catch {}
  }
}

/**
 * 导出一个兼容 localStorage API 的存储对象，可直接用于 Zustand persist middleware
 */
export const idbStorage = {
  getItem: async (name: string): Promise<string | null> => {
    // 先尝试 IndexedDB，失败则回退 localStorage
    const val = await getItem(name);
    if (val !== null) return val;
    // 兼容旧数据：首次迁移时从 localStorage 读取
    try {
      const legacy = localStorage.getItem(name);
      if (legacy) {
        // 迁移到 IndexedDB
        await setItem(name, legacy);
        localStorage.removeItem(name);
        return legacy;
      }
    } catch {}
    return null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await setItem(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await removeItem(name);
    try { localStorage.removeItem(name); } catch {}
  },
};

/**
 * 同步版 — 用于非 Zustand 场景（如 SKU library）
 */
export const idbSync = {
  get(key: string): string | null {
    // 先查 localStorage（同步），同时触发 IndexedDB 迁移
    try {
      const val = localStorage.getItem(key);
      if (val) {
        setItem(key, val).catch(() => {});
        // 不立即删除 localStorage 副本（同步 API 需要返回值）
      }
      return val;
    } catch { return null; }
  },
  set(key: string, value: string): void {
    setItem(key, value).catch(() => {});
    // 同时写 localStorage 作为快速缓存
    try { localStorage.setItem(key, value); } catch {}
  },
  remove(key: string): void {
    removeItem(key).catch(() => {});
    try { localStorage.removeItem(key); } catch {}
  },
};
