/**
 * Pipeline adapter for BatchGenerate page.
 * Bridges React state management (flush timer, task history, UI callbacks)
 * with the pipeline engine.
 *
 * Usage from BatchGenerate.tsx handleRun:
 *   await runBatchWithPipeline({ ... });
 */

import React from 'react';
import { runPipeline, MAIN_BATCH_WORKFLOW } from './index';
import type { PipelineContext, PipelineProgress, BatchRow } from './types';
import type { WorkflowConfig } from './types';
import { syncKeyPools } from '@/services/keyPool';
import { getProvider } from '@/services/tryonApi';
import { compressImageForLLM, compressImageForRef, blobUrlToFile, withTimeout } from '@/utils/image';
import { loadImage } from '@/services/imageStore';

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

export interface BatchAdapterInput {
  // React state
  rows: BatchRow[];
  globalModel: string;
  globalResolution: { width: number; height: number } | undefined;
  isHybrid: boolean;
  hasLingmaoData: boolean;

  // Models & config
  visionModel: any;
  textModel: any;
  logoImage: { previewUrl?: string; name?: string } | null;
  selectedModelId: string;

  // Control
  abortRef: { current: boolean };

  // Callbacks
  onProgress: (msg: string) => void;
  onPromptUpdate: (rowId: string, prompt: string) => void;

  // Result storage (mutated in-place)
  rowResultsRef: React.MutableRefObject<Map<string, { urls: string[]; error: string }>>;
  pendingRef: React.MutableRefObject<Map<string, { urls: string[]; errors: string[]; runningIdx: number }>>;

  // Task history
  batchId: string;
  batchLabel: string;
  addTask: (task: any) => void;
  updateTask: (id: string, updates: Record<string, unknown>) => void;

  // Auto download
  autoDownload: boolean;
  saveFolderHandle: FileSystemDirectoryHandle | null;

  // Flush timer control
  startFlushTimer: () => void;
  stopFlushTimer: () => void;

  // Notification
  addToast: (type: 'error' | 'success' | 'info' | 'warning', msg: string) => void;

  // Set generating state on rows
  setRowsGenerating: (rowIds: Set<string>) => void;

  // Optional workflow override
  workflow?: WorkflowConfig;
}

export async function runBatchWithPipeline(input: BatchAdapterInput): Promise<void> {
  const {
    rows, globalModel, globalResolution, isHybrid, hasLingmaoData,
    visionModel, textModel, logoImage, selectedModelId,
    abortRef, rowResultsRef, pendingRef,
    batchId, batchLabel,
    addTask, updateTask,
    autoDownload, saveFolderHandle,
    onProgress, onPromptUpdate,
    startFlushTimer, stopFlushTimer, addToast,
    setRowsGenerating,
    workflow = MAIN_BATCH_WORKFLOW,
  } = input;

  // Filter active rows
  const targetRows = rows.filter(r => r.status !== 'done');
  if (targetRows.length === 0) {
    addToast('warning', '没有待生成的行');
    return;
  }

  // Validate white-background images
  const noFrontImg = targetRows.filter(r => !r.frontImage?.previewUrl);
  if (noFrontImg.length === targetRows.length) {
    const codes = noFrontImg.map(r => r.skuCode || '未命名').slice(0, 5).join('、');
    addToast('error', `${noFrontImg.length} 个款号缺少商品白底图（${codes}...）`);
    return;
  }
  if (noFrontImg.length > 0) {
    const codes = noFrontImg.map(r => r.skuCode || '未命名').slice(0, 5).join('、');
    addToast('warning', `${noFrontImg.length} 个款号缺少商品白底图（${codes}...），生成结果可能不准确`);
  }

  if (!visionModel || !textModel) {
    addToast('warning', '请先在系统设置中启用 LLM 模型');
    return;
  }

  syncKeyPools();
  abortRef.current = false;
  rowResultsRef.current = new Map();

  // Create task history entries
  const batchTaskIds = new Map<string, string>();
  for (const r of targetRows) {
    const tid = genId();
    batchTaskIds.set(r.id, tid);
    addTask({
      id: tid, type: 'tryon',
      skuCode: r.skuCode || '未命名', productName: r.productName || '',
      modelId: globalModel, provider: isHybrid ? 'hybrid' : getProvider(globalModel),
      prompt: r.prompt?.slice(0, 200) || '',
      params: { model: globalModel, resolution: `${globalResolution?.width || 2448}x${globalResolution?.height || 3264}` },
      status: 'generating', progress: 0, resultUrls: [], referenceUrls: [],
      error: '', createdAt: new Date().toISOString(),
      batchId, batchLabel,
    });
  }

  // Mark target rows as generating
  const generatingIds = new Set(targetRows.map(r => r.id));
  setRowsGenerating(generatingIds);

  startFlushTimer();

  const preset = globalResolution || { width: 2448, height: 3264 };

  // Build pipeline context
  const pipelineCtx: PipelineContext = {
    rows: targetRows,
    visionModel,
    textModel,
    modelId: globalModel,
    width: preset.width,
    height: preset.height,
    useHybrid: isHybrid,
    hasLingmaoData,
    selectedModelId,
    rowImages: new Map(),
    rowPrompts: new Map(),
    rowResults: rowResultsRef.current,
    abortRef,
    onProgress: (evt: PipelineProgress) => {
      onProgress(evt.message);
    },
    onRowResult: (rowId: string, urls: string[], errors: string[]) => {
      // Write to pendingRef for flush timer
      const pen = pendingRef.current.get(rowId) || { urls: [], errors: [], runningIdx: 0 };
      pen.urls.push(...urls);
      pen.errors.push(...errors);
      pen.runningIdx += urls.length + errors.length;
      pendingRef.current.set(rowId, pen);

      // Update task history
      const tid = batchTaskIds.get(rowId);
      if (tid) {
        const row = targetRows.find(r => r.id === rowId);
        const currentData = rowResultsRef.current.get(rowId);
        const planned = row?.count || 1;
        const actual = currentData ? currentData.urls.length : 0;
        const isComplete = actual >= planned;

        updateTask(tid, {
          progress: planned > 0 ? Math.round((actual / planned) * 100) : 0,
          resultUrls: currentData?.urls.slice(0, 20) || [],
          ...(isComplete ? { status: 'completed', completedAt: new Date().toISOString() } : {}),
        });
      }

      // Auto-download
      if (autoDownload && saveFolderHandle && urls.length > 0) {
        const row = targetRows.find(r => r.id === rowId);
        const skuName = row?.skuCode || `manual_${rowId.slice(-6)}`;
        (async () => {
          try {
            const subFolder = await saveFolderHandle.getDirectoryHandle(skuName, { create: true });
            for (let i = 0; i < urls.length; i++) {
              const resp = await fetch(urls[i]);
              const blob = await resp.blob();
              const fh = await subFolder.getFileHandle(`${skuName}_${i + 1}.png`, { create: true });
              const w = await fh.createWritable(); await w.write(blob); await w.close();
            }
          } catch { /* auto-download failure is non-blocking */ }
        })();
      }
    },
  };

  // Logo preprocessing
  if (logoImage?.previewUrl) {
    try {
      const lf = await withTimeout(
        blobUrlToFile(logoImage.previewUrl, logoImage.name || 'logo.png'),
        15000, 'logoFile',
      );
      pipelineCtx.logoB64 = await withTimeout(compressImageForLLM(lf), 15000, 'logoCompress');
    } catch { /* non-blocking */ }
  }

  try {
    onProgress('管道引擎启动...');
    await runPipeline(workflow, pipelineCtx);

    // Sync prompts back to React state
    for (const [rowId, prompt] of pipelineCtx.rowPrompts) {
      onPromptUpdate(rowId, prompt);
    }

    // Finalize all task history entries
    for (const targetRow of targetRows) {
      const tid = batchTaskIds.get(targetRow.id);
      if (!tid) continue;
      const rowData = rowResultsRef.current.get(targetRow.id);
      const planned = targetRow.count || 1;
      const actual = rowData ? rowData.urls.length : 0;
      const errMsg = rowData?.error || '';
      const finalStatus = abortRef.current
        ? 'failed'
        : (actual >= planned ? 'completed' : (actual > 0 ? 'partial' : 'failed'));
      updateTask(tid, {
        status: finalStatus,
        progress: 100,
        resultUrls: rowData?.urls.slice(0, 20) || [],
        error: abortRef.current ? '用户终止' : (errMsg?.slice(0, 500) || (actual === 0 ? '未返回结果' : '')),
        completedAt: new Date().toISOString(),
      });
    }

    onProgress(abortRef.current ? '已终止' : `完成 · ${targetRows.length} 款`);
  } catch (e) {
    console.error('[PipelineAdapter] error:', e);
    // Mark all pending tasks as failed
    for (const targetRow of targetRows) {
      const tid = batchTaskIds.get(targetRow.id);
      if (!tid) continue;
      const rowData = rowResultsRef.current.get(targetRow.id);
      updateTask(tid, {
        status: 'failed',
        progress: 100,
        resultUrls: rowData?.urls.slice(0, 20) || [],
        error: (e instanceof Error ? e.message : '未知错误').slice(0, 500),
        completedAt: new Date().toISOString(),
      });
    }
    addToast('error', '批量处理失败: ' + (e instanceof Error ? e.message : '未知错误'));
  } finally {
    stopFlushTimer();
  }
}
