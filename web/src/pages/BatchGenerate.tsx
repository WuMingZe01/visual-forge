import { useState, useRef, useMemo, useCallback, memo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Layers, Play, Upload, X, Loader2, FolderOpen, Info, Trash2, Settings,
  Camera, CheckCircle2, AlertTriangle, User, Download, StopCircle, RefreshCw,
  Minus, Plus, FolderDown, PlusCircle, History, ZoomIn, BookTemplate, Search, ImageIcon, Link2
} from 'lucide-react';
import { useTaskHistoryStore } from '@/store/useTaskHistoryStore';
import { useLlmStore } from '@/store/useLlmStore';
import { useAppStore } from '@/store/useAppStore';
import { useModelStore } from '@/store/useModelStore';
import { useTemplateStore } from '@/store/useTemplateStore';
import type { ReferenceImage, SKUInfo } from '@/types/tryon-types';
import { AI_MODELS_FOR_TRYON, RESOLUTION_PRESETS } from '@/types/tryon-types';
import { generateTryOnImage, getStoredModelConfig, isModelEnabled, getProvider } from '@/services/tryonApi';
import { availableKeyCount, totalAvailableKeys, getPoolCapacity, getTotalCapacity, allocateTasks } from '@/services/keyPool';
import { queryStyleByCode } from '@/services/lingmao';
import { analyzeSingleRefImage } from '@/services/llmService';
import { buildProductInfoString } from '@/hooks/useAIPrompt';
import { compressImageForRef, blobUrlToFile, withTimeout } from '@/utils/image';
import { saveImage, loadImage, deleteImage, clearAll as clearImageStore } from '@/services/imageStore';
import { getLocalLibrary } from '@/hooks/useLocalLibrary';
import { ImageCompareModal, type CompareImage } from '@/components/ImageCompareModal';
import { runBatchWithPipeline, MAIN_BATCH_WORKFLOW, POSE_BATCH_WORKFLOW, DETAIL_BATCH_WORKFLOW, QUICK_GENERATE_WORKFLOW, PIPELINE_FULL_WORKFLOW, SIMPLE_BATCH_WORKFLOW } from '@/services/pipeline';
import type { WorkflowConfig } from '@/services/pipeline';

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
  styleImage: ReferenceImage | null;
  /** 从款式管理 IndexedDB 加载的细节图 base64 数组 */
  detailImages: string[];
  prompt: string;
  lingmaoData: SKUInfo | null;
  status: 'idle' | 'generating' | 'done' | 'failed';
  resultUrls: string[];
  error: string;
  runningIdx: number;
  count: number;
}

type WorkflowStage = 'main' | 'pose' | 'detail' | 'pipeline';

// 管道工作流列表
const PIPELINE_WORKFLOWS: { id: string; name: string; desc: string; config: WorkflowConfig }[] = [
  { id: 'main_batch', name: '主图批量（全流程）', desc: '准备→LLM反推→并发生图→Mimo校验→完成', config: MAIN_BATCH_WORKFLOW },
  { id: 'pose_batch', name: '姿势裂变（跳过反推）', desc: '准备→并发生图→完成', config: POSE_BATCH_WORKFLOW },
  { id: 'detail_batch', name: '详情批量（跳过反推）', desc: '准备→并发生图→完成', config: DETAIL_BATCH_WORKFLOW },
  { id: 'quick_gen', name: '快速生图（单张）', desc: '准备→并发生图→完成', config: QUICK_GENERATE_WORKFLOW },
  { id: 'simple_batch', name: '简易批量（无校验）', desc: '准备→并发生图→完成', config: SIMPLE_BATCH_WORKFLOW },
  { id: 'pipeline_full', name: '贯穿管道（主图→姿势→详情）', desc: '准备→LLM反推→并发生图→Mimo校验→完成', config: PIPELINE_FULL_WORKFLOW },
];

// ===== 行组件 (memoized) =====
const BatchTableRow = memo(function BatchTableRow({
  row, isRunning, onUpdate, onRemove, onDownloadSingle, onRetry, onCompare, onModelUpload, onStyleUpload,
}: {
  row: BatchRow;
  isRunning: boolean;
  onUpdate: (id: string, u: Partial<BatchRow>) => void;
  onRemove: (id: string) => void;
  onModelUpload: (id: string, f: File) => Promise<void> | void;
  onStyleUpload: (id: string, f: File) => Promise<void> | void;
  onDownloadSingle: (row: BatchRow) => void;
  onRetry: (id: string) => void;
  onCompare: (row: BatchRow, index: number) => void;
}) {
  const hasSku = !!row.skuCode.trim();
  const previewUrls = useMemo(
    () => row.resultUrls.slice(0, 4).map((u) => {
      const sep = u.includes('?') ? '&' : '?';
      // 阿里云 OSS 用原生缩放，其他用 thumb=1（部分 CDN 支持）
      if (u.includes('aliyuncs.com')) return u + sep + 'x-oss-process=image/resize,w_80';
      return u + sep + 'thumb=1';
    }),
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

      {/* Front Image */}
      <td className="py-2 px-1">
        {row.frontImage?.previewUrl ? (
          <div className="relative inline-flex"><img src={row.frontImage.previewUrl} alt="" loading="lazy" decoding="async" className="w-8 h-11 object-cover rounded border border-forge-border/30" /><span className="absolute bottom-0 left-0 bg-forge-cyan/70 text-forge-bg text-[6px] px-0.5 rounded-tr">正</span></div>
        ) : (
          <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) { onUpdate(row.id, { frontImage: { id: genId(), type: 'product_front', previewUrl: URL.createObjectURL(f), name: f.name, size: f.size } }); } }; inp.click(); }}
            className="p-1 rounded border border-dashed border-forge-border/40 text-forge-text2/30 hover:text-forge-cyan hover:border-forge-cyan/30 text-[10px] flex items-center gap-0.5"><Upload size={8} />上传</button>
        )}
      </td>

      {/* Model Image */}
      <td className="py-2 px-1">
        {row.modelImage?.previewUrl ? (
          <div className="relative inline-flex">
            <img src={row.modelImage.previewUrl} alt="" loading="lazy" decoding="async" className="w-8 h-11 object-cover rounded border border-forge-border/30" />
            <button onClick={() => onUpdate(row.id, { modelImage: null })} className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={6} /></button>
          </div>
        ) : (
          <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) onModelUpload(row.id, f); }; inp.click(); }}
            className="p-1 rounded border border-dashed border-forge-border/40 text-forge-text2/30 hover:text-forge-cyan hover:border-forge-cyan/30 text-[10px] flex items-center gap-0.5"><Upload size={8} />模特</button>
        )}
      </td>

      {/* Style Reference Image */}
      <td className="py-2 px-1">
        {row.styleImage?.previewUrl ? (
          <div className="relative inline-flex">
            <img src={row.styleImage.previewUrl} alt="" loading="lazy" decoding="async" className="w-8 h-11 object-cover rounded border border-forge-border/30" />
            <button onClick={() => onUpdate(row.id, { styleImage: null })} className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={6} /></button>
          </div>
        ) : (
          <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) onStyleUpload(row.id, f); }; inp.click(); }}
            className="p-1 rounded border border-dashed border-forge-border/40 text-forge-text2/30 hover:text-forge-cyan hover:border-forge-cyan/30 text-[10px] flex items-center gap-0.5"><Upload size={8} />风格</button>
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
                <img key={i} src={url} alt="" loading="lazy" decoding="async" className="w-5 h-7 object-cover rounded border border-forge-green/20 hover:border-forge-cyan/50 hover:scale-110 transition-transform" />
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
  const updateTask = useTaskHistoryStore((s) => s.updateTask);
  const taskHistoryCount = useTaskHistoryStore((s) => s.tasks.length);
  const getVisionModel = useLlmStore((s) => s.getVisionModel);
  const getTextModel = useLlmStore((s) => s.getTextModel);
  const addToast = useAppStore((s) => s.addToast);

  const [workflowStage, setWorkflowStage] = useState<WorkflowStage>('main');
  const [selectedPipelineWorkflow, setSelectedPipelineWorkflow] = useState<string>('main_batch');
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [globalCount, setGlobalCount] = useState(1);
  const HYBRID_MODEL_ID = '__hybrid__';
  const [globalModel, setGlobalModel] = useState('gpt-image-2'); // 默认 Grsai gpt-image-2, 1024x1024
  const [globalResolution, setGlobalResolution] = useState('3264×2448 (4:3, 4K)');
  const [autoDownload, setAutoDownload] = useState(false);
  const [saveFolderHandle, setSaveFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [aiStatus, setAiStatus] = useState({ step: 0, message: '' });
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);

  // beforeunload protection during generation
  useEffect(() => {
    if (!isRunning) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isRunning]);

  // =====新增：模特库/模板库/Logo选择 =====
  const models = useModelStore((s) => s.models);
  const templates = useTemplateStore((s) => s.templates);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [logoImage, setLogoImage] = useState<ReferenceImage | null>(null);
  const [skuCodeInput, setSkuCodeInput] = useState('');
  // Pipeline-specific template selections
  const [pipelinePoseTemplateId, setPipelinePoseTemplateId] = useState('');
  const [pipelineDetailTemplateId, setPipelineDetailTemplateId] = useState('');
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const selectedModel = models.find((m) => m.id === selectedModelId);

  // Auto-fill style reference from template (load full-res from IndexedDB) — per-row apply
  const applyTemplateToAllRows = useCallback(async () => {
    const tpl = selectedTemplate;
    if (!tpl || tpl.refImages.length === 0) { addToast('warning', '请先选择模板'); return; }
    const ref = tpl.refImages[0];
    const full = await loadImage(`tpl_ref_${ref.id}`);
    const img: ReferenceImage = { id: ref.id, type: 'detail_ref', previewUrl: full || ref.dataUrl, name: ref.name, size: ref.size };
    setRows(prev => prev.map(r => r.styleImage ? r : { ...r, styleImage: img }));
    addToast('success', `已应用模板风格到 ${rows.filter(r => !r.styleImage).length} 行`);
  }, [selectedTemplate, rows]);

  const applyModelToAllRows = useCallback(() => {
    if (!selectedModel?.previewUrl) { addToast('warning', '请先选择模特'); return; }
    const img: ReferenceImage = { id: selectedModel.id, type: 'model', previewUrl: selectedModel.previewUrl, name: selectedModel.originalName, size: selectedModel.size };
    setRows(prev => prev.map(r => r.modelImage ? r : { ...r, modelImage: img }));
    addToast('success', `已应用模特到所有行`);
  }, [selectedModel]);

  // 模板槽位预览（pose/detail 模式：选模板后展示每张参考图 + 可编辑提示词）
  interface TemplateSlot { refIndex: number; refUrl: string; prompt: string; }
  const [templateSlots, setTemplateSlots] = useState<TemplateSlot[]>([]);

  // 选模板后同步槽位（加载 IndexedDB 原图，非 300px 缩略图）
  useEffect(() => {
    const tpl = selectedTemplate;
    const showSlots = (workflowStage === 'pose' || workflowStage === 'detail') && tpl && tpl.refImages.length > 0;
    if (!showSlots) { setTemplateSlots([]); return; }
    let cancelled = false;
    (async () => {
      const slots: TemplateSlot[] = [];
      for (let i = 0; i < tpl.refImages.length; i++) {
        const ref = tpl.refImages[i];
        const full = await loadImage(`tpl_ref_${ref.id}`);
        slots.push({ refIndex: i, refUrl: full || ref.dataUrl, prompt: ref.prompt || `姿势 #${i + 1}` });
      }
      if (!cancelled) setTemplateSlots(slots);
    })();
    return () => { cancelled = true; };
  }, [selectedTemplateId, workflowStage]);

  const updateSlotPrompt = (refIndex: number, prompt: string) => {
    setTemplateSlots(prev => prev.map(s => s.refIndex === refIndex ? { ...s, prompt } : s));
  };
  const replaceSlotImage = (refIndex: number, file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      setTemplateSlots(prev => prev.map(s => s.refIndex === refIndex ? { ...s, refUrl: reader.result as string } : s));
    };
    reader.readAsDataURL(file);
  };

  const abortRef = useRef(false);
  const initialLoadDone = useRef(false);
  // 跟踪本次运行中每行的结果（供写历史任务用）
  const rowResultsRef = useRef<Map<string, { urls: string[]; error: string }>>(new Map());

  // 批量状态刷新：worker 写入 ref 缓冲区，定时器每 500ms 刷到 state，避免每张图都触发全表渲染
  const pendingRef = useRef<Map<string, { urls: string[]; errors: string[]; runningIdx: number }>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyPending = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.size === 0) return;
    setRows((prev) => prev.map((r) => {
      const p = pending.get(r.id);
      if (!p) return r;
      const mergedUrls = [...r.resultUrls, ...p.urls];
      const mergedError = p.errors.length > 0
        ? (r.error ? r.error + '; ' : '') + p.errors.join('; ')
        : r.error;
      const mergedIdx = r.runningIdx + p.runningIdx;
      const newStatus: BatchRow['status'] = mergedUrls.length >= r.count ? 'done' : 'generating';
      return { ...r, resultUrls: mergedUrls, error: mergedError, runningIdx: mergedIdx, status: newStatus };
    }));
    pendingRef.current = new Map();
  }, []);

  const startFlushTimer = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setInterval(applyPending, 500);
  }, [applyPending]);

  const stopFlushTimer = useCallback(() => {
    if (flushTimerRef.current) { clearInterval(flushTimerRef.current); flushTimerRef.current = null; }
    applyPending(); // 最后一次立即 flush
  }, [applyPending]);

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
  interface StoredBatchRow { id: string; skuCode: string; productName: string; frontImage: StoredBatchImage | null; backImage: StoredBatchImage | null; modelImage: StoredBatchImage | null; styleImage: StoredBatchImage | null; prompt: string; lingmaoData: SKUInfo | null; status: BatchRow['status']; resultUrls: string[]; error: string; count: number; }
  interface StoredBatch { globalCount: number; globalModel: string; globalResolution: string; rows: StoredBatchRow[]; }

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
    if (!initialLoadDone.current) return;
    if (rows.length === 0) { localStorage.removeItem(LS_BATCH); return; }
    const stored: StoredBatch = {
      globalCount, globalModel, globalResolution,
      rows: rows.map((r) => ({
        id: r.id, skuCode: r.skuCode, productName: r.productName,
        frontImage: r.frontImage ? { name: r.frontImage.name, size: r.frontImage.size, thumbnail: thumbRef.current.get(`${r.id}_front`) || '' } : null,
        backImage: r.backImage ? { name: r.backImage.name, size: r.backImage.size, thumbnail: thumbRef.current.get(`${r.id}_back`) || '' } : null,
        modelImage: r.modelImage ? { name: r.modelImage.name, size: r.modelImage.size, thumbnail: thumbRef.current.get(`${r.id}_model`) || '' } : null,
        styleImage: r.styleImage ? { name: r.styleImage.name, size: r.styleImage.size, thumbnail: thumbRef.current.get(`${r.id}_style`) || '' } : null,
        prompt: r.prompt, lingmaoData: r.lingmaoData,
        status: r.status, resultUrls: r.resultUrls, error: r.error,
        count: r.count,
      })),
    };
    try { localStorage.setItem(LS_BATCH, JSON.stringify(stored)); } catch {}
  }, [rows, globalCount, globalModel, globalResolution]);

  // Load on mount（必须在 useEffect 中，render 阶段 setState 会导致白屏）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_BATCH);
      if (!raw) return;
      const saved = JSON.parse(raw) as StoredBatch;
      if (saved.globalCount) setGlobalCount(saved.globalCount);
      if (saved.globalModel) setGlobalModel(saved.globalModel);
      if (saved.globalResolution) setGlobalResolution(saved.globalResolution);
      if (saved.rows?.length > 0) {
        setRows(saved.rows.map((sr): BatchRow => {
          const frontThumb = sr.frontImage?.thumbnail || '';
          const backThumb = sr.backImage?.thumbnail || '';
          const modelThumb = sr.modelImage?.thumbnail || '';
          const styleThumb = sr.styleImage?.thumbnail || '';
          if (frontThumb) thumbRef.current.set(`${sr.id}_front`, frontThumb);
          if (backThumb) thumbRef.current.set(`${sr.id}_back`, backThumb);
          if (modelThumb) thumbRef.current.set(`${sr.id}_model`, modelThumb);
          if (styleThumb) thumbRef.current.set(`${sr.id}_style`, styleThumb);
          return {
            id: sr.id, skuCode: sr.skuCode, productName: sr.productName,
            frontImage: sr.frontImage ? { id: genId(), type: 'product_front', previewUrl: frontThumb || '', name: sr.frontImage.name, size: sr.frontImage.size } : null,
            backImage: sr.backImage ? { id: genId(), type: 'product_back', previewUrl: backThumb || '', name: sr.backImage.name, size: sr.backImage.size } : null,
            modelImage: sr.modelImage ? { id: genId(), type: 'model', previewUrl: modelThumb || '', name: sr.modelImage.name, size: sr.modelImage.size } : null,
            styleImage: sr.styleImage ? { id: genId(), type: 'detail_ref', previewUrl: styleThumb || '', name: sr.styleImage.name, size: sr.styleImage.size } : null,
            detailImages: [], prompt: sr.prompt, lingmaoData: sr.lingmaoData,
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

  const handleStyleUpload = useCallback(async (rowId: string, file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 50 * 1024 * 1024) { addToast('warning', '单文件最大 50MB'); return; }
    const thumb = await makeThumb(file);
    if (thumb) thumbRef.current.set(`${rowId}_style`, thumb);
    persistRefImage(`${rowId}_style`, file);
    updateRow(rowId, { styleImage: { id: genId(), type: 'detail_ref', previewUrl: URL.createObjectURL(file), name: file.name, size: file.size } });
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
        modelImage: null, styleImage: null, detailImages: [], prompt: '', lingmaoData: null,
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
    const localLib = getLocalLibrary();
    for (const code of codes) {
      if (!code) continue;
      // First try local library
      const localEntry = localLib.find(s => s.skuCode === code);
      if (localEntry) {
        setRows((prev) => prev.map((row) => {
          if (row.skuCode !== code) return row;
          const updates: Partial<BatchRow> = { lingmaoData: localEntry, productName: localEntry.productName || code };
          return { ...row, ...updates };
        }));
        // 从 IndexedDB 异步加载白底图（localStorage 只存标记，图片在 IndexedDB）
        const flags = localEntry as unknown as Record<string, unknown>;
        const sku = code;
        (async () => {
          const [frontB64, backB64] = await Promise.all([
            flags._hasFront ? loadImage(`style_${sku}_front`) : Promise.resolve(undefined),
            flags._hasBack ? loadImage(`style_${sku}_back`) : Promise.resolve(undefined),
          ]);
          setRows((prev) => prev.map((row) => {
            if (row.skuCode !== sku) return row;
            const u: Partial<BatchRow> = {};
            if (frontB64 && !row.frontImage) {
              u.frontImage = { id: genId(), type: 'product_front', previewUrl: frontB64, name: `${sku}_正面`, size: 0 };
            }
            if (backB64 && !row.backImage) {
              u.backImage = { id: genId(), type: 'product_back', previewUrl: backB64, name: `${sku}_反面`, size: 0 };
            }
            return Object.keys(u).length > 0 ? { ...row, ...u } : row;
          }));
        })();
        continue;
      }
      // Fallback to Lingmao
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

  // Batch import from SKU codes (text input)
  const handleSkuCodeImport = async () => {
    const codes = skuCodeInput.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    if (codes.length === 0) { addToast('warning', '请输入款号'); return; }

    const existingCodes = new Set(rows.map(r => r.skuCode));
    const newCodes = codes.filter(c => !existingCodes.has(c));
    if (newCodes.length === 0) { addToast('info', '所有款号已在列表中'); return; }

    const newRows: BatchRow[] = newCodes.map(code => ({
      id: genId(), skuCode: code, productName: '', frontImage: null, backImage: null,
      modelImage: null, styleImage: null, detailImages: [], prompt: '', lingmaoData: null,
      status: 'idle' as const, resultUrls: [], error: '', runningIdx: 0, count: globalCount,
    }));

    setRows(prev => [...prev, ...newRows]);
    setSkuCodeInput('');
    addToast('info', `已添加 ${newRows.length} 个款号，正在关联资料...`);
    await autoFetchLingmao(newCodes);
    const matched = rows.filter(r => r.lingmaoData || r.frontImage).length;
    addToast('success', `关联完成: ${matched}/${rows.length + newRows.length} 行有资料`);
  };

  // ===== Add Manual Row =====
  const addManualRow = () => {
    setRows((prev) => [...prev, {
      id: genId(), skuCode: '', productName: '', frontImage: null, backImage: null,
      modelImage: null, styleImage: null, detailImages: [], prompt: 'Professional fashion e-commerce photography, model wearing the garment, soft studio lighting, clean background, 8K quality',
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

  // ===== Pipeline: pose/detail stage with specific template =====
  const runPipelinePoseDetail = async (stage: 'pose' | 'detail', template: typeof selectedTemplate, targetRows: BatchRow[]) => {
    if (!template || template.refImages.length === 0) { addToast('warning', `未选择${stage === 'pose' ? '姿势' : '详情'}模板`); return; }

    const isHybrid = globalModel === HYBRID_MODEL_ID;
    const concurrency = Math.min(
      isHybrid ? getTotalCapacity() : getPoolCapacity(getProvider(globalModel)),
      36
    );
    const preset = RESOLUTION_PRESETS.find((p) => p.label === globalResolution);

    // 预计算混合引擎任务分配
    let hybridAssignments: ReturnType<typeof allocateTasks> = [];
    let hybridAssignCursor = 0;
    if (isHybrid) {
      const totalHybridTasks = targetRows.length * (template.refImages.length || 1);
      hybridAssignments = allocateTasks(totalHybridTasks);
    }

    // 预加载模板参考图原图（从 IndexedDB 加载，避免 300px 缩略图）
    const refSlots = await Promise.all(template.refImages.map(async (ref, i) => {
      const full = await loadImage(`tpl_ref_${ref.id}`);
      return { refUrl: full || ref.dataUrl, prompt: ref.prompt || `${stage === 'pose' ? '姿势' : '详情'} #${i + 1}` };
    }));
    let idx = 0;
    const totalTasks = targetRows.length * refSlots.length;

    const worker = async () => {
      while (true) {
        if (abortRef.current) return;
        const i = idx++;
        if (i >= totalTasks) return;
        const rowIdx = Math.floor(i / refSlots.length);
        const slotIdx = i % refSlots.length;
        const row = targetRows[rowIdx];
        if (!row) return;

        const slot = refSlots[slotIdx];

        try {
          // 加载每行模特图
          let modelB64: string | undefined;
          const cached = await loadImage(`${row.id}_model`);
          if (cached) { modelB64 = cached; }
          else if (row.modelImage?.previewUrl) {
            try {
              const mf = await withTimeout(blobUrlToFile(row.modelImage.previewUrl, row.modelImage.name), 15000, `pModel ${row.skuCode}`);
              modelB64 = await withTimeout(compressImageForRef(mf), 15000, `pModel compress ${row.skuCode}`);
            } catch {}
          }

          let frontB64 = '';
          if (row.frontImage?.previewUrl) {
            const pf = await blobUrlToFile(row.frontImage.previewUrl, row.frontImage.name);
            frontB64 = await compressImageForRef(pf);
          } else if (row.lingmaoData?.frontImageBase64) {
            frontB64 = row.lingmaoData.frontImageBase64;
          }

          let taskModelId = globalModel;
          if (isHybrid && hybridAssignments.length > 0) {
            const assignment = hybridAssignments[hybridAssignCursor++ % hybridAssignments.length];
            taskModelId = assignment.provider === 'grsai' ? 'gpt-image-2-vip' : 'gpt-image-2-all';
          }

          const url = await generateTryOnImage({
            prompt: `${template.promptTemplate.replace('{sku}', row.skuCode || '')}, ${slot.prompt}`,
            modelImageBase64: modelB64,
            productImageBase64: frontB64,
            styleRefBase64: slot.refUrl,
            width: preset?.width || 2448, height: preset?.height || 3264,
            modelId: taskModelId,
          });

          // 写入缓冲区，由定时器批量刷到 state
          const pen = pendingRef.current.get(row.id) || { urls: [], errors: [], runningIdx: 0 };
          pen.urls.push(url);
          pen.runningIdx++;
          pendingRef.current.set(row.id, pen);
        } catch (e) {
          const pen = pendingRef.current.get(row.id) || { urls: [], errors: [], runningIdx: 0 };
          pen.errors.push(String(e).slice(0, 80));
          pendingRef.current.set(row.id, pen);
        }
      }
    };

    setAiStatus({ step: 2, message: `${concurrency}路并发` });
    startFlushTimer();
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    stopFlushTimer();

    for (const row of targetRows) {
      addTask({
        id: genId(), type: stage === 'pose' ? 'tryon' : 'detail',
        skuCode: row.skuCode || '', productName: row.productName || '',
        modelId: globalModel, provider: globalModel === HYBRID_MODEL_ID ? 'hybrid' : getProvider(globalModel),
        prompt: `${stage} pipeline`, params: { stage, template: template.name },
        status: 'completed', progress: 100, resultUrls: row.resultUrls, referenceUrls: [],
        error: '', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      });
    }
  };

  // ===== Pose/Detail batch handler =====
  const handlePoseDetailRun = async (stage: 'pose' | 'detail') => {
    const targetRows = rows.filter((r) => r.status !== 'done');
    if (targetRows.length === 0) { addToast('warning', '没有待生成的行'); return; }
    if (!selectedTemplate) { addToast('warning', `请选择${stage === 'pose' ? '姿势' : '详情'}模板`); return; }

    // 槽位未加载时按需加载（避免异步竞态）
    let slots = templateSlots.length > 0 ? [...templateSlots] : [];
    if (slots.length === 0 && selectedTemplate.refImages.length > 0) {
      setAiStatus({ step: 0, message: '加载模板参考图...' });
      const loaded: typeof templateSlots = [];
      for (let i = 0; i < selectedTemplate.refImages.length; i++) {
        const ref = selectedTemplate.refImages[i];
        const full = await loadImage(`tpl_ref_${ref.id}`);
        loaded.push({ refIndex: i, refUrl: full || ref.dataUrl, prompt: ref.prompt || `${stage === 'pose' ? '姿势' : '详情'} #${i + 1}` });
      }
      slots = loaded;
      setTemplateSlots(loaded); // 同步回 state，供下次使用
    }
    if (slots.length === 0) { addToast('warning', '模板无参考图，无法生成'); return; }

    setIsRunning(true);
    setAiStatus({ step: 1, message: `${stage === 'pose' ? '姿势裂变' : '详情'}批量生成中...` });
    abortRef.current = false;
    rowResultsRef.current = new Map();

    const preset = RESOLUTION_PRESETS.find((p) => p.label === globalResolution);
    const isHybrid = globalModel === HYBRID_MODEL_ID;
    const concurrency = Math.min(
      isHybrid ? getTotalCapacity() : getPoolCapacity(getProvider(globalModel)),
      36
    );

    // 预计算混合引擎任务分配
    let hybridAssignments: ReturnType<typeof allocateTasks> = [];
    let hybridAssignCursor = 0;
    if (isHybrid) {
      const totalHybridTasks = targetRows.length * slots.length;
      hybridAssignments = allocateTasks(totalHybridTasks);
    }

    try {
      let idx = 0;
      const totalTasks = targetRows.length * slots.length;

      const worker = async () => {
        while (true) {
          if (abortRef.current) return;
          const i = idx++;
          if (i >= totalTasks) return;
          const rowIdx = Math.floor(i / slots.length);
          const slotIdx = i % slots.length;
          const row = targetRows[rowIdx];
          if (!row) return;

          const slot = slots[slotIdx];

          try {
            // 加载每行模特图
            let modelB64: string | undefined;
            const cached = await loadImage(`${row.id}_model`);
            if (cached) { modelB64 = cached; }
            else if (row.modelImage?.previewUrl) {
              try {
                const mf = await withTimeout(blobUrlToFile(row.modelImage.previewUrl, row.modelImage.name), 15000, `model ${row.skuCode}`);
                modelB64 = await withTimeout(compressImageForRef(mf), 15000, `model compress ${row.skuCode}`);
              } catch {}
            }

            let productB64 = '';
            if (row.frontImage?.previewUrl) {
              const pf = await blobUrlToFile(row.frontImage.previewUrl, row.frontImage.name);
              productB64 = await compressImageForRef(pf);
            }

            let taskModelId = globalModel;
            if (isHybrid && hybridAssignments.length > 0) {
              const assignment = hybridAssignments[hybridAssignCursor++ % hybridAssignments.length];
              taskModelId = assignment.provider === 'grsai' ? 'gpt-image-2-vip' : 'gpt-image-2-all';
            }

            const url = await generateTryOnImage({
              prompt: `${selectedTemplate.promptTemplate.replace('{sku}', row.skuCode || '')}, ${slot.prompt}`,
              modelImageBase64: modelB64,
              productImageBase64: productB64,
              styleRefBase64: slot.refUrl,
              width: preset?.width || 2448, height: preset?.height || 3264,
              modelId: taskModelId,
            });

            const rowEntry = rowResultsRef.current.get(row.id) || { urls: [], error: '' };
            rowEntry.urls.push(url);
            rowResultsRef.current.set(row.id, rowEntry);

            // 写入缓冲区，由定时器批量刷到 state
            const pen = pendingRef.current.get(row.id) || { urls: [], errors: [], runningIdx: 0 };
            pen.urls.push(url);
            pen.runningIdx++;
            pendingRef.current.set(row.id, pen);
          } catch (e) {
            const err = String(e).slice(0, 80);
            const pen = pendingRef.current.get(row.id) || { urls: [], errors: [], runningIdx: 0 };
            pen.errors.push(err);
            pendingRef.current.set(row.id, pen);
          }
        }
      };

      setAiStatus({ step: 2, message: `${concurrency}路并发` });
      startFlushTimer();
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      stopFlushTimer();

      // Write task history
      for (const row of targetRows) {
        const data = rowResultsRef.current.get(row.id);
        addTask({
          id: genId(), type: stage === 'pose' ? 'tryon' : 'detail',
          skuCode: row.skuCode || '', productName: row.productName || '',
          modelId: globalModel, provider: globalModel === HYBRID_MODEL_ID ? 'hybrid' : getProvider(globalModel),
          prompt: `${stage} batch`, params: { stage, template: selectedTemplate.name },
          status: data?.urls.length ? 'completed' : 'failed',
          progress: 100, resultUrls: data?.urls || [], referenceUrls: [],
          error: data?.error || '', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        });
      }

      setAiStatus({ step: 3, message: '完成' });
    } catch (e) {
      addToast('error', `${stage}批量失败: ${String(e).slice(0, 100)}`);
    } finally {
      setIsRunning(false);
      setRows((prev) => prev.map((r) => (r.status === 'generating' ? { ...r, status: 'idle' as const } : r)));
    }
  };

  // ===== Main Run (Pipeline-Driven) =====
  const handleRun = async () => {
    // Dispatch to stage-specific handlers
    if (workflowStage === 'pose') { await handlePoseDetailRun('pose'); return; }
    if (workflowStage === 'detail') { await handlePoseDetailRun('detail'); return; }

    // Cleanup stale 'generating' rows
    setRows((prev) => prev.map((r) => (r.status === 'generating' ? { ...r, status: 'idle' as const, runningIdx: 0 } : r)));

    const targetRows = rows.filter((r) => r.status !== 'done');
    if (targetRows.length === 0) { addToast('warning', '没有待生成的行，请先导入商品图片'); return; }

    const visionModel = getVisionModel();
    const textModel = getTextModel();
    if (!visionModel || !textModel) {
      addToast('warning', '请先在系统设置中启用 LLM 模型（多模态 + DeepSeek）');
      return;
    }

    const isHybrid = globalModel === HYBRID_MODEL_ID;
    const isPipeline = workflowStage === 'pipeline';
    const preset = RESOLUTION_PRESETS.find((p) => p.label === globalResolution);
    const batchId = `batch_${genId()}`;
    const batchLabel = `${new Date().toLocaleString('zh-CN')} · ${targetRows.length}款`;

    abortRef.current = false;
    rowResultsRef.current = new Map();
    setIsRunning(true);
    setAiStatus({ step: 0, message: '准备中...' });

    // 获取选择的管道工作流配置
    const selectedWorkflow = PIPELINE_WORKFLOWS.find(wf => wf.id === selectedPipelineWorkflow)?.config || MAIN_BATCH_WORKFLOW;

    try {
      // 管道引擎驱动：准备 → LLM分析 → 并发生图 → Mimo校验 → 完成
      await runBatchWithPipeline({
        rows,
        globalModel,
        globalResolution: preset ? { width: preset.width, height: preset.height } : undefined,
        isHybrid,
        hasLingmaoData: rows.some(r => !!r.lingmaoData),
        visionModel,
        textModel,
        logoImage,
        selectedModelId,
        abortRef,
        rowResultsRef,
        pendingRef,
        batchId,
        batchLabel,
        addTask,
        updateTask,
        autoDownload,
        saveFolderHandle,
        onProgress: (msg) => setAiStatus((prev) => ({ step: prev.step, message: msg })),
        onPromptUpdate: (rowId, prompt) => setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, prompt } : r)),
        startFlushTimer,
        stopFlushTimer,
        addToast,
        setRowsGenerating: (ids) => setRows((prev) => prev.map((r) => ids.has(r.id) ? { ...r, status: 'generating' as const, runningIdx: 0 } : r)),
        workflow: selectedWorkflow,
      });

      setAiStatus({
        step: 4,
        message: abortRef.current ? `已终止` : `完成 · ${targetRows.length} 款`,
      });
    } catch (e) {
      console.error('[handleRun] ERROR:', e);
      addToast('error', '批量处理失败: ' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      stopFlushTimer();
      setRows((prev) => prev.map((r) => (r.status === 'generating' ? { ...r, status: 'idle' as const, runningIdx: 0 } : r)));
      setIsRunning(false);

      // Pipeline continuation: main → pose → detail
      if (isPipeline && !abortRef.current) {
        const doneRowIds = new Set<string>();
        for (const [rowId, data] of rowResultsRef.current) {
          if (data.urls.length > 0) doneRowIds.add(rowId);
        }
        const doneRows = targetRows.filter(r => doneRowIds.has(r.id));
        if (doneRows.length > 0) {
          if (pipelinePoseTemplateId) {
            setAiStatus({ step: 2, message: '阶段2/3: 批量姿势裂变...' });
            const poseTpl = templates.find(t => t.id === pipelinePoseTemplateId);
            if (poseTpl && poseTpl.refImages.length > 0) {
              await new Promise(r => setTimeout(r, 300));
              await runPipelinePoseDetail('pose', poseTpl, doneRows);
            }
            if (abortRef.current) { addToast('warning', '流水线在姿势裂变阶段终止'); return; }
          }

          if (pipelineDetailTemplateId && !abortRef.current) {
            setAiStatus({ step: 3, message: '阶段3/3: 批量详情生成...' });
            const detailTpl = templates.find(t => t.id === pipelineDetailTemplateId);
            if (detailTpl && detailTpl.refImages.length > 0) {
              await new Promise(r => setTimeout(r, 300));
              await runPipelinePoseDetail('detail', detailTpl, doneRows);
            }
          }

          setAiStatus({ step: 4, message: '贯穿流水线完成!' });
          addToast('success', `贯穿流水线: ${doneRows.length} 款 主图→姿势→详情 完成`);
        }
      }
    }
  };

  // ===== Render =====
  const hasRows = rows.length > 0;
  // ===== 批量反推风格参考图提示词（逐张调用，1:1 映射无歧义）=====
  const batchAnalyzeStylePrompts = async () => {
    const visionModel = getVisionModel();
    if (!visionModel) { addToast('warning', '请先启用多模态模型'); return; }
    const rowsWithStyle = rows.filter(r => r.styleImage?.previewUrl);
    if (rowsWithStyle.length === 0) { addToast('warning', '没有可反推的风格参考图'); return; }

    setBatchAnalyzing(true);
    let ok = 0;

    try {
      for (let i = 0; i < rowsWithStyle.length; i++) {
        const rowId = rowsWithStyle[i].id;
        const b64 = rowsWithStyle[i].styleImage?.previewUrl;
        setAiStatus({ step: 0, message: `正在反推 ${i + 1}/${rowsWithStyle.length} 张风格图...` });
        try {
          const prompt = b64 ? await analyzeSingleRefImage(visionModel, b64) : '';
          if (prompt) {
            ok++;
            setRows(prev => prev.map(r => r.id === rowId ? { ...r, prompt } : r));
          }
        } catch (e) {
          console.warn('[Batch] 反推失败:', e);
        }
      }
      addToast('success', `批量反推完成: ${ok}/${rowsWithStyle.length} 张`);
      setAiStatus({ step: 0, message: '' });
    } catch (e) {
      addToast('error', '批量反推失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBatchAnalyzing(false);
    }
  };

  const stop = () => {
    abortRef.current = true;
    setAiStatus({ step: 0, message: '正在终止...' });
    setRows((prev) => prev.map((r) => (r.status === 'generating' ? { ...r, status: 'idle' as const, runningIdx: 0 } : r)));
  };
  const clearAll = () => {
    if (!confirm(`确认清空全部 ${rows.length} 行数据？此操作不可撤销。`)) return;
    setRows([]); localStorage.removeItem(LS_BATCH); clearImageStore();
  };
  const failedCount = rows.filter((r) => r.status === 'failed').length;

  const handleRetry = useCallback((id: string) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const keptUrls = r.resultUrls || [];
      const remaining = Math.max(1, r.count - keptUrls.length);
      return { ...r, status: 'idle' as const, error: '', count: remaining, runningIdx: 0 };
    }));
  }, []);

  const handleCompare = useCallback((row: BatchRow, index: number) => {
    setCompareBefore(row.modelImage?.previewUrl || '');
    setCompareImages(
      row.resultUrls.map((url, i) => ({
        url,
        label: `${row.skuCode || '结果'} #${i + 1}`,
      }))
    );
    setCompareIndex(index);
    setCompareOpen(true);
  }, []);

  const handleRetryAllFailed = () => {
    setRows((prev) => prev.map((r) => {
      if (r.status !== 'failed') return r;
      const keptUrls = r.resultUrls || [];
      const remaining = Math.max(1, r.count - keptUrls.length);
      return { ...r, status: 'idle' as const, error: '', count: remaining, runningIdx: 0 };
    }));
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
          {hasRows && !isRunning && (
            <button onClick={batchAnalyzeStylePrompts} disabled={batchAnalyzing || !rows.some(r => r.styleImage?.previewUrl)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-500/15 text-purple-300 border border-purple-400/30 rounded-lg transition-colors hover:bg-purple-500/20 disabled:opacity-50">
              {batchAnalyzing ? <Loader2 size={13} className="animate-spin" /> : <BookTemplate size={13} />}
              批量反推
            </button>
          )}
          {isRunning ? (
            <button onClick={stop} className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 bg-forge-red/15 text-forge-red border border-forge-red/30 hover:bg-forge-red/20"><StopCircle size={14} />终止</button>
          ) : (
            <button onClick={handleRun} disabled={readyCount === 0 || ((workflowStage === 'pose' || workflowStage === 'detail') && templateSlots.length === 0)} className="orange-btn px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"><Play size={14} />{workflowStage === 'pose' ? `批量姿势裂变 (${readyCount})` : workflowStage === 'detail' ? `批量详情生成 (${readyCount})` : workflowStage === 'pipeline' ? `贯穿流水线 (${readyCount})` : `批量生成 (${readyCount})`}</button>
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

      {/* Workflow Stage Selector */}
      <div className="glass-card p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-forge-text2 mr-2">工作流:</span>
          <div className="flex gap-1 p-0.5 glass-card rounded-lg">
            {([
              { v: 'main' as WorkflowStage, l: '主图批量', desc: '白底图→主图' },
              { v: 'pose' as WorkflowStage, l: '姿势裂变', desc: '主图→多姿势' },
              { v: 'detail' as WorkflowStage, l: '详情批量', desc: '主图→详情页' },
              { v: 'pipeline' as WorkflowStage, l: '贯穿流水线', desc: '全自动:主图→姿势→详情' },
            ]).map((s) => (
              <button key={s.v} onClick={() => setWorkflowStage(s.v)}
                className={`px-3 py-1.5 rounded-md text-xs transition-all ${workflowStage === s.v ? 'bg-forge-cyan/15 text-forge-cyan font-medium' : 'text-forge-text2 hover:text-forge-text'}`}
                title={s.desc}>
                {s.l}
              </button>
            ))}
          </div>
          {workflowStage === 'pipeline' && (
            <span className="text-[10px] text-forge-orange ml-2">贯穿模式：先主图→再裂变→最后详情，全自动串联</span>
          )}
        </div>

        {/* Pipeline Workflow Selector */}
        <div className="mt-3 pt-3 border-t border-forge-border/20">
          <div className="flex items-center gap-2">
            <span className="text-xs text-forge-text2 mr-2">管道工作流:</span>
            <select
              value={selectedPipelineWorkflow}
              onChange={(e) => setSelectedPipelineWorkflow(e.target.value)}
              className="input-field !py-1 text-xs !w-auto min-w-[200px]"
            >
              {PIPELINE_WORKFLOWS.map((wf) => (
                <option key={wf.id} value={wf.id}>{wf.name}</option>
              ))}
            </select>
            <span className="text-[10px] text-forge-text2/60">
              {PIPELINE_WORKFLOWS.find(wf => wf.id === selectedPipelineWorkflow)?.desc}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {PIPELINE_WORKFLOWS.find(wf => wf.id === selectedPipelineWorkflow)?.config.stages.map((stage) => (
              <span
                key={stage.id}
                className={`px-2 py-0.5 rounded text-[10px] ${
                  stage.enabled
                    ? 'bg-forge-cyan/15 text-forge-cyan'
                    : 'bg-forge-surface2/60 text-forge-text2/40 line-through'
                }`}
              >
                {stage.id}
              </span>
            ))}
          </div>
        </div>
      </div>

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
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 flex items-center gap-1" title="混合引擎按加权健康评分自动在 Yunwu 和 Grsai 间分配任务。成功率高的引擎分到更多任务，支持熔断自动切换。">
                    🚀 混合 · {total}KEY <Info size={10} />
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
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-forge-text2 whitespace-nowrap">模板</label>
            <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} className="input-field !py-1 text-xs !w-auto min-w-[120px]">
              <option value="">自定义</option>
              {templates.filter((t) => {
                if (workflowStage === 'pose') return t.type === 'pose';
                if (workflowStage === 'detail') return t.type === 'detail';
                return t.type === 'main';
              }).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.garmentCategory === 'tops' ? '上' : '下'})</option>)}
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

          <div className="flex items-center gap-2">
            <label className="text-xs text-forge-text2 whitespace-nowrap">风格参考</label>
            <span className="text-[10px] text-forge-text2/40">勾选模板后点应用到全部，或每行单独上传</span>
          </div>
        </div>

        {/* Pipeline template selectors */}
        {workflowStage === 'pipeline' && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-forge-orange/30 flex-wrap">
            <span className="text-[10px] text-forge-orange font-medium">贯穿配置:</span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-forge-text2 whitespace-nowrap">姿势模板</label>
              <select value={pipelinePoseTemplateId} onChange={(e) => setPipelinePoseTemplateId(e.target.value)} className="input-field !py-1 text-xs !w-auto min-w-[100px]">
                <option value="">默认姿势模板</option>
                {templates.filter(t => t.type === 'pose').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-forge-text2 whitespace-nowrap">详情模板</label>
              <select value={pipelineDetailTemplateId} onChange={(e) => setPipelineDetailTemplateId(e.target.value)} className="input-field !py-1 text-xs !w-auto min-w-[100px]">
                <option value="">默认详情模板</option>
                {templates.filter(t => t.type === 'detail').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
        )}

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

      {/* Template Slot Preview (pose/detail mode) */}
      {(workflowStage === 'pose' || workflowStage === 'detail') && templateSlots.length > 0 && (
        <div className="glass-card p-4 border border-forge-cyan/30">
          <h3 className="text-xs text-forge-text2 mb-3 flex items-center gap-2">
            <BookTemplate size={14} />
            {workflowStage === 'pose' ? '姿势模板槽位' : '详情模板槽位'} — {templateSlots.length} 张参考图，1:1 对应生成
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {templateSlots.map((slot) => (
              <div key={slot.refIndex} className="glass-card overflow-hidden border border-forge-border/20">
                <div className="aspect-[3/4] bg-forge-surface2/50 flex items-center justify-center relative group">
                  <img src={slot.refUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  <button onClick={() => {
                    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
                    inp.onchange = () => { const f = inp.files?.[0]; if (f) replaceSlotImage(slot.refIndex, f); };
                    inp.click();
                  }} className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[10px] text-white bg-forge-cyan/70 px-2 py-1 rounded">更换参考图</span>
                  </button>
                </div>
                <div className="p-2">
                  <span className="text-[9px] text-forge-text2/50 font-medium">#{slot.refIndex + 1}</span>
                  <textarea
                    value={slot.prompt}
                    onChange={(e) => updateSlotPrompt(slot.refIndex, e.target.value)}
                    className="textarea-field !min-h-[40px] !py-1 text-[10px] w-full"
                    placeholder="姿势提示词..."
                    disabled={isRunning}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Import + SKU Input */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass-card p-4">
          <h3 className="text-xs text-forge-text2 mb-3 flex items-center gap-2"><FolderOpen size={14} />导入白底图</h3>
          <p className="text-[10px] text-forge-text2/50 mb-3">命名：<span className="text-forge-cyan font-mono">款号_正面.png</span></p>
          <button onClick={() => {
            const inp = document.createElement('input'); inp.type = 'file';
            inp.webkitdirectory = true; inp.setAttribute('directory', ''); inp.setAttribute('multiple', '');
            inp.onchange = () => { if (inp.files && inp.files.length > 0) handleFolderImport(inp.files); };
            inp.click();
          }} className="w-full border-2 border-dashed border-forge-border/50 rounded-xl py-4 text-center hover:border-forge-cyan/30 transition-colors group mb-2">
            <FolderOpen size={20} className="mx-auto text-forge-text2/25 group-hover:text-forge-cyan/40 mb-1" />
            <p className="text-xs text-forge-text2/50">选择文件夹导入</p>
          </button>
          <button onClick={addManualRow} className="w-full border-2 border-dashed border-forge-border/40 rounded-xl py-3 text-center hover:border-forge-orange/30 transition-colors group">
            <PlusCircle size={18} className="mx-auto text-forge-text2/25 group-hover:text-forge-orange/40 mb-1" />
            <p className="text-xs text-forge-text2/50">手动添加一行</p>
          </button>
        </div>

        <div className="glass-card p-4">
          <h3 className="text-xs text-forge-text2 mb-3 flex items-center gap-2"><Search size={14} />批量款号关联</h3>
          <p className="text-[10px] text-forge-text2/50 mb-3">输入款号自动关联款式库中的<span className="text-forge-green">商品资料+白底图</span></p>
          <textarea value={skuCodeInput} onChange={e => setSkuCodeInput(e.target.value)}
            placeholder="粘贴款号，每行一个或用逗号分隔&#10;例如：&#10;BM26B085CM&#10;BM26A050CM&#10;BM26B030CM"
            className="textarea-field h-24 text-xs mb-2" />
          <button onClick={handleSkuCodeImport}
            className="w-full py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 bg-forge-cyan/15 text-forge-cyan border border-forge-cyan/30 hover:bg-forge-cyan/20 transition-all">
            <Link2 size={12} />一键关联 ({skuCodeInput.split(/[\n,;]+/).filter(Boolean).length || 0} 个款号)
          </button>
        </div>

        <div className="glass-card p-4">
          <h3 className="text-xs text-forge-text2 mb-3 flex items-center gap-2"><User size={14} />快速填充</h3>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={applyModelToAllRows} className="text-[10px] px-2 py-1 rounded border border-forge-border/40 text-forge-text2 hover:text-forge-cyan hover:border-forge-cyan/30">
              模特应用到全部
            </button>
            <button onClick={applyTemplateToAllRows} className="text-[10px] px-2 py-1 rounded border border-forge-border/40 text-forge-text2 hover:text-forge-cyan hover:border-forge-cyan/30">
              模板风格应用到全部
            </button>
            <span className="text-[10px] text-forge-text2/40">每行可单独更换模特和风格参考</span>
          </div>
        </div>
      </div>

      {/* Table */}
      {hasRows && (
        <div className="glass-card overflow-x-auto" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-forge-surface z-10">
              <tr className="text-forge-text2/50 border-b border-forge-border/30 text-left">
                <th className="py-2.5 px-2 w-16">款号</th>
                <th className="py-2.5 px-1 w-12">{workflowStage === 'main' ? '正面' : '主图'}</th>
                <th className="py-2.5 px-1 w-12">模特</th>
                <th className="py-2.5 px-1 w-12">风格</th>
                {(workflowStage === 'pose' || workflowStage === 'detail' || workflowStage === 'pipeline') && (
                  <th className="py-2.5 px-1 w-12">{workflowStage === 'pose' ? '姿势模板' : '详情模板'}</th>
                )}
                <th className="py-2.5 px-1 w-10">数量</th>
                <th className="py-2.5 px-2">提示词</th>
                <th className="py-2.5 px-2 w-20 text-center">状态</th>
                <th className="py-2.5 px-1 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <BatchTableRow
                  key={row.id} row={row}
                  isRunning={isRunning}
                  onUpdate={updateRow} onRemove={removeRow}
                  onModelUpload={handleModelUpload}
                  onStyleUpload={handleStyleUpload}
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
