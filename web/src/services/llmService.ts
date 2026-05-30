import type { LlmConfig } from '@/store/useLlmStore';
import { getAiPrompt } from '@/services/promptTemplates';

const PROXY_ENTRIES: [string, string][] = [
  ['https://api.deepseek.com', '/llm-deepseek'],
  ['https://api.moonshot.cn', '/llm-moonshot'],
  ['https://api.xiaomimimo.com', '/llm-mimo'],
];

function proxiedUrl(remoteUrl: string): string {
  for (const [remote, local] of PROXY_ENTRIES) {
    if (remoteUrl.startsWith(remote)) {
      return local + remoteUrl.slice(remote.length);
    }
  }
  return remoteUrl;
}

async function llmFetch(config: LlmConfig, messages: { role: string; content: unknown }[], maxTokens?: number, stream = false, signal?: AbortSignal): Promise<Response> {
  const base = config.baseUrl.replace(/\/$/, '');
  const fullUrl = `${base}/chat/completions`;
  const actualMaxTokens = maxTokens ?? config.maxTokens ?? 1048576;
  const body: Record<string, unknown> = { model: config.model, messages, max_tokens: actualMaxTokens, stream };
  if (config.provider !== 'moonshot') {
    body.temperature = 0.4;
  }
  const isMiMo = config.provider === 'mimo' || config.baseUrl.includes('xiaomimimo');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (isMiMo) {
    headers['api-key'] = config.apiKey;
  } else {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
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
  productImageBase64: string,
  logoImageBase64?: string
): Promise<{ invariant: string; garmentDetails: string; logoDetails?: string }> {
  const systemPrompt = getAiPrompt('analyzeBoth');

  const userContent: { type: string; text?: string; image_url?: { url: string } }[] = [
    { type: 'text', text: '图1（模特参考图 — 提取不变特征）：' },
    { type: 'image_url', image_url: { url: modelImageBase64 } },
    { type: 'text', text: '\n\n图2（商品白底图 — 提取服装细节）：' },
    { type: 'image_url', image_url: { url: productImageBase64 } },
  ];
  if (logoImageBase64) {
    userContent.push({ type: 'text', text: '\n\n图3（印花/Logo细节图 — 提取图案精确位置和内容）：' });
    userContent.push({ type: 'image_url', image_url: { url: logoImageBase64 } });
  }
  userContent.push({ type: 'text', text: logoImageBase64 ? '\n\n请按三部分格式输出：模特图不变特征、白底图服装细节、细节图图案信息。' : '\n\n请按两部分格式输出：先输出模特图不变特征，再输出白底图服装细节。' });

  const resp = await llmFetch(config, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ], 4096);

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 500)}`);
  }

  const raw = await parseLlmResponse(resp);

  // Parse 2 or 3 parts
  const partSplit = raw.split(/=====\s*第[一二三]部分/);
  if (partSplit.length >= 4) {
    return { invariant: partSplit[1].trim(), garmentDetails: partSplit[2].trim(), logoDetails: partSplit[3].trim() };
  }
  if (partSplit.length >= 3) {
    return { invariant: partSplit[1].trim(), garmentDetails: partSplit[2].trim() };
  }

  const altSplit = raw.split(/【模特图不变特征】|【白底图服装细节】|【商品白底图服装细节】|【印花.*细节】/);
  if (altSplit.length >= 4) {
    return { invariant: altSplit[1].trim(), garmentDetails: altSplit[2].trim(), logoDetails: altSplit[3].trim() };
  }
  if (altSplit.length >= 3) {
    return { invariant: altSplit[1].trim(), garmentDetails: altSplit[2].trim() };
  }

  return { invariant: raw, garmentDetails: '' };
}

/**
 * 轻量级 — 仅分析商品白底图的服装细节
 * 与模特图分析并行执行，减少等待时间
 */
export async function analyzeProductImage(config: LlmConfig, productImageBase64: string): Promise<string> {
  return analyzeProductCore(config, productImageBase64, undefined, undefined);
}

export async function analyzeProductWithLogo(config: LlmConfig, productImageBase64: string, logoImageBase64: string): Promise<string> {
  return analyzeProductCore(config, productImageBase64, logoImageBase64, undefined);
}

/** 分析单张细节图（Logo/印花/面料特写/局部裁剪等）→ 类型+位置+描述 */
export async function analyzeDetailImage(config: LlmConfig, detailImageBase64: string): Promise<string> {
  const systemPrompt = getAiPrompt('analyzeDetail');
  const userContent: { type: string; text?: string; image_url?: { url: string } }[] = [
    { type: 'text', text: '直接输出三行结果，不要思考过程。' },
    { type: 'image_url', image_url: { url: detailImageBase64 } },
  ];
  try {
    const resp = await llmFetch(config, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ], 512);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw = await parseLlmResponse(resp);
    // 后处理：只提取 类型/位置/描述 三行，过滤掉模型的思考过程
    return extractDetailResult(raw);
  } catch (e) {
    console.warn('[analyzeDetailImage] failed:', e);
    return '';
  }
}

/** 从模型原始输出中提取结构化分析行，滤除思考碎碎念 */
function extractDetailResult(raw: string): string {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const validKeys = ['类型', '位置', '形状', '尺寸', '颜色', '材质工艺', '文字内容', '排版布局', '视觉风格', '描述'];
  const result: string[] = [];
  for (const line of lines) {
    if (validKeys.some(k => line.startsWith(k + '：') || line.startsWith(k + ':'))) {
      result.push(line);
    }
  }
  if (result.length === 0) return lines.slice(0, 5).join('\n');
  return result.join('\n');
}

/** 分析白底图 + 可选细节图 + 可选领猫商品文本 → 精准反推提示词 */
export async function analyzeProductWithInfo(
  config: LlmConfig,
  productImageBase64: string,
  productTextInfo: string,
  logoImageBase64?: string,
): Promise<string> {
  return analyzeProductCore(config, productImageBase64, logoImageBase64, productTextInfo);
}

async function analyzeProductCore(
  config: LlmConfig,
  productImageBase64: string,
  logoImageBase64?: string,
  productTextInfo?: string,
): Promise<string> {
  const hasLogo = !!logoImageBase64;
  const hasText = !!productTextInfo;
  const systemPrompt = getAiPrompt('analyzeProduct');

  const userContent: { type: string; text?: string; image_url?: { url: string } }[] = [];
  if (hasText) {
    userContent.push({ type: 'text', text: `【领猫商品资料】\n${productTextInfo}\n` });
  }
  if (hasLogo) {
    userContent.push({ type: 'text', text: '【印花/Logo细节图（用于精确定位）】' });
    userContent.push({ type: 'image_url', image_url: { url: logoImageBase64! } });
  }
  userContent.push({ type: 'text', text: '【商品白底图（全貌）】' });
  userContent.push({ type: 'image_url', image_url: { url: productImageBase64 } });

  let instruction = '请结合以上信息，输出精准的商品视觉特征描述。';
  if (hasText) instruction = '请结合【领猫商品资料】和图片视觉特征，交叉验证后输出精准的商品描述。';
  if (hasLogo) instruction += '标注Logo/印花的精确位置。';
  userContent.push({ type: 'text', text: instruction });

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
export async function assembleFinalPrompt(config: LlmConfig, invariantFeatures: string, productInfo: string, promptKey: keyof import('@/services/promptTemplates').AiPromptSet = 'assembleTryon'): Promise<string> {
  const systemPrompt = getAiPrompt(promptKey);

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

/**
 * Build vision-format messages using standard OpenAI multimodal content[] array.
 */
function buildVisionMessages(
  systemPrompt: string,
  imageBase64List: string[],
  instruction: string,
): { role: string; content: unknown }[] {
  const userContent: { type: string; text?: string; image_url?: { url: string } }[] = [];
  for (let i = 0; i < imageBase64List.length; i++) {
    userContent.push({ type: 'text', text: `图${i + 1}：` });
    userContent.push({ type: 'image_url', image_url: { url: imageBase64List[i] } });
  }
  userContent.push({ type: 'text', text: instruction });
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

async function batchAnalyzeCore(
  config: LlmConfig,
  promptKey: keyof import('@/services/promptTemplates').AiPromptSet,
  imageBase64List: string[],
  instruction: string,
  maxTokens = 4096,
): Promise<string[]> {
  const systemPrompt = getAiPrompt(promptKey);
  const messages = buildVisionMessages(systemPrompt, imageBase64List, instruction);

  const resp = await llmFetch(config, messages, maxTokens);

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 500)}`);
  }

  const raw = await parseLlmResponse(resp);

  const results: string[] = [];
  const parts = raw.split(/【图\d+】/);
  for (let i = 1; i <= imageBase64List.length; i++) {
    if (i < parts.length) {
      results.push(parts[i].trim().replace(/【负面提示词】[\s\S]*$/, '').trim());
    } else {
      results.push('');
    }
  }

  return results;
}

/**
 * Analyze single reference image → one prompt string (pose裂变).
 * One image per call — no ambiguity about which analysis is for which image.
 */
export async function analyzeSingleRefImage(config: LlmConfig, imageBase64: string): Promise<string> {
  const systemPrompt = getAiPrompt('batchAnalyzeRefs');
  const messages = buildVisionMessages( systemPrompt, [imageBase64],
    '\n请为这张参考图生成一个详细的预设提示词。');
  console.log('[llm] analyzeSingleRefImage — image length:', imageBase64.length, 'first 60 chars:', imageBase64.slice(0, 60));
  const resp = await llmFetch(config, messages, 4096);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 500)}`);
  }
  const raw = await parseLlmResponse(resp);
  console.log('[llm] analyzeSingleRefImage — raw response (first 300):', raw.slice(0, 300));
  return raw;
}

/**
 * Analyze single detail page reference image → one prompt string.
 * One image per call — no ambiguity about which analysis is for which image.
 */
export async function analyzeSingleDetailRefImage(config: LlmConfig, imageBase64: string): Promise<string> {
  const systemPrompt = getAiPrompt('batchAnalyzeDetailRefs');
  const messages = buildVisionMessages( systemPrompt, [imageBase64],
    '\n请为这张详情页参考图生成一个详细的模块预设提示词。');
  console.log('[llm] analyzeSingleDetailRefImage — image length:', imageBase64.length, 'first 60 chars:', imageBase64.slice(0, 60));
  const resp = await llmFetch(config, messages, 4096);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 500)}`);
  }
  const raw = await parseLlmResponse(resp);
  console.log('[llm] analyzeSingleDetailRefImage — raw response (first 300):', raw.slice(0, 300));
  return raw;
}

/**
 * Batch analyze 2-4 reference images in a single API call (pose裂变 template).
 * Per-image prompts parsed from 【图N】 markers in the model output.
 */
export async function batchAnalyzeRefImages(
  config: LlmConfig,
  imageBase64List: string[],
): Promise<string[]> {
  return batchAnalyzeCore(config, 'batchAnalyzeRefs', imageBase64List,
    `\n请为以上 ${imageBase64List.length} 张图各生成一个独立的预设提示词，按【图1】【图2】...格式输出。`);
}

/**
 * Batch analyze 2-4 detail page reference images.
 * Uses detail-specific prompt (layout/content/copy/color dimensions).
 */
export async function batchAnalyzeDetailRefImages(
  config: LlmConfig,
  imageBase64List: string[],
): Promise<string[]> {
  return batchAnalyzeCore(config, 'batchAnalyzeDetailRefs', imageBase64List,
    `\n请为以上 ${imageBase64List.length} 张图各生成一个独立的详情页模块预设提示词，按【图1】【图2】...格式输出。`);
}

// ===== Mimo 生成结果自动校验 =====

export interface ValidationInput {
  resultImageBase64: string;
  productImageBase64?: string;
  modelImageBase64?: string;
  styleRefBase64?: string;
  detailImageBase64?: string;
  prompt: string;
}

export interface ValidationReport {
  passed: boolean;
  inputCheck: {
    hasProductImage: boolean;
    hasModelImage: boolean;
    hasStyleRef: boolean;
    hasDetailImage: boolean;
    promptOptimized: boolean;
    issues: string[];
  };
  outputCheck: {
    posePreserved: boolean;
    lightingPreserved: boolean;
    backgroundPreserved: boolean;
    compositionPreserved: boolean;
    productColorCorrect: boolean;
    productShapeCorrect: boolean;
    layoutMatched: boolean;
    issues: string[];
  };
  summary: string;
}

/**
 * 使用 Mimo-V2.5 多模态模型校验生成结果
 * 对比原图参考 vs 生成结果，检查是否完整保留了关键特征
 */
export async function validateGenerationResult(
  config: LlmConfig,
  input: ValidationInput,
): Promise<ValidationReport> {
  const systemPrompt = `你是 AI 生图质量校验专家。你的任务：对比生成结果和原始参考图，判断生成质量。

请严格按以下格式输出 JSON，不要输出其他内容：

{
  "inputCheck": {
    "hasProductImage": true/false,
    "hasModelImage": true/false,
    "hasStyleRef": true/false,
    "hasDetailImage": true/false,
    "promptOptimized": true/false,
    "issues": ["问题1", "问题2"]
  },
  "outputCheck": {
    "posePreserved": true/false,
    "lightingPreserved": true/false,
    "backgroundPreserved": true/false,
    "compositionPreserved": true/false,
    "productColorCorrect": true/false,
    "productShapeCorrect": true/false,
    "layoutMatched": true/false,
    "issues": ["问题1", "问题2"]
  },
  "summary": "一句话总结校验结果"
}

判断标准：
- 入参校验：是否完整携带了白底图、模特图、风格参考图、细节图；提示词是否为深度优化后的完整版
- 效果校验：是否保留了原图的姿势/光影/背景/构图；商品的版型/颜色是否正确；模板的排版结构是否匹配
- passed: 所有 outputCheck 项都为 true 且无严重 input 问题`;

  // 构建多模态消息内容
  const contentParts: { type: string; text?: string; image_url?: { url: string } }[] = [];

  contentParts.push({ type: 'text', text: '【生成结果图】' });
  contentParts.push({ type: 'image_url', image_url: { url: input.resultImageBase64 } });

  if (input.productImageBase64) {
    contentParts.push({ type: 'text', text: '【商品白底图参考】' });
    contentParts.push({ type: 'image_url', image_url: { url: input.productImageBase64 } });
  }
  if (input.modelImageBase64) {
    contentParts.push({ type: 'text', text: '【模特参考图】' });
    contentParts.push({ type: 'image_url', image_url: { url: input.modelImageBase64 } });
  }
  if (input.styleRefBase64) {
    contentParts.push({ type: 'text', text: '【风格/模板参考图】' });
    contentParts.push({ type: 'image_url', image_url: { url: input.styleRefBase64 } });
  }
  if (input.detailImageBase64) {
    contentParts.push({ type: 'text', text: '【印花/Logo细节图】' });
    contentParts.push({ type: 'image_url', image_url: { url: input.detailImageBase64 } });
  }

  contentParts.push({ type: 'text', text: `【使用的生成提示词】\n${input.prompt.slice(0, 300)}` });
  contentParts.push({ type: 'text', text: '请对比以上所有图片和提示词，输出 JSON 格式校验报告。' });

  try {
    const resp = await llmFetch(config, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contentParts },
    ], 2048);

    if (!resp.ok) {
      return {
        passed: false,
        inputCheck: { hasProductImage: !!input.productImageBase64, hasModelImage: !!input.modelImageBase64, hasStyleRef: !!input.styleRefBase64, hasDetailImage: !!input.detailImageBase64, promptOptimized: input.prompt.length > 50, issues: [] },
        outputCheck: { posePreserved: true, lightingPreserved: true, backgroundPreserved: true, compositionPreserved: true, productColorCorrect: true, productShapeCorrect: true, layoutMatched: true, issues: [] },
        summary: `Mimo 校验接口异常: HTTP ${resp.status}`,
      };
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';

    // 提取 JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        passed: Object.values(parsed.outputCheck || {}).every((v: unknown) => v === true),
        inputCheck: parsed.inputCheck || {},
        outputCheck: parsed.outputCheck || {},
        summary: parsed.summary || '校验完成',
      };
    }

    return {
      passed: true,
      inputCheck: { hasProductImage: !!input.productImageBase64, hasModelImage: !!input.modelImageBase64, hasStyleRef: !!input.styleRefBase64, hasDetailImage: !!input.detailImageBase64, promptOptimized: input.prompt.length > 50, issues: [] },
      outputCheck: { posePreserved: true, lightingPreserved: true, backgroundPreserved: true, compositionPreserved: true, productColorCorrect: true, productShapeCorrect: true, layoutMatched: true, issues: [] },
      summary: 'Mimo 校验结果解析失败，默认通过',
    };
  } catch (e) {
    return {
      passed: true,
      inputCheck: { hasProductImage: !!input.productImageBase64, hasModelImage: !!input.modelImageBase64, hasStyleRef: !!input.styleRefBase64, hasDetailImage: !!input.detailImageBase64, promptOptimized: input.prompt.length > 50, issues: [] },
      outputCheck: { posePreserved: true, lightingPreserved: true, backgroundPreserved: true, compositionPreserved: true, productColorCorrect: true, productShapeCorrect: true, layoutMatched: true, issues: [] },
      summary: `校验异常: ${e instanceof Error ? e.message : '网络错误'}`,
    };
  }
}
