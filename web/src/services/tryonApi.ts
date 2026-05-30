import { acquireKey, acquireKeyNoCooldown, releaseKey, markKeyFailed, markKeySuccess, type KeyAssignment } from '@/services/keyPool';

export interface TryOnGenInput {
  prompt: string;
  modelImageBase64?: string;
  productImageBase64?: string;
  styleRefBase64?: string;
  detailImageBase64?: string;
  width: number;
  height: number;
  modelId: string;
  skipCooldown?: boolean;
  signal?: AbortSignal;
}

const GRSAI_BASE = '/grsai';
const YUNWU_BASE = '/yunwu';

function combineSignals(a: AbortSignal | null | undefined, b: AbortSignal | null | undefined): AbortSignal | null | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  const ctrl = new AbortController();
  const onAbort = () => {
    a!.removeEventListener('abort', onAbort);
    b!.removeEventListener('abort', onAbort);
    try { ctrl.abort(); } catch {}
  };
  a.addEventListener('abort', onAbort);
  b.addEventListener('abort', onAbort);
  if (a.aborted || b.aborted) {
    a.removeEventListener('abort', onAbort);
    b.removeEventListener('abort', onAbort);
    try { ctrl.abort(); } catch {}
  }
  return ctrl.signal;
}

/** 带超时的 fetch（180 秒 — 4K 生图可能较慢） */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 180000): Promise<Response> {
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const merged = combineSignals(init.signal, timeoutCtrl.signal);
  try {
    return await fetch(url, { ...init, signal: merged });
  } finally {
    clearTimeout(timer);
  }
}

/** 带重试：429 最多重试 3 次（退避 5s/10s/20s），5xx/网络重试 1 次。外部 AbortSignal 命中时立即停止 */
async function fetchWithRetry(url: string, init: RequestInit, externalSignal?: AbortSignal, retries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    // 外部取消时立即中止
    if (externalSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      // Wire externalSignal into the fetch so in-flight requests are abortable
      const mergedInit = externalSignal
        ? { ...init, signal: combineSignals(init.signal ?? null, externalSignal) }
        : init;
      const resp = await fetchWithTimeout(url, mergedInit);
      if (resp.ok) return resp;
      const raw = await resp.text().catch(() => '');
      lastErr = new Error(`HTTP ${resp.status}: ${raw.slice(0, 300)}`);
      // 429 限流：指数退避重试（最多 3 次）
      if (resp.status === 429) {
        if (i < retries) {
          const wait = [5000, 10000, 20000][i] || 20000;
          console.warn(`[fetchWithRetry] 429 rate limited, retry ${i + 1}/${retries} after ${wait}ms`);
          await delay(wait);
          continue;
        }
        throw lastErr;
      }
      // 5xx 服务器错误：重试 1 次
      if (resp.status >= 500) { await delay(2000); continue; }
      throw lastErr;
    } catch (e) {
      // 外部取消时不重试
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('AbortError') || msg.includes('aborted') || externalSignal?.aborted) throw e;
      lastErr = e;
      if (i < retries && (msg.includes('abort') || msg.includes('fetch') || msg.includes('network'))) {
        await delay(1500);
        continue;
      }
    }
  }
  throw lastErr;
}

function delay(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function getProvider(modelId: string): 'yunwu' | 'grsai' {
  if (modelId.startsWith('nano-banana')) return 'grsai';
  // Grsai: gpt-image-2-vip (4K+多参考图), gpt-image-2 (默认·1024)
  if (modelId === 'gpt-image-2-vip') return 'grsai';
  if (modelId === 'gpt-image-2') return 'grsai';
  // Yunwu: gpt-image-2-all (4K+多参考图), gpt-image-1-mini (快速·推荐)
  if (modelId === 'gpt-image-2-all') return 'yunwu';
  if (modelId === 'gpt-image-1-mini') return 'yunwu';
  return 'yunwu';
}

function isMultiRefModel(modelId: string): boolean {
  return modelId === 'gpt-image-2-all' || modelId === 'gpt-image-2-vip';
}

/** 去掉 data:image/...;base64, 前缀，API 需要裸 base64 */
function bareBase64(dataUrl: string): string {
  if (dataUrl.startsWith('data:')) {
    const idx = dataUrl.indexOf(',');
    return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  }
  return dataUrl;
}

/**
 * 主入口（单引擎模式）— KEY 级别并发控制
 */
export async function generateTryOnImage(input: TryOnGenInput): Promise<string> {
  const provider = getProvider(input.modelId);
  const apiKey = input.skipCooldown ? await acquireKeyNoCooldown(provider) : await acquireKey(provider);

  try {
    let result: string;
    if (input.modelId.startsWith('nano-banana')) result = await generateViaGrsaiBanana(apiKey, input);
    else if (input.modelId === 'gpt-image-2-vip' || input.modelId === 'gpt-image-2') result = await generateViaGrsaiGenerate(apiKey, input);
    else if (input.modelId === 'gpt-image-2-all') result = await generateViaYunwuAll(apiKey, input);
    else if (input.modelId === 'gpt-image-1-mini') result = await generateViaYunwuMini(apiKey, input);
    else result = await generateViaYunwu(apiKey, input);
    markKeySuccess(provider, apiKey);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('429') || msg.includes('rate limited')) {
      markKeyFailed(provider, apiKey, '429');
    } else if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
      markKeyFailed(provider, apiKey, '5xx');
    } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('abort') || msg.includes('timeout')) {
      markKeyFailed(provider, apiKey, 'network');
    } else if (!msg.includes('负载已饱和')) {
      markKeyFailed(provider, apiKey, 'other');
    }
    throw e;
  }
}

export { getProvider };

/**
 * 混合引擎入口 — 直接用分配好的 KEY（不重新 acquire）
 */
export async function generateViaKey(input: TryOnGenInput, assignment: KeyAssignment): Promise<string> {
  const modelId = assignment.provider === 'yunwu' ? 'gpt-image-2-all' : 'gpt-image-2-vip';
  try {
    let result: string;
    if (assignment.provider === 'grsai') {
      result = await generateViaGrsaiGenerate(assignment.key, { ...input, modelId });
    } else {
      result = await generateViaYunwuAll(assignment.key, { ...input, modelId });
    }
    markKeySuccess(assignment.provider, assignment.key);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('429') || msg.includes('rate limited')) {
      markKeyFailed(assignment.provider, assignment.key, '429');
    } else if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
      markKeyFailed(assignment.provider, assignment.key, '5xx');
    } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('abort') || msg.includes('timeout')) {
      markKeyFailed(assignment.provider, assignment.key, 'network');
    } else if (!msg.includes('负载已饱和')) {
      markKeyFailed(assignment.provider, assignment.key, 'other');
    }
    throw e;
  }
}

/** Yunwu gpt-image-1-mini: 优先使用，连接失败自动降级到 gpt-image-2 */
async function generateViaYunwuMini(apiKey: string, input: TryOnGenInput): Promise<string> {
  try {
    return await generateViaYunwu(apiKey, { ...input, modelId: 'gpt-image-1-mini' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('abort')) {
      console.warn('[YunwuMini] gpt-image-1-mini 连接失败，降级到 gpt-image-2-all');
      return await generateViaYunwu(apiKey, { ...input, modelId: 'gpt-image-2-all' });
    }
    throw e;
  }
}

async function generateViaYunwu(apiKey: string, input: TryOnGenInput): Promise<string> {
  const endpoint = `${YUNWU_BASE}/v1/images/generations`;
  const w = input.width > 0 ? input.width : 2448;
  const h = input.height > 0 ? input.height : 3264;

  let prompt = input.prompt;
  if (input.modelImageBase64) {
    prompt = prompt + '. Maintain identical model pose, facial expression, and composition from reference.';
  }

  // Yunwu 代理支持自定义像素尺寸（如 2448×3264 = 真4K）
  const size = `${w}x${h}`;
  const imgSizeLabel = deriveImageSize(w, h);
  // 2K/4K 时加 quality=hd 提升出图细节
  const quality = imgSizeLabel === '4K' || imgSizeLabel === '2K' ? 'hd' : 'standard';

  const payload: Record<string, unknown> = { model: input.modelId, prompt, size, quality, n: 1 };
  // 优先传模特图作为参考（保留姿势/面部/构图），服装细节由 prompt 描述
  if (input.modelImageBase64) {
    payload.image = bareBase64(input.modelImageBase64);
  } else if (input.productImageBase64) {
    payload.image = bareBase64(input.productImageBase64);
  }

  const resp = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  }, input.signal);
  const raw = await resp.text();
  const data = strJson(raw);
  if (!data) throw new Error(`Yunwu response invalid: ${raw.slice(0, 200)}`);
  const arr = data.data as unknown[];
  if (arr) {
    for (const it of arr) {
      const m = it as Record<string, unknown>;
      if (typeof m.url === 'string') return m.url;
      if (typeof m.b64_json === 'string') return `data:image/png;base64,${m.b64_json}`;
    }
  }
  throw new Error(`Yunwu no image: ${raw.slice(0, 200)}`);
}

/** 将 base64 data URL 转为 Blob（用于 FormData 上传） */
function dataUrlToBlob(dataUrl: string): Blob {
  const idx = dataUrl.indexOf(',');
  const b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  const mimeMatch = dataUrl.match(/data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

/** Yunwu /v1/images/edits：多参考图通过 multipart/form-data 传 files */
async function generateViaYunwuAll(apiKey: string, input: TryOnGenInput): Promise<string> {
  const endpoint = `${YUNWU_BASE}/v1/images/edits`;
  const w = input.width > 0 ? input.width : 2448;
  const h = input.height > 0 ? input.height : 3264;

  // 构建 FormData：图片以 multipart files 方式传入
  const fd = new FormData();
  fd.append('model', 'gpt-image-2');
  fd.append('prompt', input.prompt);
  fd.append('n', '1');
  fd.append('size', `${w}x${h}`);
  fd.append('quality', 'hd');
  fd.append('format', 'png');
  fd.append('background', 'auto');
  fd.append('moderation', 'auto');
  // 路由策略：选成功率最高的上游
  fd.append('provider.sort', 'success_rate');

  // 参考图通过 "image" 字段以文件形式传入（与 API 文档示例一致）
  // 第一张 = 模特参考图（主参考，保留构图/姿势）
  // 第二张 = 商品白底图（服装细节）
  // 第三张 = 风格参考图（模板卡片参考图）
  // 第四张 = 细节图（Logo/印花）
  if (input.modelImageBase64) {
    const blob = dataUrlToBlob(input.modelImageBase64);
    fd.append('image', blob, 'model_reference.jpg');
  }
  if (input.productImageBase64) {
    const blob = dataUrlToBlob(input.productImageBase64);
    fd.append('image', blob, 'product_reference.jpg');
  }
  if (input.styleRefBase64) {
    const blob = dataUrlToBlob(input.styleRefBase64);
    fd.append('image', blob, 'style_reference.jpg');
  }
  if (input.detailImageBase64) {
    const blob = dataUrlToBlob(input.detailImageBase64);
    fd.append('image', blob, 'detail_reference.jpg');
  }

  const resp = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: fd,
  }, input.signal);
  const raw = await resp.text();
  const data = strJson(raw);
  if (!data) throw new Error(`Yunwu Edits response invalid: ${raw.slice(0, 200)}`);
  const arr = data.data as unknown[];
  if (arr) {
    for (const it of arr) {
      const m = it as Record<string, unknown>;
      if (typeof m.url === 'string') return m.url;
      if (typeof m.b64_json === 'string') return `data:image/png;base64,${m.b64_json}`;
    }
  }
  // fallback: dig for URL
  const found = dig(data);
  if (found) return found;
  throw new Error(`Yunwu Edits no image: ${raw.slice(0, 200)}`);
}

async function generateViaGrsaiGenerate(apiKey: string, input: TryOnGenInput): Promise<string> {
  const endpoint = `${GRSAI_BASE}/v1/api/generate`;
  const w = input.width > 0 ? input.width : 2448;
  const h = input.height > 0 ? input.height : 3264;

  const images: string[] = [];
  // 模特图放第一位（主参考），商品图第二位（服装细节），风格参考图第三位，细节图第四位
  if (input.modelImageBase64) images.push(bareBase64(input.modelImageBase64));
  if (input.productImageBase64) images.push(bareBase64(input.productImageBase64));
  if (input.styleRefBase64) images.push(bareBase64(input.styleRefBase64));
  if (input.detailImageBase64) images.push(bareBase64(input.detailImageBase64));

  // gpt-image-2-vip: 用像素值 aspectRatio（如 "2448x3264"），支持 4K + 参考图
  // gpt-image-2:     用比例字符串（如 "3:4"），支持 1K + 参考图
  const useVip = input.modelId === 'gpt-image-2-vip';
  const aspectRatio = useVip ? `${w}x${h}` : deriveAspectRatio(w, h);
  const model = useVip ? 'gpt-image-2-vip' : 'gpt-image-2';

  const body: Record<string, unknown> = {
    model, prompt: input.prompt, aspectRatio, replyType: 'json', images,
  };

  const resp = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  }, input.signal);
  const raw = await resp.text();
  return parseGrsaiResponse(raw);
}

function buildFriendlyError(modelId: string, raw: string): string {
  const data = strJson(raw);
  if (data?.status === 'failed' && data.error) {
    const err = String(data.error);
    if (err.includes('high load')) return `Grsai ${modelId} 负载过高，请切换模型`;
    return `Grsai 失败: ${err.slice(0, 200)}`;
  }
  return `Grsai HTTP 错误: ${raw.slice(0, 300)}`;
}

function deriveAspectRatio(w: number, h: number): string {
  if (!w || !h) return '4:3';
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
function deriveImageSize(w: number, h: number): string {
  const mp = w * h;
  if (mp >= 8000000) return '4K';
  if (mp >= 3000000) return '2K';
  return '1K';
}

async function generateViaGrsaiBanana(apiKey: string, input: TryOnGenInput): Promise<string> {
  const endpoint = `${GRSAI_BASE}/v1/draw/nano-banana`;
  const w = input.width > 0 ? input.width : 1024;
  const h = input.height > 0 ? input.height : 1024;
  const ratio = deriveAspectRatio(w, h);
  const imgSize = deriveImageSize(w, h);

  const body: Record<string, unknown> = {
    model: input.modelId, prompt: input.prompt,
    aspectRatio: ratio, imageSize: imgSize, shutProgress: false,
  };

  const resp = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  }, input.signal);
  const raw = await resp.text();
  const found = extractUrlFromRaw(raw);
  if (found) return found;
  throw new Error(`Grsai banana response invalid: ${raw.slice(0, 300)}`);
}

function parseGrsaiResponse(raw: string): string {
  // 先尝试 JSON 解析
  let data = strJson(raw);

  // 如果不是 JSON，尝试 SSE 格式 (data: {...}\n)
  if (!data && raw.includes('data:')) {
    const chunks = raw.split('\n').filter((line) => line.startsWith('data: '));
    for (let i = chunks.length - 1; i >= 0; i--) {
      const obj = strJson(chunks[i].slice(6));
      if (obj) { data = obj; break; }
    }
  }

  if (!data) throw new Error(`Grsai response invalid: ${raw.slice(0, 300)}`);
  if (data.status === 'violation') throw new Error(`Grsai policy violation`);
  if (data.status === 'failed') {
    const errDetail = typeof data.error === 'string' ? data.error : JSON.stringify(data.error || '');
    throw new Error(`Grsai 生成失败: ${errDetail.slice(0, 300)}`);
  }
  const results = data.results as Record<string, unknown>[] | undefined;
  if (results?.[0]?.url) return results[0].url as string;
  if (typeof data.url === 'string') return data.url;
  if (typeof data.image_url === 'string') return data.image_url;
  const found = dig(data);
  if (found) return found;
  throw new Error(`Grsai no image URL in response: ${raw.slice(0, 300)}`);
}

function extractUrlFromRaw(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const obj = strJson(trimmed);
    if (obj) { const found = dig(obj); if (found) return found; }
  }
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const src = line.startsWith('data: ') ? line.slice(6) : line;
    const obj = strJson(src);
    if (obj) { const found = dig(obj); if (found) return found; }
  }
  return undefined;
}

function strJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text); } catch { return null; }
}

function dig(v: unknown): string | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const obj = v as Record<string, unknown>;
  for (const key of ['url', 'image_url', 'imageUrl', 'imageurl', 'src']) {
    const val = obj[key];
    if (typeof val === 'string' && (val.startsWith('http') || val.startsWith('data:'))) return val;
  }
  const b64 = obj['b64_json'] || obj['b64'];
  if (typeof b64 === 'string' && b64.length > 100) return `data:image/png;base64,${b64}`;
  for (const key of ['data', 'result', 'results', 'output', 'image', 'images']) {
    const child = obj[key];
    if (Array.isArray(child)) { for (const item of child) { const found = dig(item); if (found) return found; } }
    else if (child && typeof child === 'object') { const found = dig(child); if (found) return found; }
  }
  for (const [, val] of Object.entries(obj)) {
    if (typeof val === 'string' && val.startsWith('https://') && (val.includes('.png') || val.includes('.jpg') || val.includes('/file') || val.includes('/output') || val.includes('/result'))) return val;
  }
  return undefined;
}

export interface StoredModelConfig {
  apiKey?: string;
  customModels?: { id: string; name: string }[];
  disabledModelIds?: string[];
}

export function getStoredModelConfig(): StoredModelConfig {
  try { const raw = localStorage.getItem('vf-model-config'); if (raw) return JSON.parse(raw) as StoredModelConfig; } catch {}
  return {};
}

export function saveModelConfig(cfg: StoredModelConfig) {
  localStorage.setItem('vf-model-config', JSON.stringify(cfg));
}

export function isModelEnabled(modelId: string): boolean {
  const disabled = getStoredModelConfig().disabledModelIds || [];
  return !disabled.includes(modelId);
}

export function toggleModelEnabled(modelId: string, enabled: boolean) {
  const cfg = getStoredModelConfig();
  const disabled = cfg.disabledModelIds || [];
  if (enabled) { cfg.disabledModelIds = disabled.filter((id) => id !== modelId); }
  else { if (!disabled.includes(modelId)) cfg.disabledModelIds = [...disabled, modelId]; }
  saveModelConfig(cfg);
}
