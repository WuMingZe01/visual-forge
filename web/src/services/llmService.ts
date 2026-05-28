import type { LlmConfig } from '@/store/useLlmStore';
import { getAiPrompt } from '@/services/promptTemplates';

const PROXY_ENTRIES: [string, string][] = [
  ['https://api.deepseek.com', '/llm-deepseek'],
  ['https://api.moonshot.cn', '/llm-moonshot'],
];

function proxiedUrl(remoteUrl: string): string {
  for (const [remote, local] of PROXY_ENTRIES) {
    if (remoteUrl.startsWith(remote)) {
      return local + remoteUrl.slice(remote.length);
    }
  }
  return remoteUrl;
}

async function llmFetch(config: LlmConfig, messages: { role: string; content: unknown }[], maxTokens = 4096, stream = false, signal?: AbortSignal): Promise<Response> {
  const base = config.baseUrl.replace(/\/$/, '');
  const fullUrl = `${base}/chat/completions`;
  const body: Record<string, unknown> = { model: config.model, messages, max_tokens: maxTokens, stream };
  if (config.provider !== 'moonshot') {
    body.temperature = 0.4;
  }
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  const mergedSignal = signal
    ? combineSignals(signal, ctrl.signal)
    : ctrl.signal;
  try {
    return await fetch(proxiedUrl(fullUrl), { method: 'POST', headers, body: JSON.stringify(body), signal: mergedSignal });
  } finally {
    clearTimeout(timer);
  }
}

function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const onAbort = () => {
    a.removeEventListener('abort', onAbort);
    b.removeEventListener('abort', onAbort);
    ctrl.abort();
  };
  a.addEventListener('abort', onAbort);
  b.addEventListener('abort', onAbort);
  if (a.aborted || b.aborted) {
    a.removeEventListener('abort', onAbort);
    b.removeEventListener('abort', onAbort);
    ctrl.abort();
  }
  return ctrl.signal;
}


export async function testLlmConnection(config: LlmConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await llmFetch(config, [{ role: 'user', content: 'Reply with exactly: OK' }], 50);
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { ok: false, message: `HTTP ${resp.status}: ${txt.slice(0, 300)}` };
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return { ok: true, message: `连接成功 → ${text.slice(0, 100)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '未知错误' };
  }
}

/**
 * Stage 1 — 多模态模型分析模特参考图（无白底图时使用）
 * 核心目标：提取"换衣时必须 100% 保留"的不变特征
 * 由 Kimi K2.6 多模态模型执行
 * 可使用系统设置中的「AI 提示词管理」自定义
 */
export async function analyzeModelImage(config: LlmConfig, imageBase64: string): Promise<string> {
  const systemPrompt = getAiPrompt('analyzeModel');

  const resp = await llmFetch(config, [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: '请分析这张模特图的不变特征（换衣后必须保留的）' },
        { type: 'image_url', image_url: { url: imageBase64 } },
      ],
    },
  ], 4096);

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 500)}`);
  }

  return parseLlmResponse(resp);
}

/**
 * Stage 1+ — 同时分析模特图 + 商品白底图
 * 模特图：提取不变特征（人物/光影/背景/构图/风格）
 * 白底图：提取服装细节（面料纹理、印花图案、logo、缝线、纽扣拉链、口袋设计等）
 * 由 Kimi K2.6 多模态模型执行
 * 可使用系统设置中的「AI 提示词管理」自定义
 */
export async function analyzeBothImages(
  config: LlmConfig,
  modelImageBase64: string,
  productImageBase64: string
): Promise<{ invariant: string; garmentDetails: string }> {
  const systemPrompt = getAiPrompt('analyzeBoth');

  const resp = await llmFetch(config, [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: '图1（模特参考图 — 提取不变特征）：' },
        { type: 'image_url', image_url: { url: modelImageBase64 } },
        { type: 'text', text: '\n\n图2（商品白底图 — 提取服装细节）：' },
        { type: 'image_url', image_url: { url: productImageBase64 } },
        { type: 'text', text: '\n\n请按两部分格式输出：先输出模特图不变特征，再输出白底图服装细节。' },
      ],
    },
  ], 4096);

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 500)}`);
  }

  const raw = await parseLlmResponse(resp);

  const partSplit = raw.split(/=====\s*第[一二]部分/);
  if (partSplit.length >= 3) {
    return {
      invariant: partSplit[1].trim(),
      garmentDetails: partSplit[2].trim(),
    };
  }

  const altSplit = raw.split(/【模特图不变特征】|【白底图服装细节】|【商品白底图服装细节】/);
  if (altSplit.length >= 3) {
    return {
      invariant: altSplit[1].trim(),
      garmentDetails: altSplit[2].trim(),
    };
  }

  return { invariant: raw, garmentDetails: '' };
}

/**
 * 轻量级 — 仅分析商品白底图的服装细节（印花、颜色、装饰、缝线等视觉元素）
 * 与模特图分析并行执行，减少等待时间
 */
export async function analyzeProductImage(config: LlmConfig, productImageBase64: string): Promise<string> {
  return analyzeProductCore(config, productImageBase64, undefined);
}

export async function analyzeProductWithLogo(config: LlmConfig, productImageBase64: string, logoImageBase64: string): Promise<string> {
  return analyzeProductCore(config, productImageBase64, logoImageBase64);
}

async function analyzeProductCore(config: LlmConfig, productImageBase64: string, logoImageBase64?: string): Promise<string> {
  const hasLogo = !!logoImageBase64;
  const systemPrompt = `你是一个服装电商视觉分析专家。请分析这张商品白底图，提取纯视觉层面的服装细节特征。

只输出以下信息（简洁精准，用短语）：
1. 颜色/图案：主色、配色、渐变、印花/图案描述（如"蓝白条纹、胸部刺绣logo"）
2. 材质纹理：视觉效果（如"仿麂皮绒哑光、反光尼龙"）
3. 装饰/结构细节：拉链、纽扣、口袋、缝线颜色、拼接设计等
4. 版型轮廓：从图可见的版型特征（如"oversize落肩、收腰"）
5. 特殊元素：反光条、织带、品牌标识位置等

输出要求：中文短语，不超过200字，只描述图中可见的内容。`;

  const userContent: { type: string; text?: string; image_url?: { url: string } }[] = [];
  if (hasLogo) {
    userContent.push({ type: 'text', text: '参考Logo/印花图（用于定位）：' });
    userContent.push({ type: 'image_url', image_url: { url: logoImageBase64! } });
    userContent.push({ type: 'text', text: '\n白底图（商品全貌）：' });
  }
  userContent.push({ type: 'image_url', image_url: { url: productImageBase64 } });
  userContent.push({
    type: 'text',
    text: hasLogo ? '提取服装所有可见细节，并标注Logo/印花在白底图上的精确位置' : '提取这件商品白底图的所有可见服装细节',
  });

  const resp = await llmFetch(config, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ], 2048);

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 300)}`);
  }

  return parseLlmResponse(resp);
}

async function parseLlmResponse(resp: Response): Promise<string> {
  const data = await resp.json();
  const msg = data?.choices?.[0]?.message;
  const text = msg?.content || msg?.reasoning_content || '';
  if (!text) {
    throw new Error(`LLM 返回空内容: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return text;
}

/**
 * Stage 2 — 文本模型整合提示词
 * 输入：不变特征 + 领猫商品资料
 * 输出：中文分步生图方案（业务人员可读可改）
 * 由 DeepSeek V4 Flash 文本模型执行
 * 可使用系统设置中的「AI 提示词管理」自定义
 */
export async function assembleFinalPrompt(config: LlmConfig, invariantFeatures: string, productInfo: string): Promise<string> {
  const systemPrompt = getAiPrompt('assembleTryon');

  const resp = await llmFetch(config, [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `【Kimi 上一轮识别出的线索 — 参考图中绝对不能改的东西】\n${invariantFeatures}\n\n【要换上去的这件衣服的完整资料 — 白底图细节 + 领猫商品信息】\n${productInfo}\n\n请严格按以上线索生成中文分步生图方案：第一部分的描述一点不能改，第二部分的描述精准替换原图衣服。`,
    },
  ], 4096);

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 500)}`);
  }

  return parseLlmResponse(resp);
}
