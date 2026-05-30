import { useAppStore } from '@/store/useAppStore';

// ===== Types =====
interface KeyStats {
  totalRequests: number;
  successCount: number;
  failCount: number;
  lastFailTime: number;
  lastFailType: string;
  consecutiveFails: number;
  /** sliding window of recent request timestamps */
  recentTimestamps: number[];
}

interface KeyState {
  key: string;
  lastUsed: number;
  cooldownMs: number;
  /** max concurrent requests per key */
  maxConcurrent: number;
  inUse: number;
  /** circuit breaker state */
  circuitState: 'closed' | 'open' | 'half-open';
  circuitOpenedAt: number;
  circuitRetryAfter: number;
  stats: KeyStats;
  waiters: (() => void)[];
}

interface PoolState {
  keys: KeyState[];
}

const yunwuPool: PoolState = { keys: [] };
const grsaiPool: PoolState = { keys: [] };

// ===== Constants =====
const YUNWU_MAX_CONCURRENT_PER_KEY = 3;
const GRSAI_MAX_CONCURRENT_PER_KEY = 1; // Grsai 不支持并发，单 KEY 串行
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 30;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BASE_BACKOFF = 15000;
const CIRCUIT_MAX_BACKOFF = 300000;
const KEY_AUTO_RECOVER_MS = 120000;
const HALF_OPEN_MAX_REQUESTS = 2;

// ===== Pool Management =====
export function syncKeyPools(): void {
  const config = useAppStore.getState().config;
  const ywKeys = (config.yunwuApiKeys || []).filter((k) => k.trim());
  const grKeys = (config.grsaiApiKeys || []).filter((k) => k.trim());

  mergePool(yunwuPool, ywKeys, 30000, YUNWU_MAX_CONCURRENT_PER_KEY);
  mergePool(grsaiPool, grKeys, 2000, GRSAI_MAX_CONCURRENT_PER_KEY);
}

function mergePool(pool: PoolState, newKeys: string[], cooldownMs: number, maxConcurrent: number): void {
  const newKeySet = new Set(newKeys);
  pool.keys = pool.keys.filter((k) => newKeySet.has(k.key));

  for (const k of newKeys) {
    if (!pool.keys.find((sk) => sk.key === k)) {
      pool.keys.push({
        key: k, lastUsed: 0, cooldownMs, maxConcurrent,
        inUse: 0, circuitState: 'closed', circuitOpenedAt: 0, circuitRetryAfter: 0,
        stats: { totalRequests: 0, successCount: 0, failCount: 0, lastFailTime: 0, lastFailType: '', consecutiveFails: 0, recentTimestamps: [] },
        waiters: [],
      });
    }
  }

  // Auto-recover keys with stale failure state
  const now = Date.now();
  for (const sk of pool.keys) {
    if (sk.circuitState === 'open' && now - sk.circuitOpenedAt > sk.circuitRetryAfter) {
      sk.circuitState = 'half-open';
    }
    if (sk.circuitState !== 'open' && sk.stats.consecutiveFails > 0 && now - sk.stats.lastFailTime > KEY_AUTO_RECOVER_MS) {
      sk.circuitState = 'closed';
      sk.stats.consecutiveFails = 0;
    }
    // Clean stale timestamps
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    sk.stats.recentTimestamps = sk.stats.recentTimestamps.filter((t) => t > cutoff);
  }
}

// ===== Key Acquisition =====
function allAvailableKeys(provider: 'yunwu' | 'grsai'): KeyState[] {
  syncKeyPools();
  const pool = provider === 'yunwu' ? yunwuPool : grsaiPool;
  return pool.keys.filter((k) => k.circuitState !== 'open' && k.key.trim());
}

/**
 * Acquire a key for use. Prioritizes:
 * 1. Closed-circuit keys with availability (inUse < maxConcurrent)
 * 2. Half-open keys (limited to HALF_OPEN_MAX_REQUESTS)
 * 3. Keys within rate limit
 * 4. Lowest load (waiters count + inUse)
 */
export function acquireKey(provider: 'yunwu' | 'grsai'): Promise<string> {
  const available = allAvailableKeys(provider);
  if (available.length === 0) {
    return Promise.reject(new Error(`No keys available for ${provider}`));
  }
  return acquireKeyAsync(available);
}

/**
 * 批量任务专用：跳过冷却时间直接分配，用于需要均匀分配key的场景
 */
export function acquireKeyNoCooldown(provider: 'yunwu' | 'grsai'): Promise<string> {
  const available = allAvailableKeys(provider);
  if (available.length === 0) {
    return Promise.reject(new Error(`No keys available for ${provider}`));
  }

  // 筛选：只选 inUse < maxConcurrent 的 key（不能超过最大并发）
  const candidates = available.filter(k => k.inUse < k.maxConcurrent);
  if (candidates.length === 0) {
    // 所有 key 都满了，排队等待
    return acquireKeyAsync(available);
  }

  // 选最近使用时间最早的，确保均匀分配
  const sorted = [...candidates].sort((a, b) => a.lastUsed - b.lastUsed);
  const best = sorted[0];

  return new Promise((resolve) => {
    best.inUse++;
    best.lastUsed = Date.now();
    best.stats.recentTimestamps.push(Date.now());
    best.stats.totalRequests++;
    resolve(best.key);
  });
}

function acquireKeyAsync(available: KeyState[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const now = Date.now();

    // Score and sort candidates
    const scored = available
      .filter((k) => {
        // Rate limit check
        const recentCount = k.stats.recentTimestamps.filter((t) => t > now - RATE_LIMIT_WINDOW_MS).length;
        if (recentCount >= MAX_REQUESTS_PER_WINDOW) return false;
        // Half-open limited
        if (k.circuitState === 'half-open' && k.inUse >= HALF_OPEN_MAX_REQUESTS) return false;
        // Concurrency check
        if (k.inUse >= k.maxConcurrent) return false;
        return true;
      })
      .map((k) => ({
        key: k,
        score: k.inUse + k.waiters.length * 0.5 + k.stats.consecutiveFails * 2,
      }))
      .sort((a, b) => a.score - b.score);

    const best = scored[0];
    if (best) {
      best.key.inUse++;
      best.key.lastUsed = now;
      best.key.stats.recentTimestamps.push(now);
      best.key.stats.totalRequests++;
      resolve(best.key.key);
      return;
    }

    // All keys busy or rate-limited → queue on the least loaded one
    const leastLoaded = [...available].sort(
      (a, b) => (a.inUse + a.waiters.length) - (b.inUse + b.waiters.length)
    )[0];

    if (!leastLoaded) {
      reject(new Error('Key pool empty'));
      return;
    }

    // Timeout after 60s waiting
    const timer = setTimeout(() => {
      const idx = leastLoaded.waiters.indexOf(onAvailable);
      if (idx >= 0) leastLoaded.waiters.splice(idx, 1);
      reject(new Error('Key acquisition timeout (60s)'));
    }, 60000);

    const onAvailable = () => {
      clearTimeout(timer);
      const retry = available.find((k) => !k.circuitState || k.circuitState === 'closed'
        ? k.inUse < k.maxConcurrent
        : k.inUse < HALF_OPEN_MAX_REQUESTS);
      if (retry) {
        retry.inUse++;
        retry.lastUsed = now;
        retry.stats.recentTimestamps.push(now);
        retry.stats.totalRequests++;
        resolve(retry.key);
      } else {
        // Re-queue
        leastLoaded.waiters.push(onAvailable);
      }
    };
    leastLoaded.waiters.push(onAvailable);
  });
}

// ===== Key Release =====
export function releaseKey(provider: 'yunwu' | 'grsai', key: string): void {
  const pool = provider === 'yunwu' ? yunwuPool : grsaiPool;
  const ks = pool.keys.find((k) => k.key === key);
  if (!ks) return;
  ks.inUse = Math.max(0, ks.inUse - 1);

  // Notify next waiter
  const next = ks.waiters.shift();
  if (next) {
    try { next(); } catch { /* ignore */ }
  } else {
    // Try other keys' waiters (load redistribution)
    for (const other of pool.keys) {
      if (other.key === key) continue;
      if (other.waiters.length > 0 && other.inUse < other.maxConcurrent) {
        const w = other.waiters.shift();
        if (w) { try { w(); } catch { /* ignore */ } break; }
      }
    }
  }
}

// ===== Failure Handling =====
export function markKeyFailed(provider: 'yunwu' | 'grsai', key: string, errorType: '429' | '5xx' | 'network' | 'other' = 'other'): void {
  const pool = provider === 'yunwu' ? yunwuPool : grsaiPool;
  const ks = pool.keys.find((k) => k.key === key);
  if (!ks) return;

  ks.stats.failCount++;
  ks.stats.consecutiveFails++;
  ks.stats.lastFailTime = Date.now();
  ks.stats.lastFailType = errorType;

  // Rate limit errors (429) → increment cooldown but don't trip circuit
  if (errorType === '429') {
    ks.cooldownMs = Math.min(ks.cooldownMs * 2, 60000);
    releaseKey(provider, key);
    return;
  }

  // Hard failures → circuit breaker
  if (ks.stats.consecutiveFails >= CIRCUIT_BREAKER_THRESHOLD) {
    ks.circuitState = 'open';
    ks.circuitOpenedAt = Date.now();
    const backoff = Math.min(
      CIRCUIT_BASE_BACKOFF * Math.pow(2, Math.min(ks.stats.consecutiveFails - CIRCUIT_BREAKER_THRESHOLD, 5)),
      CIRCUIT_MAX_BACKOFF
    );
    ks.circuitRetryAfter = backoff;
  }

  releaseKey(provider, key);
}

export function markKeySuccess(provider: 'yunwu' | 'grsai', key: string): void {
  const pool = provider === 'yunwu' ? yunwuPool : grsaiPool;
  const ks = pool.keys.find((k) => k.key === key);
  if (!ks) return;

  ks.stats.successCount++;
  ks.stats.consecutiveFails = 0;

  // Half-open → closed after successful request
  if (ks.circuitState === 'half-open') {
    ks.circuitState = 'closed';
    ks.circuitOpenedAt = 0;
    ks.circuitRetryAfter = 0;
  }

  releaseKey(provider, key);
}

// ===== Queries =====
export function availableKeyCount(provider: 'yunwu' | 'grsai'): number {
  syncKeyPools();
  const pool = provider === 'yunwu' ? yunwuPool : grsaiPool;
  return pool.keys.filter((k) => k.circuitState !== 'open' && k.key.trim()).length;
}

export function totalAvailableKeys(): number {
  return availableKeyCount('yunwu') + availableKeyCount('grsai');
}

/** 单个引擎的理论最大并发数 = 可用KEY数 × 每KEY最大并发 */
export function getPoolCapacity(provider: 'yunwu' | 'grsai'): number {
  const maxPerKey = provider === 'yunwu' ? YUNWU_MAX_CONCURRENT_PER_KEY : GRSAI_MAX_CONCURRENT_PER_KEY;
  return availableKeyCount(provider) * maxPerKey;
}

/** 混合引擎理论最大并发数 */
export function getTotalCapacity(): number {
  return getPoolCapacity('yunwu') + getPoolCapacity('grsai');
}

export interface KeyAssignment {
  key: string;
  provider: 'yunwu' | 'grsai';
}

/**
 * Cross-engine weighted allocation based on:
 * - Available key count per provider
 * - Health score of each key (success rate)
 * - Current load (inUse / maxConcurrent)
 */
export function allocateTasks(totalTasks: number): KeyAssignment[] {
  syncKeyPools();

  const yw = yunwuPool.keys.filter((k) => k.circuitState !== 'open' && k.key.trim());
  const gr = grsaiPool.keys.filter((k) => k.circuitState !== 'open' && k.key.trim());

  // Build weighted pool
  interface WeightedKey { key: string; provider: 'yunwu' | 'grsai'; weight: number }
  const weighted: WeightedKey[] = [];

  for (const k of yw) {
    const successRate = k.stats.totalRequests > 0
      ? k.stats.successCount / k.stats.totalRequests
      : 1.0;
    const loadFactor = 1 - (k.inUse / Math.max(k.maxConcurrent, 1));
    const weight = Math.max(0.1, successRate * 0.7 + loadFactor * 0.3);
    weighted.push({ key: k.key, provider: 'yunwu', weight });
  }

  for (const k of gr) {
    const successRate = k.stats.totalRequests > 0
      ? k.stats.successCount / k.stats.totalRequests
      : 1.0;
    const loadFactor = 1 - (k.inUse / Math.max(k.maxConcurrent, 1));
    const weight = Math.max(0.1, successRate * 0.7 + loadFactor * 0.3);
    weighted.push({ key: k.key, provider: 'grsai', weight });
  }

  if (weighted.length === 0) return [];

  // Sort by weight descending → healthiest first
  weighted.sort((a, b) => b.weight - a.weight);

  // Round-robin allocation biased by weight
  const result: KeyAssignment[] = [];
  const usageCount = new Map<string, number>();

  for (let i = 0; i < totalTasks; i++) {
    // Pick the key with the lowest usage/weight ratio
    let best: WeightedKey | null = null;
    let bestRatio = Infinity;

    for (const wk of weighted) {
      const used = usageCount.get(wk.key) || 0;
      const ratio = used / wk.weight;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = wk;
      }
    }

    if (!best) best = weighted[0];
    usageCount.set(best.key, (usageCount.get(best.key) || 0) + 1);
    result.push({ key: best.key, provider: best.provider });
  }

  return result;
}

/** Get pool health for monitoring */
export function getPoolHealth(): {
  yunwu: { total: number; available: number; healthy: number; degraded: number };
  grsai: { total: number; available: number; healthy: number; degraded: number };
} {
  syncKeyPools();
  const health = (pool: PoolState) => {
    const total = pool.keys.length;
    const available = pool.keys.filter((k) => k.circuitState !== 'open').length;
    const healthy = pool.keys.filter((k) => k.circuitState === 'closed' && k.stats.consecutiveFails === 0).length;
    const degraded = pool.keys.filter((k) => k.circuitState === 'half-open' || (k.circuitState === 'closed' && k.stats.consecutiveFails > 0)).length;
    return { total, available, healthy, degraded };
  };
  return { yunwu: health(yunwuPool), grsai: health(grsaiPool) };
}
