import { useAppStore } from '@/store/useAppStore';

interface KeyState {
  key: string;
  lastUsed: number;
  cooldownMs: number;
  failCount: number;
  disabled: boolean;
  inUse: boolean;
  /** resolve 等待此 KEY 的请求 */
  waiters: (() => void)[];
}

interface PoolState {
  keys: KeyState[];
}

const yunwuPool: PoolState = { keys: [] };
const grsaiPool: PoolState = { keys: [] };

/** 同步 config 中的 KEY 列表到内存池 */
export function syncKeyPools(): void {
  const config = useAppStore.getState().config;
  const ywKeys = (config.yunwuApiKeys || []).filter((k) => k.trim());
  const grKeys = (config.grsaiApiKeys || []).filter((k) => k.trim());
  console.log(`[KeyPool] sync: Yunwu=${ywKeys.length}keys, Grsai=${grKeys.length}keys`);
  mergePool(yunwuPool, ywKeys, 30000);
  mergePool(grsaiPool, grKeys, 2000);
}

function mergePool(pool: PoolState, newKeys: string[], cooldownMs: number): void {
  const newKeySet = new Set(newKeys);
  pool.keys = pool.keys.filter((k) => newKeySet.has(k.key));

  for (const k of newKeys) {
    if (!pool.keys.find((sk) => sk.key === k)) {
      pool.keys.push({ key: k, lastUsed: 0, cooldownMs, failCount: 0, disabled: false, inUse: false, waiters: [] });
    }
  }

  // 自动恢复：失败30s后重试
  for (const sk of pool.keys) {
    if (sk.disabled && sk.failCount > 0 && Date.now() - sk.lastUsed > 60000) {
      sk.disabled = false;
      sk.failCount = 0;
    }
  }
}

function allKeys(provider: 'yunwu' | 'grsai'): KeyState[] {
  syncKeyPools();
  const pool = provider === 'yunwu' ? yunwuPool : grsaiPool;
  const keys = pool.keys.filter((k) => !k.disabled);
  if (keys.length === 0) {
    console.error(`[KeyPool] ${provider} 池为空! 总KEY数=${pool.keys.length}, 全部禁用`);
  }
  return keys;
}

/** KEY 级别并发控制：等待直到有可用的 KEY，返回 KEY 值 */
export function acquireKey(provider: 'yunwu' | 'grsai'): Promise<string> {
  return acquireKeyAsync(allKeys(provider));
}

function acquireKeyAsync(available: KeyState[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (available.length === 0) {
      reject(new Error('No keys available for provider'));
      return;
    }
    // 找一个空闲的 KEY（不在使用中）
    const free = available.find((k) => !k.inUse);
    if (free) {
      free.inUse = true;
      free.lastUsed = Date.now();
      resolve(free.key);
      return;
    }
    // 所有 KEY 都在忙，排队等负载最低的那个
    available.sort((a, b) => a.waiters.length - b.waiters.length);
    const target = available[0];
    if (!target) { reject(new Error('Key pool corrupted: available[0] is undefined')); return; }
    target.waiters.push(() => {
      const nowFree = available.find((k) => !k.inUse);
      if (nowFree) {
        nowFree.inUse = true;
        nowFree.lastUsed = Date.now();
        resolve(nowFree.key);
      } else {
        // 极端情况：重新排队
        const fallback = available[0];
        if (!fallback) { reject(new Error('Key pool empty during waiter retry')); return; }
        fallback.waiters.push(() => {
          const retryFree = available.find((k) => !k.inUse);
          if (retryFree) { retryFree.inUse = true; retryFree.lastUsed = Date.now(); resolve(retryFree.key); }
          else { resolve(fallback.key); } // 兜底
        });
      }
    });
  });
}

/** 释放 KEY */
export function releaseKey(provider: 'yunwu' | 'grsai', key: string): void {
  syncKeyPools();
  const pool = provider === 'yunwu' ? yunwuPool : grsaiPool;
  const ks = pool.keys.find((k) => k.key === key);
  if (!ks) return;
  ks.inUse = false;
  // 通知下一个等待者
  if (ks.waiters.length > 0) {
    const next = ks.waiters.shift()!;
    next();
  }
}

/** 标记失败 + 释放 */
export function markKeyFailed(provider: 'yunwu' | 'grsai', key: string): void {
  syncKeyPools();
  const pool = provider === 'yunwu' ? yunwuPool : grsaiPool;
  const ks = pool.keys.find((k) => k.key === key);
  if (!ks) return;
  ks.inUse = false;
  ks.failCount++;
  if (ks.failCount >= 3) {
    ks.disabled = true;
    setTimeout(() => { ks.disabled = false; ks.failCount = 0; }, 60000);
  }
  // 通知等待者（即使失败了也要让出位置）
  if (ks.waiters.length > 0) {
    const next = ks.waiters.shift()!;
    next();
  }
}

export function availableKeyCount(provider: 'yunwu' | 'grsai'): number {
  syncKeyPools();
  const pool = provider === 'yunwu' ? yunwuPool : grsaiPool;
  return pool.keys.filter((k) => !k.disabled).length;
}

/** 总可用 KEY 数 = 最大并发数 */
export function totalAvailableKeys(): number {
  syncKeyPools();
  return (
    yunwuPool.keys.filter((k) => !k.disabled && k.key.trim()).length +
    grsaiPool.keys.filter((k) => !k.disabled && k.key.trim()).length
  );
}

export interface KeyAssignment {
  key: string;
  provider: 'yunwu' | 'grsai';
}

/** 跨引擎预分配：按可用 KEY 比例分配 */
export function allocateTasks(totalTasks: number): KeyAssignment[] {
  syncKeyPools();
  const yw = yunwuPool.keys.filter((k) => !k.disabled && k.key.trim());
  const gr = grsaiPool.keys.filter((k) => !k.disabled && k.key.trim());
  const all: KeyAssignment[] = [
    ...yw.map((k) => ({ key: k.key, provider: 'yunwu' as const })),
    ...gr.map((k) => ({ key: k.key, provider: 'grsai' as const })),
  ];
  if (all.length === 0) return [];
  const result: KeyAssignment[] = [];
  for (let i = 0; i < totalTasks; i++) result.push(all[i % all.length]);
  return result;
}
