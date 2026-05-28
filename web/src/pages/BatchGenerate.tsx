import { useState, useRef, useMemo, useCallback, memo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Layers, Play, Upload, X, Loader2, FolderOpen, Info, Trash2, Settings,
  Camera, CheckCircle2, AlertTriangle, User, Download, StopCircle, RefreshCw,
  Minus, Plus, FolderDown, PlusCircle, History, ZoomIn
} from 'lucide-react';
import { useTaskHistoryStore } from '@/store/useTaskHistoryStore';
import { useLlmStore } from '@/store/useLlmStore';
import { useAppStore } from '@/store/useAppStore';
import { useModelStore } from '@/store/useModelStore';
import { useTemplateStore } from '@/store/useTemplateStore';
import type { ReferenceImage, SKUInfo } from '@/types/tryon-types';
import { AI_MODELS_FOR_TRYON, RESOLUTION_PRESETS } from '@/types/tryon-types';
import { generateTryOnImage, getStoredModelConfig, isModelEnabled, getProvider } from '@/services/tryonApi';
import { availableKeyCount, totalAvailableKeys, syncKeyPools } from '@/services/keyPool';
import { queryStyleByCode } from '@/services/lingmao';
import { analyzeModelImage, analyzeProductImage, analyzeProductWithLogo, assembleFinalPrompt } from '@/services/llmService';
import { buildProductInfoString } from '@/hooks/useAIPrompt';
import { compressImageForLLM, compressImageForRef, blobUrlToFile, withTimeout } from '@/utils/image';
import { saveImage, loadImage, deleteImage, clearAll as clearImageStore } from '@/services/imageStore';
import { ImageCompareModal, type CompareImage } from '@/components/ImageCompareModal';

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function buildInfoLines(sku: SKUInfo | null): string[] {
  if (!sku) return [];
  const lines: string[] = [];
  if (sku.productName) lines.push(`名称：${sku.productName}`);
  if (sku.brand) lines.push(`品牌：${sku.brand}`);
  if (sku.year) lines.push(`年份：${sku.year}  ${sku.season || ''}`);
  if (sku.category) lines.push(`品类：${sku.category}`);
  if (sku.gender) lines.push(`性别：${sku.gender}`);
  if (sku.composition) lines.push(`成分：${sku.composition}`);
  if (sku.fabricIntro) lines.push(`面料：${sku.fabricIntro.slice(0, 60)}`);
  if (sku.fabricCategory) lines.push(`面料类别：${sku.fabricCategory}`);
  if (sku.fabricWeight) lines.push(`克重：${sku.fabricWeight}g`);
  if (sku.profileIntro) lines.push(`版型：${sku.profileIntro}`);
  if (sku.collarType) lines.push(`领型：${sku.collarType}`);
  if (sku.shoulderType) lines.push(`肩型：${sku.shoulderType}`);
  if (sku.sleeveType) lines.push(`袖型：${sku.sleeveType}`);
  if (sku.hemDesign) lines.push(`下摆：${sku.hemDesign}`);
  if (sku.thicknessElastic) lines.push(`厚薄/弹性：${sku.thicknessElastic}`);
  if (sku.saleInfo) lines.push(`卖点：${sku.saleInfo.slice(0, 80)}`);
  if (sku.processDesc) lines.push(`工艺：${sku.processDesc.slice(0, 40)}`);
  if (sku.supplierName) lines.push(`供应商：${sku.supplierName}`);
  if (sku.standardRule) lines.push(`执行标准：${sku.standardRule}`);
  if (sku.safeLevel) lines.push(`安全等级：${sku.safeLevel}`);
  return lines;
}

interface BatchRow {
  id: string;
  skuCode: string;
  productName: string;
  frontImage: ReferenceImage | null;
  backImage: ReferenceImage | null;
  modelImage: ReferenceImage | null;
  prompt: string;
  lingmaoData: SKUInfo | null;
  status: 'idle' | 'generating' | 'done' | 'failed';
  resultUrls: string[];
  error: string;
  runningIdx: number;
  count: number;
}

type BatchMode = 'shared' | 'individual';

// ===== 行组件 (memoized) =====
const BatchTableRow = memo(function BatchTableRow({
  row, mode, allModels, isRunning, onUpdate, onRemove, onModelUpload, onDownloadSingle, onRetry, onCompare,
}: {
  row: BatchRow;
  mode: BatchMode;
  allModels: { id: string; name: string }[];
  isRunning: boolean;
  onUpdate: (id: string, u: Partial<BatchRow>) => void;
  onRemove: (id: string) => void;
  onModelUpload: (id: string, f: File) => Promise<void> | void;
  onDownloadSingle: (row: BatchRow) => void;
  onRetry: (id: string) => void;
  onCompare: (row: BatchRow, index: number) => void;
}) {
  const hasSku = !!row.skuCode.trim();
  const previewUrls = useMemo(
    () => row.resultUrls.slice(0, 4).map((u) => u + (u.includes('?') ? '&' : '?') + 'thumb=1'),
    [row.resultUrls]
  );

  return (
    <tr className={`border-b border-forge-border/20 hover:bg-forge-surface2/20 transition-all ${
      row.status === 'generating' ? 'bg-forge-cyan/5' : row.status === 'done' ? 'bg-forge-green/5' : row.status === 'failed' ? 'bg-forge-red/5' : ''
    }`}>
      {/* SKU Code + Name */}
      <td className="py-2 px-2">
        {hasSku ? (
          <>
            <span className="text-forge-cyan font-mono font-bold text-[9px] block">{row.skuCode}</span>
            {row.productName && <span className="text-forge-text2/50 text-[10px] truncate block max-w-16">{row.productName}</span>}
            {row.lingmaoData && <span className="text-forge-green text-[10px] flex items-center gap-0.5 mt-0.5"><CheckCircle2 size={7} />已关联</span>}
          </>
        ) : (
          <input
            value={row.skuCode}
            onChange={(e) => onUpdate(row.id, { skuCode: e.target.value })}
            placeholder="输入款号"
            className="input-field !py-1 text-[9px] w-16"
          />
        )}
      </td>

      {/* Model Image (individual mode only) */}
      {mode === 'individual' && (
        <td className="py-2 px-1">
          {row.modelImage?.previewUrl ? (
            <div className="relative inline-flex">
              <img src={row.modelImage.previewUrl} alt="" loading="lazy" className="w-8 h-11 object-cover rounded border border-forge-border/30" />
              <button onClick={() => onUpdate(row.id, { modelImage: null })} className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={6} /></button>
            </div>
          ) : row.modelImage ? (
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) onModelUpload(row.id, f); }; inp.click(); }}
              className="p-1 rounded border border-dashed border-forge-border/40 text-forge-text2/30 hover:text-forge-cyan hover:border-forge-cyan/30 text-[10px] flex items-center gap-0.5"><Upload size={8} />重传</button>
          ) : (
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) onModelUpload(row.id, f); }; inp.click(); }}
              className="p-1 rounded border border-dashed border-forge-border/40 text-forge-text2/30 hover:text-forge-cyan hover:border-forge-cyan/30 text-[10px] flex items-center gap-0.5"><Upload size={8} />上传</button>
          )}
        </td>
      )}

      {/* Front Image */}
      <td className="py-2 px-1">
        {row.frontImage?.previewUrl ? (
          <div className="relative inline-flex"><img src={row.frontImage.previewUrl} alt="" loading="lazy" className="w-8 h-11 object-cover rounded border border-forge-border/30" /><span className="absolute bottom-0 left-0 bg-forge-cyan/70 text-forge-bg text-[6px] px-0.5 rounded-tr">正</span></div>
        ) : row.frontImage ? (
          <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) { onUpdate(row.id, { frontImage: { id: genId(), type: 'product_front', previewUrl: URL.createObjectURL(f), name: f.name, size: f.size } }); } }; inp.click(); }}
            className="p-1 rounded border border-dashed border-forge-border/40 text-forge-text2/30 hover:text-forge-cyan text-[10px] flex items-center gap-0.5"><Upload size={8} />重传</button>
        ) : (
          <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) { onUpdate(row.id, { frontImage: { id: genId(), type: 'product_front', previewUrl: URL.createObjectURL(f), name: f.name, size: f.size } }); } }; inp.click(); }}
            className="p-1 rounded border border-dashed border-forge-border/40 text-forge-text2/30 hover:text-forge-cyan text-[10px] flex items-center gap-0.5"><Upload size={8} />上传</button>
        )}
      </td>

      {/* Back Image */}
      <td className="py-2 px-1">
        {row.backImage?.previewUrl ? (
          <div className="relative inline-flex"><img src={row.backImage.previewUrl} alt="" loading="lazy" className="w-8 h-11 object-cover rounded border border-forge-border/30" /><span className="absolute bottom-0 left-0 bg-forge-orange/70 text-forge-bg text-[6px] px-0.5 rounded-tr">反</span></div>
        ) : row.backImage ? (
          <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) { onUpdate(row.id, { backImage: { id: genId(), type: 'product_back', previewUrl: URL.createObjectURL(f), name: f.name, size: f.size } }); } }; inp.click(); }}
            className="p-1 rounded border border-dashed border-forge-border/40 text-forge-text2/30 hover:text-forge-cyan text-[10px] flex items-center gap-0.5"><Upload size={8} />重传</button>
        ) : (
          <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) { onUpdate(row.id, { backImage: { id: genId(), type: 'product_back', previewUrl: URL.createObjectURL(f), name: f.name, size: f.size } }); } }; inp.click(); }}
            className="p-1 rounded border border-dashed border-forge-border/40 text-forge-text2/30 hover:text-forge-cyan text-[10px] flex items-center gap-0.5"><Upload size={8} />上传</button>
        )}
      </td>

      {/* Count */}
      <td className="py-2 px-1">
        <div className="flex items-center gap-0.5">
          <button onClick={() => onUpdate(row.id, { count: Math.max(1, row.count - 1) })} className="p-0.5 rounded text-forge-text2/40 hover:text-forge-cyan"><Minus size={9} /></button>
          <span className="w-4 text-center font-mono text-forge-cyan text-[10px]">{row.count}</span>
          <button onClick={() => onUpdate(row.id, { count: Math.min(8, row.count + 1) })} className="p-0.5 rounded text-forge-text2/40 hover:text-forge-cyan"><Plus size={9} /></button>
        </div>
      </td>

      {/* Prompt */}
      <td className="py-2 px-2">
        {hasSku ? (
          <div className="max-w-48">
            {row.prompt ? (
              <p className="text-[9px] text-forge-text leading-snug line-clamp-1">{row.prompt.slice(0, 80)}</p>
            ) : row.lingmaoData ? (
              <div className="relative group">
                <div className="flex flex-wrap gap-0.5 cursor-default">
                  {row.lingmaoData.composition && <span className="text-[10px] px-1 py-0.5 rounded bg-forge-surface2/60 text-forge-text2/70">{row.lingmaoData.composition.slice(0, 15)}</span>}
                  {row.lingmaoData.profileIntro && <span className="text-[10px] px-1 py-0.5 rounded bg-forge-surface2/60 text-forge-text2/70">{row.lingmaoData.profileIntro}</span>}
                  <span className="text-[10px] text-forge-cyan/60">+详情</span>
                </div>
                {/* Hover tooltip — 全部领猫参数 */}
                <div className="absolute bottom-full left-0 mb-1 w-56 p-2 rounded-lg bg-forge-surface border border-forge-cyan/30 shadow-xl z-50 hidden group-hover:block animate-slide-up">
                  <p className="text-[10px] text-forge-cyan font-medium mb-1">{row.lingmaoData.productName}</p>
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {buildInfoLines(row.lingmaoData).map((line, i) => (
                      <p key={i} className="text-[9px] text-forge-text2/80 leading-snug">{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            ) : <span className="text-forge-text2/30 text-[10px]">自动获取</span>}
          </div>
        ) : (
          <textarea
            value={row.prompt}
            onChange={(e) => onUpdate(row.id, { prompt: e.target.value })}
            placeholder="手动输入生图提示词（英文）"
            className="input-field !py-1 !min-h-[36px] text-[9px] leading-snug w-full"
          />
        )}
      </td>

      {/* Execution Status */}
      <td className="py-2 px-2 text-center min-w-[60px]">
        {row.status === 'generating' && (
          <div>
            <Loader2 size={10} className="animate-spin text-forge-cyan mx-auto" />
            <span className="text-[10px] text-forge-cyan block">{row.runningIdx}/{row.count}</span>
          </div>
        )}
        {row.status === 'done' && row.resultUrls.length > 0 && (
          <div className="flex items-center justify-center gap-1">
            <div className="flex -space-x-1 cursor-pointer" onClick={() => onCompare(row, 0)} title="点击放大对比">
              {previewUrls.slice(0, 3).map((url, i) => (
                <img key={i} src={url} alt="" loading="lazy" className="w-5 h-7 object-cover rounded border border-forge-green/20 hover:border-forge-cyan/50 hover:scale-110 transition-transform" />
              ))}
              {row.resultUrls.length > 3 && <span className="text-[10px] text-forge-text2">+{row.resultUrls.length - 3}</span>}
            </div>
            <button onClick={() => onDownloadSingle(row)} className="text-forge-text2/50 hover:text-forge-cyan flex-shrink-0" title="下载"><Download size={10} /></button>
          </div>
        )}
        {row.status === 'done' && row.resultUrls.length === 0 && <CheckCircle2 size={10} className="text-forge-green mx-auto" />}
        {row.status === 'failed' && (
          <div className="flex flex-col items-center gap-1">
            <span title={row.error}><AlertTriangle size={10} className="text-forge-red" /></span>
            <span className="text-[10px] text-forge-red/60 truncate max-w-16">{row.error.slice(0, 15)}</span>
            <button onClick={(e) => { e.stopPropagation(); onRetry(row.id); }} disabled={isRunning}
              className="text-[10px] text-forge-cyan hover:underline disabled:opacity-30">重试</button>
          </div>
        )}
        {row.status === 'idle' && <span className="text-forge-text2/25 text-[10px]">待生成</span>}
      </td>

      {/* Delete */}
      <td className="py-2 px-1">
        <button onClick={() => onRemove(row.id)} disabled={isRunning} className="text-forge-text2/15 hover:text-forge-red disabled:opacity-20"><Trash2 size={10} /></button>
      </td>
    </tr>
  );
});

// ===== Main Component =====
export function BatchGenerate() {
  const navigate = useNavigate();
  const addTask = useTaskHistoryStore((s) => s.addTask);
  const taskHistoryCount = useTaskHistoryStore((s) => s.tasks.length);
  const getVisionModel = useLlmStore((s) => s.getVisionModel);
  const getTextModel = useLlmStore((s) => s.getTextModel);
  const addToast = useAppStore((s) => s.addToast);

  const [mode, setMode] = useState<BatchMode>('shared');
  const [sharedModelImage, setSharedModelImage] = useState<ReferenceImage | null>(null);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [globalCount, setGlobalCount] = useState(1);
  const HYBRID_MODEL_ID = '__hybrid__';
  const [globalModel, setGlobalModel] = useState('gpt-image-2-vip'); // 默认 Grsai，效果最好
  const [globalResolution, setGlobalResolution] = useState('3264×2448 (4:3, 4K)');
  const [autoDownload, setAutoDownload] = useState(false);
  const [saveFolderHandle, setSaveFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [aiStatus, setAiStatus] = useState({ step: 0, message: '' });

  // ===== 新增：模特库/模板库/Logo选择 =====
  const models = useModelStore((s) => s.models);
  const templates = useTemplateStore((s) => s.templates);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [logoImage, setLogoImage] = useState<ReferenceImage | null>(null);
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const selectedModel = models.find((m) => m.id === selectedModelId);

  const abortRef = useRef(false);
  const initialLoadDone = useRef(false);
  // 跟踪本次运行中每行的结果（供写历史任务用）
  const rowResultsRef = useRef<Map<string, { urls: string[]; error: string }>>(new Map());

  // Image compare modal
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareImages, setCompareImages] = useState<CompareImage[]>([]);
  const [compareIndex, setCompareIndex] = useState(0);
  const [compareBefore, setCompareBefore] = useState('');

  const modelConfig = getStoredModelConfig();
  const allModels = useMemo(
    () => [
      { id: HYBRID_MODEL_ID, name: '🚀 混合引擎', desc: 'Grsai+Yunwu 负载均衡' },
      ...AI_MODELS_FOR_TRYON.filter((m) => isModelEnabled(m.id)).map((m) => ({ id: m.id, name: m.name, desc: m.desc })),
      ...(modelConfig.customModels || []).map((m) => ({ id: m.id, name: m.name, desc: '自定义' })),
    ],
    [modelConfig.customModels]
  );

  // ===== Persistence =====
  const LS_BATCH = 'vf-batch-state';
  const thumbRef = useRef<Map<string, string>>(new Map()); // rowId_type → base64 thumbnail
  interface StoredBatchImage { name: string; size: number; thumbnail: string; }
  interface StoredBatchRow { id: string; skuCode: string; productName: string; frontImage: StoredBatchImage | null; backImage: StoredBatchImage | null; modelImage: StoredBatchImage | null; prompt: string; lingmaoData: SKUInfo | null; status: BatchRow['status']; resultUrls: string[]; error: string; count: number; }
  interface StoredBatch { mode: BatchMode; globalCount: number; globalModel: string; globalResolution: string; rows: StoredBatchRow[]; sharedModelThumb?: string; }

  // 生成缩略图（max 300px, JPEG 60%）
  async function makeThumb(file: File): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(300 / img.width, 300 / img.height, 1);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
      img.src = url;
    });
  }

  // 为 IndexedDB 持久化预压缩参考图（1024px, 85%），避免刷新后只剩 300px 缩略图
  async function persistRefImage(key: string, file: File): Promise<void> {
    try {
      const b64 = await compressImageForRef(file);
      await saveImage(key, b64);
    } catch {}
  }

  // Save on every meaningful change
  useEffect(() => {
    // 首次挂载不删 localStorage（load useEffect 还未执行）
    if (!initialLoadDone.current) return;
    if (rows.length === 0 && !sharedModelImage) {
      localStorage.removeItem(LS_BATCH);
      return;
    }
    const stored: StoredBatch = {
      mode, globalCount, globalModel, globalResolution,
      rows: rows.map((r) => ({
        id: r.id, skuCode: r.skuCode, productName: r.productName,
        frontImage: r.frontImage ? { name: r.frontImage.name, size: r.frontImage.size, thumbnail: thumbRef.current.get(`${r.id}_front`) || '' } : null,
        backImage: r.backImage ? { name: r.backImage.name, size: r.backImage.size, thumbnail: thumbRef.current.get(`${r.id}_back`) || '' } : null,
        modelImage: r.modelImage ? { name: r.modelImage.name, size: r.modelImage.size, thumbnail: thumbRef.current.get(`${r.id}_model`) || '' } : null,
        prompt: r.prompt, lingmaoData: r.lingmaoData,
        status: r.status, resultUrls: r.resultUrls, error: r.error,
        count: r.count,
      })),
      sharedModelThumb: thumbRef.current.get('__shared_model__') || '',
    };
    try { localStorage.setItem(LS_BATCH, JSON.stringify(stored)); } catch {}
  }, [rows, mode, globalCount, globalModel, globalResolution, sharedModelImage]);

  // Load on mount（必须在 useEffect 中，render 阶段 setState 会导致白屏）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_BATCH);
      if (!raw) return;
      const saved = JSON.parse(raw) as StoredBatch;
      if (saved.mode) setMode(saved.mode);
      if (saved.globalCount) setGlobalCount(saved.globalCount);
      if (saved.globalModel) setGlobalModel(saved.globalModel);
      if (saved.globalResolution) setGlobalResolution(saved.globalResolution);
      if (saved.sharedModelThumb && saved.sharedModelThumb.startsWith('data:')) {
        thumbRef.current.set('__shared_model__', saved.sharedModelThumb);
        setSharedModelImage({ id: genId(), type: 'model', previewUrl: saved.sharedModelThumb, name: 'model_ref.jpg', size: 0 });
      }
      if (saved.rows?.length > 0) {
        setRows(saved.rows.map((sr): BatchRow => {
          const frontThumb = sr.frontImage?.thumbnail || '';
          const backThumb = sr.backImage?.thumbnail || '';
          const modelThumb = sr.modelImage?.thumbnail || '';
          if (frontThumb) thumbRef.current.set(`${sr.id}_front`, frontThumb);
          if (backThumb) thumbRef.current.set(`${sr.id}_back`, backThumb);
          if (modelThumb) thumbRef.current.set(`${sr.id}_model`, modelThumb);
          return {
            id: sr.id, skuCode: sr.skuCode, productName: sr.productName,
            frontImage: sr.frontImage ? { id: genId(), type: 'product_front', previewUrl: frontThumb || '', name: sr.frontImage.name, size: sr.frontImage.size } : null,
            backImage: sr.backImage ? { id: genId(), type: 'product_back', previewUrl: backThumb || '', name: sr.backImage.name, size: sr.backImage.size } : null,
            modelImage: sr.modelImage ? { id: genId(), type: 'model', previewUrl: modelThumb || '', name: sr.modelImage.name, size: sr.modelImage.size } : null,
            prompt: sr.prompt, lingmaoData: sr.lingmaoData,
            status: sr.status === 'generating' ? 'idle' : sr.status as BatchRow['status'], resultUrls: sr.resultUrls, error: sr.error,
            runningIdx: 0, count: sr.count ?? globalCount,
          };
        }));
      }
    } catch { /* localStorage 数据损坏，忽略 */ }
    initialLoadDone.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readyCount = rows.filter((r) => r.status !== 'done').length;
  const doneCount = rows.filter((r) => r.status === 'done').length;
  const totalPlanned = rows.reduce((sum, r) => sum + r.count, 0);
  const generatedCount = rows.reduce((sum, r) => sum + r.resultUrls.length, 0);

  const updateRow = useCallback((id: string, updates: Partial<BatchRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r))), []);
  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    deleteImage(`${id}_front`);
    deleteImage(`${id}_back`);
    deleteImage(`${id}_model`);
  }, []);

  const handleModelUpload = useCallback(async (rowId: string, file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 50 * 1024 * 1024) { addToast('warning', '单文件最大 50MB'); return; }
    const thumb = await makeThumb(file);
    if (thumb) thumbRef.current.set(`${rowId}_model`, thumb);
    persistRefImage(`${rowId}_model`, file); // IndexedDB: 1024px 参考图
    updateRow(rowId, { modelImage: { id: genId(), type: 'model', previewUrl: URL.createObjectURL(file), name: file.name, size: file.size } });
  }, [updateRow]);

  const handleDownloadSingle = useCallback(async (row: BatchRow) => {
    addToast('info', `正在下载 ${row.skuCode} (${row.resultUrls.length}张)...`);
    let ok = 0;
    for (let i = 0; i < row.resultUrls.length; i++) {
      try {
        const resp = await fetch(row.resultUrls[i]);
        const blob = await resp.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = `${row.skuCode || 'img'}_${row.productName || ''}_${i + 1}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objUrl);
        ok++;
        if (i < row.resultUrls.length - 1) await new Promise(r => setTimeout(r, 300));
      } catch { addToast('warning', `第${i+1}张下载失败`); }
    }
    if (ok === row.resultUrls.length) addToast('success', `${row.skuCode} 下载完成 (${ok}张)`);
  }, [addToast]);

  // ===== Folder Import =====
  const handleFolderImport = async (files: FileList) => {
    const fileArray = Array.from(files);
    const parsed: Map<string, { front?: File; back?: File }> = new Map();

    for (const file of fileArray) {
      const nameNoExt = file.name.replace(/\.[^.]+$/, '');
      // 宽松匹配：款号_正面 / 款号正面 / 款号-正面 / 款号_正面图 等
      const frontMatch = nameNoExt.match(/^(.+?)[-_]?(?:白底)?正面(?:图|照片|白底)?$/);
      const backMatch = nameNoExt.match(/^(.+?)[-_]?(?:白底)?反面(?:图|照片|白底)?$/);
      if (!frontMatch && !backMatch) continue;
      const match = frontMatch || backMatch!;
      const skuCode = match[1].trim();
      const side = frontMatch ? '正面' : '反面';
      if (!parsed.has(skuCode)) parsed.set(skuCode, {});
      const entry = parsed.get(skuCode)!;
      if (side === '正面') entry.front = file;
      else if (side === '反面') entry.back = file;
    }

    if (parsed.size === 0) {
      addToast('warning', '未识别到符合命名规则的文件\n预期格式: 款号_正面.png / 款号_反面.png');
      return;
    }

    const totalFiles = fileArray.length;
    const unmatchedFiles = fileArray.filter(f => {
      const nameNoExt = f.name.replace(/\.[^.]+$/, '');
      return !nameNoExt.match(/^(.+?)[-_]?(?:白底)?(?:正面|反面)(?:图|照片|白底)?$/);
    });

    const newRows: BatchRow[] = [];
    for (const [skuCode, imgs] of parsed) {
      if (!imgs.front && !imgs.back) continue;
      newRows.push({
        id: genId(), skuCode, productName: '',
        frontImage: imgs.front ? { id: genId(), type: 'product_front', previewUrl: URL.createObjectURL(imgs.front), name: imgs.front.name, size: imgs.front.size } : null,
        backImage: imgs.back ? { id: genId(), type: 'product_back', previewUrl: URL.createObjectURL(imgs.back), name: imgs.back.name, size: imgs.back.size } : null,
        modelImage: null, prompt: '', lingmaoData: null,
        status: 'idle' as const, resultUrls: [], error: '', runningIdx: 0,
        count: globalCount,
      });
    }

    setRows((prev) => {
      const existing = new Set(prev.map((r) => r.skuCode));
      return [...prev, ...newRows.filter((r) => !existing.has(r.skuCode))];
    });

    // 异步生成缩略图（localStorage）+ 全分辨率参考图（IndexedDB）
    for (const r of newRows) {
      if (r.frontImage) {
        const file = fileArray.find(f => f.name === r.frontImage!.name);
        if (file) {
          makeThumb(file).then(t => { if (t) thumbRef.current.set(`${r.id}_front`, t); });
          persistRefImage(`${r.id}_front`, file);
        }
      }
      if (r.backImage) {
        const file = fileArray.find(f => f.name === r.backImage!.name);
        if (file) {
          makeThumb(file).then(t => { if (t) thumbRef.current.set(`${r.id}_back`, t); });
          persistRefImage(`${r.id}_back`, file);
        }
      }
    }

    const existingCodes = newRows.filter(r => rows.some(prev => prev.skuCode === r.skuCode)).map(r => r.skuCode);
    const addedCount = newRows.length - existingCodes.length;
    let msg = `导入完成：新增 ${addedCount} 个款号`;
    if (existingCodes.length > 0) msg += `，${existingCodes.length} 个已存在被跳过`;
    if (unmatchedFiles.length > 0) msg += `，${unmatchedFiles.length} 个文件命名不符`;
    addToast('success', msg);

    autoFetchLingmao(newRows.map((r) => r.skuCode));
  };

  const autoFetchLingmao = async (codes: string[]) => {
    for (const code of codes) {
      if (!code) continue;
      try {
        const result = await queryStyleByCode([code]);
        if (result.skuInfo) {
          setRows((prev) => prev.map((row) =>
            row.skuCode === code ? { ...row, lingmaoData: result.skuInfo, productName: result.skuInfo!.productName } : row
          ));
        }
      } catch {}
    }
  };

  // ===== Add Manual Row =====
  const addManualRow = () => {
    setRows((prev) => [...prev, {
      id: genId(), skuCode: '', productName: '', frontImage: null, backImage: null,
      modelImage: null, prompt: 'Professional fashion e-commerce photography, model wearing the garment, soft studio lighting, clean background, 8K quality',
      lingmaoData: null, status: 'idle' as const, resultUrls: [], error: '', runningIdx: 0,
      count: globalCount,
    }]);
  };

  // ===== Save Folder Picker =====
  const pickSaveFolder = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker();
      setSaveFolderHandle(handle);
    } catch {
      // user cancelled or not supported
    }
  };

  // ===== Download All (to folder or individual) =====
  const handleDownloadAll = async () => {
    if (saveFolderHandle) {
      // Save to chosen folder, organized by SKU
      for (const row of rows) {
        if (row.resultUrls.length === 0) continue;
        const skuName = row.skuCode || row.id.slice(-6);
        let subFolder: FileSystemDirectoryHandle;
        try {
          subFolder = await saveFolderHandle.getDirectoryHandle(skuName, { create: true });
        } catch { continue; }

        for (let i = 0; i < row.resultUrls.length; i++) {
          try {
            const resp = await fetch(row.resultUrls[i]);
            const blob = await resp.blob();
            const fileHandle = await subFolder.getFileHandle(`${skuName}_${i + 1}.png`, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
          } catch {}
        }
      }
      addToast('success', '已保存到选定文件夹');
    } else {
      // Fallback: individual downloads
      rows.forEach((row) => handleDownloadSingle(row));
    }
  };

  // ===== Main Run =====
  const handleRun = async () => {
    // 先清理上次中断遗留的 'generating' 状态行
    setRows((prev) => prev.map((r) => (r.status === 'generating' ? { ...r, status: 'idle' as const, runningIdx: 0 } : r)));

    const targetRows = rows.filter((r) => r.status !== 'done');
    if (targetRows.length === 0) { addToast('warning', '没有待生成的行，请先导入商品图片'); return; }

    // 预检白底图
    const noFrontImg = targetRows.filter((r) => !r.frontImage?.previewUrl);
    if (noFrontImg.length > 0) {
      const codes = noFrontImg.map(r => r.skuCode || '未命名').slice(0, 5).join('、');
      const msg = `${noFrontImg.length} 个款号缺少商品白底图（${codes}${noFrontImg.length > 5 ? '...' : ''}），生成结果可能不准确`;
      if (noFrontImg.length === targetRows.length) { addToast('error', msg); return; }
      addToast('warning', msg);
    }

    const visionModel = getVisionModel();
    const textModel = getTextModel();
    if (!visionModel || !textModel) {
      addToast('warning', '请先在系统设置中启用 LLM 模型（Kimi + DeepSeek）');
      return;
    }

    // 确保 KEY 池已同步（在计算 concurrency 之前）
    syncKeyPools();

    abortRef.current = false;
    rowResultsRef.current = new Map();
    setIsRunning(true);
    setAiStatus({ step: 0, message: '准备中...' });

    const batchId = `batch_${genId()}`;
    const batchLabel = `${new Date().toLocaleString('zh-CN')} · ${targetRows.length}款`;
    const isHybrid = globalModel === HYBRID_MODEL_ID;
    const preset = RESOLUTION_PRESETS.find((p) => p.label === globalResolution);
    const yunwuKeyCount = availableKeyCount('yunwu');
    const grsaiKeyCount = availableKeyCount('grsai');

    // 并发数：混合模式用全部 KEY，单引擎用对应引擎的 KEY
    const concurrency = isHybrid ? (yunwuKeyCount + grsaiKeyCount) :
      (getProvider(globalModel) === 'yunwu' ? yunwuKeyCount : grsaiKeyCount);

    try {
      // ===== Phase 1: Kimi 分析模特图（共享模式） =====
      let sharedInvariant = '';
      const skuRows = targetRows.filter((r) => !!r.skuCode.trim());

      if (mode === 'shared' && sharedModelImage && skuRows.length > 0) {
        if (abortRef.current) return;
        setAiStatus({ step: 1, message: 'Kimi 正在分析模特图（约 15s）...' });
        try {
          let modelB64: string | undefined;

          // 优先从 IndexedDB 加载 1024px 参考图（页面刷新后 previewUrl 仅为 300px 缩略图）
          const cachedModel = await loadImage('__shared_model__');
          if (cachedModel) {
            modelB64 = cachedModel;
          } else {
            // 回退：从预览 URL 加载并压缩
            const modelFile = await withTimeout(
              blobUrlToFile(sharedModelImage.previewUrl, sharedModelImage.name),
              20000, 'Phase1 blobUrlToFile',
            );
            modelB64 = await withTimeout(
              compressImageForLLM(modelFile),
              20000, 'Phase1 compressImageForLLM',
            );
          }

          if (!modelB64) throw new Error('无法加载模特图');
          sharedInvariant = await withTimeout(
            analyzeModelImage(visionModel, modelB64),
            90000, 'Phase1 analyzeModelImage',
          );
        } catch (e) {
          console.warn('[Phase1] Kimi 模特分析失败，使用通用描述', e);
          sharedInvariant = 'Maintain model pose, facial expression, lighting and composition from reference.';
        }
      }

      // ===== Phase 1.5: Logo 预处理 + 模特库选择 =====
      let logoB64: string | undefined;
      if (logoImage?.previewUrl) {
        try {
          const lf = await withTimeout(blobUrlToFile(logoImage.previewUrl, logoImage.name), 15000, 'logoFile');
          logoB64 = await withTimeout(compressImageForLLM(lf), 15000, 'logoCompress');
        } catch { /* logo 加载失败不阻塞主流程 */ }
      }

      // 如果选了模特库中的模特且未手动上传，使用库中的模特图
      if (selectedModel && !sharedModelImage && mode === 'shared') {
        setSharedModelImage({
          id: selectedModel.id, type: 'model',
          previewUrl: selectedModel.previewUrl,
          name: selectedModel.originalName, size: selectedModel.size,
        });
      }

      // ===== Phase 2: 每行 LLM 分析 + 入队 =====
      type ImageTask = {
        rowId: string; skuCode: string; productB64: string; modelB64: string | undefined;
        prompt: string; count: number; idxInRow: number;
        modelId: string;
      };
      const queue: ImageTask[] = [];

      // 信号量
      const semKimi = { n: 0, q: [] as (() => void)[] };
      const semDs = { n: 0, q: [] as (() => void)[] };
      const acq = async (s: typeof semKimi, max: number) => {
        if (s.n < max) { s.n++; return; }
        await new Promise<void>(r => s.q.push(r)); s.n++;
      };
      const rel = (s: typeof semKimi) => { s.n--; s.q.shift()?.(); };

      // 预加载 IndexedDB 参考图缓存 + 预压缩模特图
      const refCache = new Map<string, string>();
      async function getRefB64(id: string, type: 'front' | 'model'): Promise<string> {
        const key = `${id}_${type}`;
        if (refCache.has(key)) return refCache.get(key)!;
        const cached = await loadImage(key);
        if (cached) { refCache.set(key, cached); return cached; }
        return '';
      }

      let sharedModelB64: string | undefined;
      if (mode === 'shared' && sharedModelImage?.previewUrl) {
        const cached = await loadImage('__shared_model__');
        if (cached) { sharedModelB64 = cached; }
        else {
          try {
            const mf = await withTimeout(
              blobUrlToFile(sharedModelImage.previewUrl, sharedModelImage.name),
              15000, 'sharedModel blobUrlToFile',
            );
            sharedModelB64 = await withTimeout(
              compressImageForRef(mf),
              15000, 'sharedModel compressImageForRef',
            );
          } catch {}
        }
      }

      // ===== Phase 2: 流式处理 — LLM 分析 + 入队（与 Phase 3 生图并发） =====
      const totalKeys = yunwuKeyCount + grsaiKeyCount;
      let llmDone = false;
      let queueIdx = 0;
      let completedInRun = 0;
      const queueLock = { waiting: null as (() => void) | null };

      // Phase 3 workers 提前启动 — 与 LLM 分析并发执行
      const workOne = async (): Promise<void> => {
        while (true) {
          if (abortRef.current) return;

          // 从队列取任务
          let task: ImageTask | undefined;
          const checkQueue = () => {
            const idx = queueIdx++;
            if (idx < queue.length) {
              task = queue[idx];
              return true;
            }
            queueIdx--; // 回退
            return false;
          };

          if (!checkQueue()) {
            if (llmDone) return; // LLM 全完成 + 队列已消化 → 退出
            // 等待新任务入队
            await new Promise<void>((r) => { queueLock.waiting = r; });
            queueLock.waiting = null;
            continue;
          }

          try {
            const realUrl = await generateTryOnImage({
              prompt: task!.prompt, productImageBase64: task!.productB64,
              modelImageBase64: task!.modelB64,
              width: preset?.width || 2448, height: preset?.height || 3264,
              modelId: task!.modelId,
            });

            completedInRun++;
            setAiStatus({ step: 3, message: `生图 ${completedInRun} · ${task!.skuCode}` });

            const rowEntry = rowResultsRef.current.get(task!.rowId) || { urls: [], error: '' };
            rowEntry.urls.push(realUrl);
            rowResultsRef.current.set(task!.rowId, rowEntry);

            setRows((prev) => prev.map((r) => {
              if (r.id !== task!.rowId) return r;
              const urls = [...r.resultUrls, realUrl];
              return { ...r, resultUrls: urls, runningIdx: urls.length, status: urls.length >= (task!.count || 1) ? 'done' as const : 'generating' as const };
            }));

            if (autoDownload && saveFolderHandle) {
              const skuName = task!.skuCode || `manual_${task!.rowId.slice(-6)}`;
              try {
                const subFolder = await saveFolderHandle.getDirectoryHandle(skuName, { create: true });
                const resp = await fetch(realUrl);
                const blob = await resp.blob();
                const fh = await subFolder.getFileHandle(`${skuName}_${task!.idxInRow + 1}.png`, { create: true });
                const w = await fh.createWritable(); await w.write(blob); await w.close();
              } catch {}
            }
          } catch (e) {
            completedInRun++;
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error(`[worker] ${task!.skuCode} failed:`, errMsg);
            const rowErr = rowResultsRef.current.get(task!.rowId) || { urls: [], error: '' };
            rowErr.error = rowErr.error ? rowErr.error + '; ' + errMsg.slice(0, 80) : errMsg.slice(0, 80);
            rowResultsRef.current.set(task!.rowId, rowErr);
            setRows((prev) => prev.map((r) => {
              if (r.id !== task!.rowId) return r;
              const prefix = r.error ? r.error + '; ' : '';
              return { ...r, error: prefix + `#${task!.idxInRow + 1}: ${errMsg.slice(0, 80)}` };
            }));
          }
        }
      };

      // 启动 Phase 3 workers（先于 Phase 2）
      setAiStatus({ step: 3, message: `${concurrency}路并发 · 流式生图` });
      const workers = Array.from({ length: concurrency }, () => workOne());

      // Phase 2: LLM 分析每行 → 即时入队
      const notifyGen = () => {
        const w = queueLock.waiting;
        if (w) { queueLock.waiting = null; w(); }
      };

      await Promise.all(targetRows.map(async (row) => {
        if (abortRef.current) return;
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: 'generating' as const, runningIdx: 0 } : r)));
        const hasSku = !!row.skuCode.trim();

        let finalPrompt = row.prompt;
        let productB64 = '';
        let modelB64: string | undefined;

        try {
          productB64 = await getRefB64(row.id, 'front');
          if (!productB64 && row.frontImage?.previewUrl) {
            try {
              const pf = await withTimeout(blobUrlToFile(row.frontImage.previewUrl, row.frontImage.name), 15000, `product File ${row.skuCode}`);
              productB64 = await withTimeout(compressImageForRef(pf), 15000, `product compress ${row.skuCode}`);
            } catch {}
          }
          modelB64 = mode === 'shared' ? sharedModelB64 : (await getRefB64(row.id, 'model'));
          if (!modelB64 && mode !== 'shared' && row.modelImage?.previewUrl) {
            try {
              const mf = await withTimeout(blobUrlToFile(row.modelImage.previewUrl, row.modelImage.name), 15000, `model File ${row.skuCode}`);
              modelB64 = await withTimeout(compressImageForRef(mf), 15000, `model compress ${row.skuCode}`);
            } catch {}
          }

          if (hasSku && mode === 'shared' && sharedInvariant && row.frontImage?.previewUrl) {
            let garmentVisualDetails = '';
            try {
              const pf = await withTimeout(blobUrlToFile(row.frontImage.previewUrl, row.frontImage.name), 15000, `blobUrlToFile ${row.skuCode}`);
              const llmB64 = await withTimeout(compressImageForLLM(pf), 15000, `compressImageForLLM ${row.skuCode}`);
              await acq(semKimi, 2);
              try {
                const analyzeFn = logoB64 ?
                  (() => analyzeProductWithLogo(visionModel, llmB64, logoB64)) :
                  (() => analyzeProductImage(visionModel, llmB64));
                garmentVisualDetails = await withTimeout(analyzeFn(), 90000, `analyzeProductImage ${row.skuCode}`);
              } catch (e) { console.warn(`[Kimi] ${row.skuCode}:`, e); }
              finally { rel(semKimi); }
            } catch (e) { console.warn(`[Kimi-prep] ${row.skuCode}:`, e); }

            await acq(semDs, 3);
            try {
              const pInfo = buildProductInfoString(row.lingmaoData) || `商品 ${row.skuCode}`;
              const merged = garmentVisualDetails ? `${pInfo}\n\n【白底图视觉细节】\n${garmentVisualDetails}` : pInfo;
              finalPrompt = await withTimeout(assembleFinalPrompt(textModel, sharedInvariant, merged), 120000, `assembleFinalPrompt ${row.skuCode}`);
            } catch (e) {
              console.warn(`[DeepSeek] ${row.skuCode}:`, e);
              const pInfo = buildProductInfoString(row.lingmaoData) || '';
              finalPrompt = pInfo ? `${sharedInvariant}\n\nThe garment to try on: ${pInfo}` : '';
            } finally { rel(semDs); }
          }
        } catch (e) {
          console.warn(`[batch] Row ${row.skuCode} prep failed:`, e);
        }

        if (!finalPrompt) finalPrompt = row.prompt || 'Professional fashion e-commerce photography, model wearing the garment, soft studio lighting, 8K quality';

        // 即时入队 + 通知 workers
        for (let ci = 0; ci < (row.count || 1); ci++) {
          let taskModelId = globalModel;
          if (isHybrid) {
            const useGrsai = grsaiKeyCount > 0 && (ci % totalKeys < grsaiKeyCount);
            taskModelId = useGrsai ? 'gpt-image-2-vip' : 'gpt-image-2-all';
          }
          queue.push({ rowId: row.id, skuCode: row.skuCode || 'manual', productB64, modelB64, prompt: finalPrompt, count: row.count || 1, idxInRow: ci, modelId: taskModelId });
        }
        notifyGen();

        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, prompt: finalPrompt } : r)));
      }));

      // 标记 LLM 全完成 + 唤醒 workers
      llmDone = true;
      notifyGen();

      if (queue.length === 0 || abortRef.current) { setIsRunning(false); return; }

      await Promise.all(workers);

      // 按行写入历史
      for (const targetRow of targetRows) {
        const rowData = rowResultsRef.current.get(targetRow.id);
        const planned = targetRow.count || 1;
        const actual = rowData ? rowData.urls.length : 0;
        const errMsg = rowData?.error || '';
        addTask({
          id: genId(), type: 'tryon',
          skuCode: targetRow.skuCode || '未命名', productName: targetRow.productName || '',
          modelId: globalModel,
          provider: isHybrid ? 'hybrid' : getProvider(globalModel),
          prompt: targetRow.prompt?.slice(0, 200) || '',
          params: { model: globalModel, resolution: globalResolution },
          status: abortRef.current ? 'failed' : (actual >= planned ? 'completed' : (actual > 0 ? 'partial' : 'failed')),
          progress: planned > 0 ? Math.round((actual / planned) * 100) : 0,
          resultUrls: rowData?.urls.slice(0, 20) || [],
          referenceUrls: sharedModelImage?.previewUrl ? [sharedModelImage.previewUrl] : [],
          error: abortRef.current ? '用户终止' : (errMsg?.slice(0, 500) || (actual === 0 ? '未返回结果' : '')),
          createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
          batchId, batchLabel,
        });
      }

      setAiStatus({
        step: 4,
        message: abortRef.current ? `已终止 · ${completedInRun}/${queue.length}` : `完成 · ${completedInRun} 张`,
      });
    } catch (e) {
      console.error('[handleRun] ERROR:', e);
      addToast('error', '批量处理失败: ' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setIsRunning(false);
      setRows((prev) => prev.map((r) => (r.status === 'generating' ? { ...r, status: 'idle' as const, runningIdx: 0 } : r)));
    }
  };

  // ===== Render =====
  const hasRows = rows.length > 0;
  const stop = () => {
    abortRef.current = true;
    setAiStatus({ step: 0, message: '正在终止...' });
    setRows((prev) => prev.map((r) => (r.status === 'generating' ? { ...r, status: 'idle' as const, runningIdx: 0 } : r)));
  };
  const clearAll = () => { setRows([]); setSharedModelImage(null); localStorage.removeItem(LS_BATCH); clearImageStore(); };
  const failedCount = rows.filter((r) => r.status === 'failed').length;

  const handleRetry = (id: string) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const keptUrls = r.resultUrls || [];
      const remaining = Math.max(1, r.count - keptUrls.length);
      return { ...r, status: 'idle' as const, error: '', count: remaining, runningIdx: 0 };
    }));
  };

  const handleCompare = useCallback((row: BatchRow, index: number) => {
    setCompareBefore(
      (mode === 'shared' ? sharedModelImage?.previewUrl : row.modelImage?.previewUrl) || ''
    );
    setCompareImages(
      row.resultUrls.map((url, i) => ({
        url,
        label: `${row.skuCode || '结果'} #${i + 1}`,
      }))
    );
    setCompareIndex(index);
    setCompareOpen(true);
  }, [mode, sharedModelImage]);

  const handleRetryAllFailed = () => {
    setRows((prev) => prev.map((r) => {
      if (r.status !== 'failed') return r;
      const keptUrls = r.resultUrls || [];
      const remaining = Math.max(1, r.count - keptUrls.length);
      return { ...r, status: 'idle' as const, error: '', count: remaining, runningIdx: 0 };
    }));
  };
  const handleSharedModelUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 50 * 1024 * 1024) { addToast('warning', '单文件最大 50MB'); return; }
    const thumb = await makeThumb(file);
    if (thumb) thumbRef.current.set('__shared_model__', thumb);
    persistRefImage('__shared_model__', file); // IndexedDB: 1024px 参考图
    setSharedModelImage({ id: genId(), type: 'model', previewUrl: URL.createObjectURL(file), name: file.name, size: file.size });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-orange to-purple-500 flex items-center justify-center"><Layers size={20} className="text-forge-bg" /></div>
          <div>
            <h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">批量工单</h2>
            <p className="text-xs text-forge-text2">{hasRows ? `${rows.length} 款 · ${generatedCount}/${totalPlanned} 张` : '文件夹导入 → AI 分析 → 批量生图'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/history')} className="relative flex items-center gap-1.5 px-3 py-1.5 text-xs text-forge-cyan hover:text-forge-text border border-forge-cyan/30 rounded-lg transition-colors">
            <History size={13} />任务历史
            {taskHistoryCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-forge-orange text-forge-bg text-[9px] font-bold flex items-center justify-center px-1">{taskHistoryCount > 99 ? '99+' : taskHistoryCount}</span>
            )}
          </button>
          <button onClick={() => navigate('/settings')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-forge-text2 hover:text-forge-cyan border border-forge-border/40 rounded-lg transition-colors"><Settings size={13} />设置</button>
          {hasRows && generatedCount > 0 && (
            <button onClick={handleDownloadAll} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-forge-green hover:text-forge-cyan border border-forge-green/30 rounded-lg transition-colors"><Download size={13} />下载({generatedCount})</button>
          )}
          {failedCount > 0 && !isRunning && (
            <button onClick={handleRetryAllFailed} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-forge-orange hover:text-forge-cyan border border-forge-orange/30 rounded-lg transition-colors"><RefreshCw size={13} />重试失败({failedCount})</button>
          )}
          <button onClick={clearAll} disabled={!hasRows || isRunning} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-forge-red/60 hover:text-forge-red border border-forge-red/20 rounded-lg transition-colors disabled:opacity-30"><Trash2 size={13} />清空</button>
          {isRunning ? (
            <button onClick={stop} className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 bg-forge-red/15 text-forge-red border border-forge-red/30 hover:bg-forge-red/20"><StopCircle size={14} />终止</button>
          ) : (
            <button onClick={handleRun} disabled={readyCount === 0} className="orange-btn px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"><Play size={14} />批量生成 ({readyCount})</button>
          )}
        </div>
      </div>

      {/* Progress */}
      {aiStatus.message && isRunning && (
        <div className="glass-card p-3 border border-forge-cyan/30">
          <div className="flex items-center gap-2 text-xs text-forge-cyan">
            {abortRef.current ? <StopCircle size={13} className="text-forge-red" /> : <Loader2 size={13} className="animate-spin" />}
            <span>{aiStatus.message}</span>
          </div>
          <div className="w-full h-1 rounded-full bg-forge-surface2 mt-2 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-forge-cyan to-forge-orange transition-all duration-500" style={{ width: `${Math.min((generatedCount / Math.max(totalPlanned, 1)) * 100, 100)}%` }} />
          </div>
        </div>
      )}

      {/* Global Config */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-6 flex-wrap">
          {/* Count */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-forge-text2 whitespace-nowrap">每款数量</label>
            <div className="flex items-center gap-1">
              <button onClick={() => setGlobalCount(Math.max(1, globalCount - 1))} className="p-1.5 rounded bg-forge-surface2 border border-forge-border/40 text-forge-text2 hover:text-forge-cyan"><Minus size={12} /></button>
              <span className="w-7 text-center font-display text-forge-cyan text-sm">{globalCount}</span>
              <button onClick={() => setGlobalCount(Math.min(8, globalCount + 1))} className="p-1.5 rounded bg-forge-surface2 border border-forge-border/40 text-forge-text2 hover:text-forge-cyan"><Plus size={12} /></button>
            </div>
            <button onClick={() => setRows((prev) => prev.map((r) => ({ ...r, count: globalCount })))} className="text-[10px] text-forge-cyan hover:underline">应用全部</button>
          </div>

          {/* Model (global) */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-forge-text2 whitespace-nowrap">AI 模型</label>
            <select value={globalModel} onChange={(e) => setGlobalModel(e.target.value)} className="input-field !py-1 text-xs !w-auto">
              {allModels.map((m) => {
                if (m.id === HYBRID_MODEL_ID) return <option key={m.id} value={m.id}>{m.name} · {m.desc}</option>;
                const prov = getProvider(m.id);
                return <option key={m.id} value={m.id}>{m.name} · {prov === 'yunwu' ? '☁️Yunwu' : '⚡Grsai'}</option>;
              })}
            </select>
            {(() => {
              if (globalModel === HYBRID_MODEL_ID) {
                const total = totalAvailableKeys();
                return (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300">
                    🚀 混合 · {total}KEY
                  </span>
                );
              }
              const prov = getProvider(globalModel);
              const count = availableKeyCount(prov);
              return (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${prov === 'yunwu' ? 'bg-forge-cyan/10 text-forge-cyan' : 'bg-forge-orange/10 text-forge-orange'}`}>
                  {prov === 'yunwu' ? '☁️Yunwu' : '⚡Grsai'} · {count}KEY
                </span>
              );
            })()}
          </div>

          {/* Resolution (global) */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-forge-text2 whitespace-nowrap">分辨率</label>
            <select value={globalResolution} onChange={(e) => setGlobalResolution(e.target.value)} className="input-field !py-1 text-xs !w-auto min-w-[120px]">
              {RESOLUTION_PRESETS.filter((p) => p.width > 0).map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            </select>
          </div>
        </div>

        {/* Model Selector + Template + Logo */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-forge-border/20 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-forge-text2 whitespace-nowrap">模特</label>
            <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)} className="input-field !py-1 text-xs !w-auto min-w-[100px]">
              <option value="">手动上传</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.category === 'tops' ? '上' : m.category === 'bottoms' ? '下' : '通'})</option>)}
            </select>
            {!selectedModelId && (
              <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) handleSharedModelUpload(f); }; inp.click(); }}
                className="text-[10px] text-forge-cyan hover:underline whitespace-nowrap">上传</button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-forge-text2 whitespace-nowrap">模板</label>
            <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} className="input-field !py-1 text-xs !w-auto min-w-[120px]">
              <option value="">自定义</option>
              {templates.filter((t) => t.type === 'main').map((t) => <option key={t.id} value={t.id}>{t.name} ({t.garmentCategory === 'tops' ? '上' : '下'})</option>)}
            </select>
            {selectedTemplateId && (
              <span className="text-[10px] text-forge-text2/60 truncate max-w-32" title={selectedTemplate?.promptTemplate}>{selectedTemplate?.promptTemplate?.slice(0, 30)}...</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-forge-text2 whitespace-nowrap">印花/Logo</label>
            {logoImage?.previewUrl ? (
              <div className="relative inline-flex">
                <img src={logoImage.previewUrl} alt="logo" className="w-8 h-8 object-cover rounded border border-forge-border/30" />
                <button onClick={() => setLogoImage(null)} className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={6} /></button>
              </div>
            ) : (
              <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) setLogoImage({ id: genId(), type: 'product_front', previewUrl: URL.createObjectURL(f), name: f.name, size: f.size }); }; inp.click(); }}
                className="text-[10px] text-forge-text2/40 hover:text-forge-cyan border border-dashed border-forge-border/40 rounded px-2 py-0.5">上传</button>
            )}
          </div>
        </div>

        {/* Download Path */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-forge-border/20">
          <label className="flex items-center gap-2 cursor-pointer text-xs text-forge-text2">
            <input type="checkbox" checked={autoDownload} onChange={(e) => setAutoDownload(e.target.checked)} className="rounded" />
            生成后自动下载
          </label>
          <button onClick={pickSaveFolder} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-forge-text2 hover:text-forge-cyan border border-forge-border/40 rounded-lg transition-colors">
            <FolderDown size={12} />
            {saveFolderHandle ? `已选择: ${saveFolderHandle.name}` : '选择保存文件夹'}
          </button>
          {saveFolderHandle && (
            <span className="text-[10px] text-forge-text2/50">按款号自动创建子文件夹</span>
          )}
        </div>
      </div>

      {/* Import + Model */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card p-4">
          <h3 className="text-xs text-forge-text2 mb-3 flex items-center gap-2"><FolderOpen size={14} />导入商品白底图</h3>
          <p className="text-[10px] text-forge-text2/50 mb-3">命名格式：<span className="text-forge-cyan font-mono">款号_正面.png</span> / <span className="text-forge-cyan font-mono">款号_反面.png</span></p>
          <div className="flex gap-2">
            <button onClick={() => {
              const inp = document.createElement('input'); inp.type = 'file';
              inp.webkitdirectory = true; inp.setAttribute('directory', ''); inp.setAttribute('multiple', '');
              inp.onchange = () => { if (inp.files && inp.files.length > 0) handleFolderImport(inp.files); };
              inp.click();
            }} className="flex-1 border-2 border-dashed border-forge-border/50 rounded-xl py-4 text-center hover:border-forge-cyan/30 transition-colors group">
              <FolderOpen size={20} className="mx-auto text-forge-text2/25 group-hover:text-forge-cyan/40 mb-1" />
              <p className="text-xs text-forge-text2/50">选择文件夹导入</p>
            </button>
            <button onClick={addManualRow} className="flex-1 border-2 border-dashed border-forge-border/40 rounded-xl py-4 text-center hover:border-forge-orange/30 transition-colors group">
              <PlusCircle size={20} className="mx-auto text-forge-text2/25 group-hover:text-forge-orange/40 mb-1" />
              <p className="text-xs text-forge-text2/50">手动添加一行</p>
            </button>
          </div>
          {hasRows && <p className="mt-2 text-[10px] text-forge-cyan">{rows.length} 行 · {totalPlanned} 张</p>}
        </div>

        <div className="glass-card p-4">
          <h3 className="text-xs text-forge-text2 mb-3 flex items-center gap-2"><User size={14} />模特参考图</h3>
          <div className="flex gap-1 p-0.5 glass-card rounded-lg mb-3">
            {[{ v: 'shared' as const, l: '共享一张' }, { v: 'individual' as const, l: '各款独立' }].map((item) => (
              <button key={item.v} onClick={() => setMode(item.v)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs transition-all ${mode === item.v ? 'bg-forge-cyan/15 text-forge-cyan font-medium' : 'text-forge-text2 hover:text-forge-text'}`}>
                {item.l}
              </button>
            ))}
          </div>
          {mode === 'shared' ? (
            sharedModelImage ? (
              <div className="flex items-center gap-3 p-2 rounded-lg bg-forge-surface2/30">
                <img src={sharedModelImage.previewUrl} alt="" loading="lazy" className="w-12 h-16 object-cover rounded border border-forge-border/30" />
                <div className="flex-1 min-w-0"><p className="text-xs text-forge-text truncate">{sharedModelImage.name}</p><p className="text-[10px] text-forge-text2">所有款共用</p></div>
                <button onClick={() => setSharedModelImage(null)} className="p-1 text-forge-text2/40 hover:text-forge-red"><X size={14} /></button>
              </div>
            ) : (
              <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) handleSharedModelUpload(f); }; inp.click(); }}
                className="w-full border-2 border-dashed border-forge-border/40 rounded-xl py-4 text-center hover:border-forge-cyan/30 transition-colors group">
                <Camera size={20} className="mx-auto text-forge-text2/25 group-hover:text-forge-cyan/40 mb-1" />
                <p className="text-xs text-forge-text2/50">上传模特参考图</p>
                <p className="text-[10px] text-forge-text2/30 mt-0.5">JPG/PNG/WebP</p>
              </button>
            )
          ) : (
            <p className="text-[10px] text-forge-text2/50 p-2 rounded bg-forge-surface2/30"><Info size={10} className="inline mr-1" />在表格中为每行单独上传</p>
          )}
        </div>
      </div>

      {/* Table */}
      {hasRows && (
        <div className="glass-card overflow-x-auto" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-forge-surface z-10">
              <tr className="text-forge-text2/50 border-b border-forge-border/30 text-left">
                <th className="py-2.5 px-2 w-16">款号</th>
                {mode === 'individual' && <th className="py-2.5 px-1 w-12">模特</th>}
                <th className="py-2.5 px-1 w-12">正面</th>
                <th className="py-2.5 px-1 w-12">反面</th>
                <th className="py-2.5 px-1 w-10">数量</th>
                <th className="py-2.5 px-2">提示词</th>
                <th className="py-2.5 px-2 w-20 text-center">状态</th>
                <th className="py-2.5 px-1 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <BatchTableRow
                  key={row.id} row={row} mode={mode} allModels={allModels}
                  isRunning={isRunning}
                  onUpdate={updateRow} onRemove={removeRow}
                  onModelUpload={handleModelUpload}
                  onDownloadSingle={handleDownloadSingle}
                  onRetry={handleRetry}
                  onCompare={handleCompare}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bottom Bar */}
      {hasRows && !isRunning && generatedCount > 0 && (
        <div className="glass-card p-3 flex items-center justify-between">
          <span className="text-xs text-forge-text2">{generatedCount} 张 · {doneCount}/{rows.length} 款完成</span>
          <button onClick={handleDownloadAll} className="gradient-btn px-4 py-2 rounded-lg text-xs flex items-center gap-2"><Download size={13} />下载全部</button>
        </div>
      )}

      {/* Image Compare Modal */}
      <ImageCompareModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        beforeUrl={compareBefore}
        beforeLabel="模特参考图"
        images={compareImages}
        activeIndex={compareIndex}
        onDownload={(url) => {
          const a = document.createElement('a');
          a.href = url;
          a.download = 'vf-result.png';
          a.click();
        }}
      />
    </div>
  );
}
