import type { SKUInfo, SKUSizeColor, SizeGuide } from '@/types/tryon-types';

// ===== 款式数据本地缓存 =====
const CACHE_KEY = 'vf-lingmao-sku-cache-v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

interface CacheEntry {
  skuInfo: SKUInfo;
  rawFields: Record<string, string>;
  fetchedAt: number;
}

function loadCache(): Map<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as [string, CacheEntry][];
    return new Map(arr);
  } catch { return new Map(); }
}

function saveCache(cache: Map<string, CacheEntry>): void {
  const arr = [...cache.entries()];
  localStorage.setItem(CACHE_KEY, JSON.stringify(arr));
}

function getCached(codes: string[]): { found: CacheEntry[]; missing: string[] } {
  const cache = loadCache();
  const now = Date.now();
  const found: CacheEntry[] = [];
  const missing: string[] = [];
  for (const c of codes) {
    const entry = cache.get(c);
    if (entry && now - entry.fetchedAt < CACHE_TTL_MS) {
      found.push(entry);
    } else {
      missing.push(c);
    }
  }
  return { found, missing };
}

function putCache(items: CacheEntry[]): void {
  if (items.length === 0) return;
  const cache = loadCache();
  for (const item of items) {
    cache.set(item.skuInfo.skuCode, { ...item, fetchedAt: Date.now() });
  }
  // 最多保留 500 条
  if (cache.size > 500) {
    const sorted = [...cache.entries()].sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
    for (const [k] of sorted.slice(500)) cache.delete(k);
  }
  saveCache(cache);
}

/** 手动更新/新增缓存项 */
export function putCacheItem(skuInfo: SKUInfo, rawFields: Record<string, string>): void {
  putCache([{ skuInfo, rawFields, fetchedAt: Date.now() }]);
}

/** 从缓存中获取单个款号 */
export function getCachedItem(code: string): SKUInfo | null {
  const cache = loadCache();
  const entry = cache.get(code);
  if (!entry || Date.now() - entry.fetchedAt >= CACHE_TTL_MS) return null;
  return entry.skuInfo;
}

interface RawItem { [key: string]: unknown }

function p(item: RawItem, ...keys: string[]): string {
  for (const k of keys) { const v = item[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim(); }
  return '';
}

function show(item: RawItem, key: string): string | undefined {
  const v = item[key];
  return v !== undefined && v !== null ? String(v).trim() : undefined;
}

function parseFabricWeight(item: RawItem): string {
  const v = p(item, 'att14');
  if (!v) return '';
  return /^\d+/.test(v) ? v : v.replace(/[^0-9]/g, '');
}

function mapToSKUInfo(item: RawItem): SKUInfo {
  const skus: Record<string, unknown>[] = (item.skus as Record<string, unknown>[]) || [];

  const skuList: SKUSizeColor[] = skus.map((s) => ({
    sizeName: String(s.sizeName || ''),
    colorName: String(s.colorName || ''),
    skuCode: String(s.skuCode || ''),
    gbCode: String(s.gbCode || ''),
  }));

  const sizes = [...new Set(skus.map((s) => String(s.sizeName || '')).filter(Boolean))];
  const colors = [...new Set(skus.map((s) => String(s.colorName || '')).filter(Boolean))];

  return {
    skuCode: p(item, 'pdtCode'),
    productName: p(item, 'pdtName'),
    unit: p(item, 'unit'),
    gender: p(item, 'sex'),
    listDate: p(item, 'listDate'),
    brand: p(item, 'brandName'),
    year: p(item, 'yearName'),
    season: p(item, 'seasonName'),
    band: p(item, 'bandName'),
    category: p(item, 'ctgName'),
    designGroup: p(item, 'designGroup'),
    designer: p(item, 'designer'),
    supplierName: p(item, 'supplierName'),
    supplierCode: p(item, 'supplierCode'),
    goodCode: p(item, 'goodCode'),
    oriBrand: p(item, 'oriBrand'),
    series: p(item, 'seriesInfo'),
    profile: p(item, 'profileInfo'),
    srcUrl: p(item, 'srcUrl'),
    createTime: p(item, 'createTime'),
    degree: p(item, 'degree'),
    customer: p(item, 'customerName'),
    sizes,
    colors,
    skuList,
    price: Number(p(item, 'price')) || 0,
    costPrice: Number(p(item, 'costPrice')) || 0,
    retailPrice: Number(p(item, 'retailPrice')) || 0,
    standardRule: p(item, 'standardRule'),
    safeLevel: p(item, 'safeLevel'),
    composition: p(item, 'composition'),
    processDesc: p(item, 'processDesc'),
    fabricWeight: parseFabricWeight(item),
    hasQualityReport: p(item, 'att03'),
    fabricIntro: p(item, 'att01'),
    profileIntro: p(item, 'att02'),
    fabricCategory: p(item, 'att05'),
    shoulderType: p(item, 'att08'),
    collarType: p(item, 'att09'),
    sleeveType: p(item, 'att10'),
    hemDesign: p(item, 'att11'),
    thicknessElastic: p(item, 'att15'),
    packaging: p(item, 'att16'),
    hangTag: p(item, 'att18'),
    desiccantStorage: p(item, 'att19'),
    sachetLabel: p(item, 'att20'),
    saleInfo: p(item, 'saleInfo'),
    washInfo: p(item, 'washInfo'),
    remark: p(item, 'remark'),
    imgUrls: (item.imgUrls as string[]) || [],
    sizeGuide: null,
    fetchedAt: new Date().toISOString(),
  };
}

function getConfig() {
  const stored = localStorage.getItem('vf-lingmao-config');
  if (stored) { try { return JSON.parse(stored); } catch {} }
  return { baseUrl: '/lingmao-api', stylePath: '/v1/product/getproducts', sizeGuidePath: '/v1/product/standardbom/getsizeguides', appId: import.meta.env.VITE_LINGMAO_APP_ID || '', appSecret: import.meta.env.VITE_LINGMAO_APP_SECRET || '' };
}

export function saveLingmaoConfig(updates: Partial<ReturnType<typeof getConfig>>) {
  const current = getConfig(); const merged = { ...current, ...updates };
  localStorage.setItem('vf-lingmao-config', JSON.stringify(merged));
  cachedToken = null; tokenExpiry = 0;
}

let cachedToken: string | null = null; let tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 300_000) return cachedToken;
  const c = getConfig();
  try {
    const resp = await fetch(`${c.baseUrl}/auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: c.appId, appSecret: c.appSecret }) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json(); const token = data.data?.token;
    if (!token) throw new Error('未找到 token');
    cachedToken = token; tokenExpiry = Date.now() + 2 * 60 * 60 * 1000; return token;
  } catch (e) {
    throw new Error(`领猫鉴权失败: ${e instanceof Error ? e.message : '网络异常'}。请检查领猫配置或网络连接。`);
  }
}

export interface LingmaoQueryResult { skuInfo: SKUInfo | null; rawFields: Record<string, string>; totalCount: number; }

export async function queryStyleByCode(codes: string[]): Promise<LingmaoQueryResult> {
  const uniqueCodes = [...new Set(codes.filter(Boolean))];
  if (uniqueCodes.length === 0) return { skuInfo: null, rawFields: {}, totalCount: 0 };

  // 1. 先查缓存
  const { found, missing } = getCached(uniqueCodes);

  // 2. 全部命中 → 直接返回第一条
  if (missing.length === 0) {
    const item = found[0];
    return { skuInfo: item.skuInfo, rawFields: item.rawFields, totalCount: found.length };
  }

  // 3. 部分命中 → 先返回缓存中第一条，后台查 API 补充缺失的
  if (found.length > 0 && missing.length > 0) {
    // 异步补充查询缺失的款号（不阻塞当前返回）
    fetchAndCacheMissing(missing).catch(() => {});
    const item = found[0];
    return { skuInfo: item.skuInfo, rawFields: item.rawFields, totalCount: found.length + missing.length };
  }

  // 4. 全部未命中 → 调用 API 并写入缓存
  const c = getConfig(); const token = await getToken();
  const resp = await fetch(`${c.baseUrl}${c.stylePath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ PageIndex: 1, PageSize: 10, Codes: missing.join(',') }) });
  if (!resp.ok) { const txt = await resp.text().catch(() => ''); throw new Error(`领猫 API 返回 ${resp.status}: ${txt.slice(0, 200)}`); }
  const data = await resp.json();
  if (!data.isSuccess && data.code !== 200) throw new Error(`领猫接口错误: ${data.msg || data.code}`);
  const records = (data.data?.records || data.data?.datas || []) as RawItem[];
  if (records.length === 0) return { skuInfo: null, rawFields: {}, totalCount: 0 };
  const item = records[0];
  const rawFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(item)) { if (v !== null && v !== undefined) rawFields[k] = String(v); }
  const skuInfo = mapToSKUInfo(item);

  // 写入缓存
  if (item.pdtCode) {
    putCache([{ skuInfo, rawFields, fetchedAt: Date.now() }]);
  }

  return { skuInfo, rawFields, totalCount: data.data?.total || data.data?.totalCount || 0 };
}

/** 后台异步拉取缺失的款号并写入缓存 */
async function fetchAndCacheMissing(codes: string[]): Promise<void> {
  if (codes.length === 0) return;
  try {
    const c = getConfig(); const token = await getToken();
    const resp = await fetch(`${c.baseUrl}${c.stylePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ PageIndex: 1, PageSize: Math.min(codes.length, 50), Codes: codes.join(',') }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data.isSuccess && data.code !== 200) return;
    const records = (data.data?.records || data.data?.datas || []) as RawItem[];
    const entries = records.map((item: RawItem) => ({
      skuInfo: mapToSKUInfo(item),
      rawFields: (() => { const rf: Record<string, string> = {}; for (const [k, v] of Object.entries(item)) { if (v !== null && v !== undefined) rf[k] = String(v); } return rf; })(),
      fetchedAt: Date.now(),
    }));
    putCache(entries);
  } catch {}
}

export async function queryStyleList(pageIndex = 1, pageSize = 20): Promise<{ items: SKUInfo[]; total: number }> {
  const c = getConfig(); const token = await getToken();
  const resp = await fetch(`${c.baseUrl}${c.stylePath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ PageIndex: pageIndex, PageSize: pageSize }) });
  if (!resp.ok) { const txt = await resp.text().catch(() => ''); throw new Error(`领猫 API 返回 ${resp.status}: ${txt.slice(0, 200)}`); }
  const data = await resp.json();
  if (!data.isSuccess && data.code !== 200) throw new Error(`领猫接口错误: ${data.msg || data.code}`);
  const records = (data.data?.records || data.data?.datas || []) as RawItem[];
  return { items: records.map(mapToSKUInfo), total: data.data?.total || data.data?.totalCount || records.length };
}

export async function querySizeGuide(codes: string[]): Promise<SizeGuide | null> {
  const c = getConfig(); const token = await getToken();
  const resp = await fetch(`${c.baseUrl}${c.sizeGuidePath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ pdtCodes: codes.join(','), modifiedBegin: '', modifiedEnd: '' }) });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.isSuccess && data.code !== 200) return null;
  const records = (data.data?.records || data.data?.datas || []) as RawItem[];
  if (records.length === 0) return null;
  const g = records[0];
  const parts = (g.parts || []) as RawItem[];
  if (!parts.length) return null;

  const sizeSet = new Set<string>();
  for (const part of parts) {
    for (const d of (part.details as RawItem[]) || []) {
      sizeSet.add(String(d.sizeName || ''));
    }
  }
  const sizes = [...sizeSet];

  const items = sizes.map((sizeName) => {
    const measurements: Record<string, string> = {};
    for (const part of parts) {
      const pomName = String(part.pomName || '');
      const detail = ((part.details as RawItem[]) || []).find((d: RawItem) => String(d.sizeName || '') === sizeName);
      measurements[pomName] = detail ? String(detail.sizeData || '-') : '-';
    }
    return { sizeName, measurements };
  });

  const unit = String(g.meaUnit || 'cm');
  return { guideName: String(g.guideName || ''), unit, items };
}
