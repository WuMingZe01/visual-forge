/**
 * Pipeline stage implementations.
 * Each stage is a pure async function: (ctx, config) => Promise<void>
 * Stages communicate via PipelineContext — they read from and write to ctx.
 */

import { syncKeyPools, getTotalCapacity, getPoolCapacity, allocateTasks, availableKeyCount, type KeyAssignment } from '@/services/keyPool';
import { getProvider } from '@/services/tryonApi';
import { generateTryOnImage } from '@/services/tryonApi';
import {
  analyzeModelImage, analyzeProductImage, assembleFinalPrompt,
  validateGenerationResult,
} from '@/services/llmService';
import { buildProductInfoString } from '@/hooks/useAIPrompt';
import { loadImage } from '@/services/imageStore';
import { compressImageForRef } from '@/utils/image';
import type { PipelineContext, ImageGenTask, RowImages, BatchRow } from './types';

// ===== Helpers =====

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

async function blobUrlToFile(url: string, name: string): Promise<File> {
  const resp = await fetch(url);
  const blob = await resp.blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }).catch(e => { clearTimeout(t); reject(e); });
  });
}

// ===== Stage 1: Prepare =====

export async function stagePrepare(ctx: PipelineContext): Promise<void> {
  ctx.onProgress({ stage: 'prepare', step: 0, total: 0, message: '准备中...' });

  // Validate
  const activeRows = ctx.rows.filter(r => r.status !== 'done');
  if (activeRows.length === 0) throw new Error('没有待生成的行');

  // Sync key pools
  syncKeyPools();

  // Calculate concurrency
  const effectiveConcurrency = Math.min(
    ctx.useHybrid
      ? getTotalCapacity()
      : getPoolCapacity(getProvider(ctx.modelId)),
    36,
  );

  // Store in context for later stages
  (ctx as any)._concurrency = effectiveConcurrency;
  (ctx as any)._activeRows = activeRows;

  ctx.onProgress({ stage: 'prepare', step: 1, total: 1, message: `就绪 · ${activeRows.length} 款 · ${effectiveConcurrency}路并发` });
}

// ===== Stage 2: Analyze (LLM multimodal analysis + prompt assembly) =====

export async function stageAnalyze(ctx: PipelineContext, config?: Record<string, unknown>): Promise<void> {
  const visionModel = ctx.visionModel;
  const textModel = ctx.textModel;
  if (!visionModel || !textModel) {
    ctx.onProgress({ stage: 'analyze', step: 0, total: 0, message: '跳过 LLM 分析（模型未配置）' });
    return;
  }

  const activeRows = (ctx as any)._activeRows || ctx.rows.filter(r => r.status !== 'done');
  const useModelAnalysis = config?.useModelAnalysis !== false;
  const useProductAnalysis = config?.useProductAnalysis !== false;

  // Semaphore for LLM concurrency
  const llmMax = 3;
  const sem = { n: 0, q: [] as (() => void)[] };
  const acq = async () => {
    if (sem.n < llmMax) { sem.n++; return; }
    await new Promise<void>(r => sem.q.push(r));
    sem.n++;
  };
  const rel = () => { sem.n--; sem.q.shift()?.(); };

  // Reference image cache
  const refCache = new Map<string, string>();
  async function getRefB64(id: string, type: string): Promise<string> {
    const key = `${id}_${type}`;
    if (refCache.has(key)) return refCache.get(key)!;
    const cached = await loadImage(key);
    if (cached) { refCache.set(key, cached); return cached; }
    return '';
  }

  let completed = 0;
  const total = activeRows.length;

  await Promise.all(activeRows.map(async (row: BatchRow) => {
    if (ctx.abortRef.current) return;
    await acq();
    try {
      const hasSku = !!row.skuCode.trim();

      // Load images
      let productB64 = await getRefB64(row.id, 'front');
      if (!productB64 && row.frontImage?.previewUrl) {
        try {
          const pf = await withTimeout(blobUrlToFile(row.frontImage.previewUrl, row.frontImage.name), 15000, `product ${row.skuCode}`);
          productB64 = await withTimeout(compressImageForRef(pf), 15000, `compress ${row.skuCode}`);
        } catch { /* ignore */ }
      }

      let modelB64 = await getRefB64(row.id, 'model');
      if (!modelB64 && row.modelImage?.previewUrl) {
        try {
          const mf = await withTimeout(blobUrlToFile(row.modelImage.previewUrl, row.modelImage.name), 15000, `model ${row.skuCode}`);
          modelB64 = await withTimeout(compressImageForRef(mf), 15000, `compress ${row.skuCode}`);
        } catch { /* ignore */ }
      }

      let styleB64: string | undefined;
      if (row.styleImage?.previewUrl) {
        try {
          const sf = await withTimeout(blobUrlToFile(row.styleImage.previewUrl, row.styleImage.name), 15000, `style ${row.skuCode}`);
          styleB64 = await withTimeout(compressImageForRef(sf), 15000, `compress ${row.skuCode}`);
        } catch { /* ignore */ }
      }

      // Store images
      ctx.rowImages.set(row.id, { productB64, modelB64, styleRefB64: styleB64 });

      // AI prompt assembly
      let finalPrompt = row.prompt;
      if (textModel && (hasSku || ctx.selectedModelId)) {
        try {
          let invariant = '';
          let merged = '';

          // Analyze model image (invariant features)
          if (useModelAnalysis && modelB64) {
            ctx.onProgress({ stage: 'analyze', step: completed + 1, total, message: `分析模特特征 · ${row.skuCode || row.id.slice(-6)}` });
            invariant = await analyzeModelImage(visionModel!, modelB64);
          }

          // Build product info
          const parts: string[] = [];

          // Style management reverse prompt
          if (row.lingmaoData?.reversePrompt) {
            parts.push(`【白底图反推提示词 — 来自款式管理】\n${row.lingmaoData.reversePrompt}`);
          }

          // Analyze product/style reference
          if (useProductAnalysis && styleB64) {
            ctx.onProgress({ stage: 'analyze', step: completed + 1, total, message: `分析风格特征 · ${row.skuCode || row.id.slice(-6)}` });
            const styleAnalysis = await analyzeProductImage(visionModel!, styleB64);
            if (styleAnalysis) parts.push(`【风格参考图视觉特征】\n${styleAnalysis}`);
          }

          // Lingmao ERP data
          if (ctx.hasLingmaoData && row.lingmaoData) {
            const info = buildProductInfoString(row.lingmaoData);
            if (info) parts.push(`【领猫商品资料】\n${info}`);
          }

          merged = parts.join('\n\n');

          // Assemble final prompt
          if (invariant || merged) {
            ctx.onProgress({ stage: 'analyze', step: completed + 1, total, message: `整合提示词 · ${row.skuCode || row.id.slice(-6)}` });
            finalPrompt = await assembleFinalPrompt(textModel, invariant, merged);
          }
        } catch (e) {
          console.warn(`[pipeline] LLM analysis failed for ${row.skuCode}:`, e);
        }
      }

      // Fallback prompt
      if (!finalPrompt) {
        finalPrompt = `Professional product photo of a fashion item, clean background, studio lighting, high quality, 8K, commercial photography`;
      }

      ctx.rowPrompts.set(row.id, finalPrompt);
    } finally {
      completed++;
      rel();
    }
  }));

  ctx.onProgress({ stage: 'analyze', step: total, total, message: `LLM 分析完成 · ${total} 款` });
}

// ===== Stage 3: Generate (concurrent image generation) =====

export async function stageGenerate(ctx: PipelineContext): Promise<void> {
  const activeRows = (ctx as any)._activeRows || ctx.rows.filter(r => r.status !== 'done');
  const concurrency = (ctx as any)._concurrency || 36;

  // Build task queue
  const queue: ImageGenTask[] = [];
  let hybridAssignments: KeyAssignment[] = [];
  let hybridCursor = 0;

  if (ctx.useHybrid) {
    const totalTasks = activeRows.reduce((sum: number, r: BatchRow) => sum + (r.count || 1), 0);
    hybridAssignments = allocateTasks(totalTasks);
  }

  for (const row of activeRows) {
    const images = ctx.rowImages.get(row.id);
    const prompt = ctx.rowPrompts.get(row.id) || row.prompt;
    const count = row.count || 1;
    const productB64 = images?.productB64 || '';
    const modelB64 = images?.modelB64 || '';
    const styleRefB64 = images?.styleRefB64;
    const detailB64 = images?.detailB64;

    for (let idx = 0; idx < count; idx++) {
      let taskModelId = ctx.modelId;
      if (ctx.useHybrid && hybridAssignments.length > 0) {
        const assign = hybridAssignments[hybridCursor % hybridAssignments.length];
        hybridCursor++;
        taskModelId = assign.provider === 'yunwu' ? 'gpt-image-2-all' : 'gpt-image-2-vip';
      }
      queue.push({
        rowId: row.id, skuCode: row.skuCode,
        productB64, modelB64, styleRefB64, detailB64,
        prompt, count, idxInRow: idx,
        modelId: taskModelId,
        width: ctx.width, height: ctx.height,
      });
    }
  }

  // Worker function
  let llmDone = false;
  let queueIdx = 0;
  let completedCount = 0;
  const totalTasks = queue.length;
  const queueLock = { waiting: null as (() => void) | null };

  const notifyGen = () => {
    const w = queueLock.waiting;
    if (w) { queueLock.waiting = null; w(); }
  };

  const workOne = async (): Promise<void> => {
    while (true) {
      if (ctx.abortRef.current) return;

      let task: ImageGenTask | undefined;
      const idx = queueIdx++;
      if (idx < queue.length) {
        task = queue[idx];
      } else {
        queueIdx--;
        if (llmDone) return;
        await new Promise<void>(r => { queueLock.waiting = r; });
        queueLock.waiting = null;
        continue;
      }

      try {
        const realUrl = await generateTryOnImage({
          prompt: task!.prompt,
          productImageBase64: task!.productB64,
          modelImageBase64: task!.modelB64,
          styleRefBase64: task!.styleRefB64,
          detailImageBase64: task!.detailB64,
          width: task!.width, height: task!.height,
          modelId: task!.modelId,
          skipCooldown: true,
          signal: ctx.signal,
        });

        completedCount++;
        ctx.onProgress({ stage: 'generate', step: completedCount, total: totalTasks, message: `生图 ${completedCount}/${totalTasks} · ${task!.skuCode}` });

        const entry = ctx.rowResults.get(task!.rowId) || { urls: [], error: '' };
        entry.urls.push(realUrl);
        ctx.rowResults.set(task!.rowId, entry);

        ctx.onRowResult(task!.rowId, [realUrl], []);
      } catch (e) {
        if (ctx.abortRef.current) return;
        completedCount++;
        const errMsg = e instanceof Error ? e.message : String(e);
        const entry = ctx.rowResults.get(task!.rowId) || { urls: [], error: '' };
        entry.error = entry.error ? entry.error + '; ' + errMsg.slice(0, 80) : errMsg.slice(0, 80);
        ctx.rowResults.set(task!.rowId, entry);

        ctx.onRowResult(task!.rowId, [], [`#${task!.idxInRow + 1}: ${errMsg.slice(0, 80)}`]);
      }
    }
  };

  // Start workers
  ctx.onProgress({ stage: 'generate', step: 0, total: totalTasks, message: `${concurrency}路并发 · 流式生图` });
  const workers = Array.from({ length: concurrency }, () => workOne());

  // Mark LLM phase done (in pipeline mode, analysis happens before generate)
  llmDone = true;
  notifyGen();

  // Wait for all workers
  await Promise.race([
    Promise.all(workers),
    new Promise<void>(r => setTimeout(r, 480000)),
  ]);

  ctx.onProgress({ stage: 'generate', step: totalTasks, total: totalTasks, message: `生图完成 · ${completedCount} 张` });
}

// ===== Stage 4: Validate (Mimo quality validation) =====

export async function stageValidate(ctx: PipelineContext, config?: Record<string, unknown>): Promise<void> {
  const visionModel = ctx.visionModel;
  if (!visionModel) {
    ctx.onProgress({ stage: 'validate', step: 0, total: 0, message: '跳过校验（无视觉模型）' });
    return;
  }

  const activeRows = (ctx as any)._activeRows || ctx.rows.filter(r => r.status !== 'done');
  const timeoutMs = (config?.timeoutMs as number) || 30000;
  let validated = 0;

  for (const row of activeRows) {
    if (ctx.abortRef.current) return;

    const results = ctx.rowResults.get(row.id);
    if (!results || results.urls.length === 0) continue;

    const resultUrl = results.urls[0];
    const images = ctx.rowImages.get(row.id);
    const prompt = ctx.rowPrompts.get(row.id) || row.prompt;

    try {
      // Fetch result image as base64
      let resultB64 = '';
      try {
        const resp = await fetch(resultUrl);
        const blob = await resp.blob();
        resultB64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch { /* skip if can't fetch */ }

      if (!resultB64) continue;

      ctx.onProgress({ stage: 'validate', step: validated + 1, total: activeRows.length, message: `校验中 · ${row.skuCode || row.id.slice(-6)}` });

      const report = await Promise.race([
        validateGenerationResult(visionModel, {
          resultImageBase64: resultB64,
          productImageBase64: images?.productB64 || undefined,
          modelImageBase64: images?.modelB64 || undefined,
          prompt,
        }),
        new Promise<null>(r => setTimeout(() => r(null), timeoutMs)),
      ]);

      validated++;
      if (report) {
        (ctx as any)._validationReports = (ctx as any)._validationReports || new Map();
        (ctx as any)._validationReports.set(row.id, report);
      }
    } catch {
      // Validation failure shouldn't affect the main flow
    }
  }

  ctx.onProgress({ stage: 'validate', step: validated, total: activeRows.length, message: `校验完成 · ${validated} 款` });
}

// ===== Stage 5: Finalize =====

export async function stageFinalize(ctx: PipelineContext): Promise<void> {
  ctx.onProgress({ stage: 'finalize', step: 0, total: 0, message: '完成' });
  // Finalization is handled by the caller (page) since it involves React state
}

// ===== Stage Registry =====

export const stageRegistry: Record<string, (ctx: PipelineContext, config?: Record<string, unknown>) => Promise<void>> = {
  prepare: stagePrepare,
  analyze: stageAnalyze,
  generate: stageGenerate,
  validate: stageValidate,
  finalize: stageFinalize,
};
