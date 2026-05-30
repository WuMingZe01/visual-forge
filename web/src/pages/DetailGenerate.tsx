import { useState, useRef, useEffect } from 'react';
import { LayoutTemplate, Play, Upload, X, Loader2, Camera, CheckCircle2, AlertTriangle, Download, StopCircle, Users, BookTemplate, Zap, Search, Wand2, ChevronDown, ChevronUp } from 'lucide-react';
import { useModelStore } from '@/store/useModelStore';
import { useTemplateStore } from '@/store/useTemplateStore';
import { useLlmStore } from '@/store/useLlmStore';
import { useAppStore } from '@/store/useAppStore';
import { useTaskHistoryStore } from '@/store/useTaskHistoryStore';
import type { ReferenceImage, SKUInfo } from '@/types/tryon-types';
import { generateTryOnImage, getProvider } from '@/services/tryonApi';
import { syncKeyPools } from '@/services/keyPool';
import { assembleFinalPrompt, analyzeSingleDetailRefImage } from '@/services/llmService';
import { buildProductInfoString } from '@/hooks/useAIPrompt';
import { compressImageForRef, blobUrlToFile, withTimeout } from '@/utils/image';
import { queryStyleByCode } from '@/services/lingmao';
import { getLocalLibrary } from '@/hooks/useLocalLibrary';
import { loadImage } from '@/services/imageStore';

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

interface DetailSlot {
  refIndex: number;
  refUrl: string;
  prompt: string;
  status: 'idle' | 'done' | 'failed';
  url: string;
  error?: string;
  expanded?: boolean;
}

export function DetailGenerate() {
  const models = useModelStore((s) => s.models);
  const templates = useTemplateStore((s) => s.templates);
  const getVisionModel = useLlmStore((s) => s.getVisionModel);
  const getTextModel = useLlmStore((s) => s.getTextModel);
  const addToast = useAppStore((s) => s.addToast);
  const defaultModelId = useAppStore((s) => s.config.defaultModelId);
  const addTask = useTaskHistoryStore((s) => s.addTask);

  const [modelImage, setModelImage] = useState<ReferenceImage | null>(null);
  const [productImage, setProductImage] = useState<ReferenceImage | null>(null);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [skuCode, setSkuCode] = useState('');
  const [skuInfo, setSkuInfo] = useState<SKUInfo | undefined>(undefined);
  const [isRunning, setIsRunning] = useState(false);
  const [slots, setSlots] = useState<DetailSlot[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const abortRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const skuQueryRef = useRef('');

  const detailTemplates = templates.filter((t) => t.type === 'detail');
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const selectedModel = models.find((m) => m.id === selectedModelId);

  const handleModelUpload = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setModelImage({ id: genId(), type: 'model', previewUrl: URL.createObjectURL(file), name: file.name, size: file.size });
  };
  const handleProductUpload = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setProductImage({ id: genId(), type: 'product_front', previewUrl: URL.createObjectURL(file), name: file.name, size: file.size });
  };

  // SKU auto-link (with race condition guard)
  useEffect(() => {
    if (!skuCode.trim() || skuCode.length < 5) { setSkuInfo(undefined); return; }
    const code = skuCode.trim();
    skuQueryRef.current = code;
    const timer = setTimeout(async () => {
      try {
        const localLib = getLocalLibrary();
        const localInfo = localLib.find(s => s.skuCode === code);
        if (localInfo) {
          if (skuQueryRef.current === code) setSkuInfo(localInfo);
        } else {
          const result = await queryStyleByCode([code]);
          if (result.skuInfo && skuQueryRef.current === code) setSkuInfo(result.skuInfo);
        }
      } catch { /* skip */ }
    }, 800);
    return () => clearTimeout(timer);
  }, [skuCode]);

  // Load template slots (从 IndexedDB 加载原图)
  useEffect(() => {
    if (!selectedTemplate || selectedTemplate.refImages.length === 0) { setSlots([]); return; }
    let cancelled = false;
    (async () => {
      const loaded = await Promise.all(selectedTemplate.refImages.map(async (ref, i) => {
        const full = await loadImage(`tpl_ref_${ref.id}`);
        return {
          refIndex: i,
          refUrl: full || ref.dataUrl,
          prompt: ref.prompt || `详情图 #${i + 1}`,
          status: 'idle' as const,
          url: '',
        };
      }));
      if (!cancelled) setSlots(loaded);
    })();
    return () => { cancelled = true; };
  }, [selectedTemplateId]);

  const updateSlotPrompt = (refIndex: number, prompt: string) => {
    setSlots(prev => prev.map(s => s.refIndex === refIndex ? { ...s, prompt } : s));
  };

  const toggleSlotExpand = (refIndex: number) => {
    setSlots(prev => prev.map(s => s.refIndex === refIndex ? { ...s, expanded: !s.expanded } : s));
  };

  const replaceSlotImage = (refIndex: number, file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSlots(prev => prev.map(s => s.refIndex === refIndex ? { ...s, refUrl: reader.result as string } : s));
    };
    reader.readAsDataURL(file);
  };

  /** Reverse-analyze reference images one at a time — 1 API call = 1 image = no mapping ambiguity */
  const batchAnalyzeRefPrompts = async () => {
    const visionModel = getVisionModel();
    if (!visionModel) { addToast('warning', '请先启用多模态模型'); return; }
    if (slots.length === 0) return;

    setBatchAnalyzing(true);
    let ok = 0;

    try {
      for (let i = 0; i < slots.length; i++) {
        const refIndex = slots[i].refIndex;
        setStatusMsg(`正在反推 ${i + 1}/${slots.length} 张参考图...`);

        try {
          const prompt = await analyzeSingleDetailRefImage(visionModel, slots[i].refUrl);
          if (prompt) ok++;
          setSlots(prev => prev.map(r => r.refIndex === refIndex && prompt ? { ...r, prompt } : r));
        } catch (e) {
          console.warn(`[DetailGen] 反推 ${i + 1} 失败:`, e);
        }
      }
      addToast('success', `批量反推完成: ${ok}/${slots.length} 张`);
      setStatusMsg(`批量反推完成: ${ok}/${slots.length} 张`);
    } catch (e) {
      addToast('error', `批量反推失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBatchAnalyzing(false);
    }
  };

  const handleGeneratePrompts = async () => {
    const textModel = getTextModel();
    if (!textModel) { addToast('warning', '请先启用 DeepSeek 文本模型'); return; }
    if (!selectedTemplate) { addToast('warning', '请先选择详情模板'); return; }

    setStatusMsg('DeepSeek 生成提示词中...');

    try {
      let lingmaoData: string | undefined;
      if (skuInfo) lingmaoData = buildProductInfoString(skuInfo);

      const updatedSlots = [...slots];
      for (let i = 0; i < slots.length; i++) {
        const invariant = `【详情模板参考图描述】\n${slots[i].prompt}\n【详情图序号：${i + 1}/${slots.length}】`;
        const productInfo = lingmaoData || skuCode || `商品 ${i + 1}`;
        const prompt = await assembleFinalPrompt(textModel, invariant, productInfo, 'assembleDetail');
        updatedSlots[i] = { ...updatedSlots[i], prompt };
        setSlots([...updatedSlots]);
      }
      setStatusMsg(`${slots.length} 个提示词已生成`);
      addToast('success', `已生成 ${slots.length} 个详情提示词`);
    } catch (e) {
      addToast('error', '提示词生成失败: ' + String(e));
    }
  };

  const handleRun = async () => {
    if (slots.length === 0) { addToast('warning', '请先生成提示词'); return; }
    if (!modelImage && !selectedModelId) { addToast('warning', '请选择模特'); return; }
    if (!productImage && !skuInfo?.frontImageBase64) { addToast('warning', '请上传商品白底图或输入款号关联'); return; }

    syncKeyPools();
    abortRef.current = false;
    abortControllerRef.current = new AbortController();
    setIsRunning(true);
    setStatusMsg('加载参考图...');

    try {
      const modelUrl = selectedModel?.previewUrl || modelImage?.previewUrl || '';
      const modelFile = await withTimeout(blobUrlToFile(modelUrl, 'model.jpg'), 15000, 'model');
      const modelB64 = await withTimeout(compressImageForRef(modelFile), 15000, 'compress');

      let productB64 = '';
      if (productImage) {
        const pf = await withTimeout(blobUrlToFile(productImage.previewUrl, productImage.name), 15000, 'product');
        productB64 = await withTimeout(compressImageForRef(pf), 15000, 'compress');
      } else if (skuInfo?.frontImageBase64) {
        productB64 = skuInfo.frontImageBase64;
      }

      const updatedSlots = [...slots];
      let idx = 0;
      const total = slots.length;
      const modelId = defaultModelId;
      setStatusMsg(`详情生成 ${total}张 · 5路并发`);

      const worker = async () => {
        while (true) {
          if (abortRef.current) return;
          const i = idx++;
          if (i >= total) return;
          try {
            const url = await generateTryOnImage({
              prompt: updatedSlots[i].prompt, modelImageBase64: modelB64, productImageBase64: productB64,
              styleRefBase64: updatedSlots[i].refUrl,
              width: 2448, height: 3264, modelId,
              signal: abortControllerRef.current?.signal,
            });
            updatedSlots[i] = { ...updatedSlots[i], url, status: 'done' as const };
          } catch (e) {
            updatedSlots[i] = { ...updatedSlots[i], status: 'failed' as const, error: String(e).slice(0, 80) };
          }
          setSlots([...updatedSlots]);
        }
      };

      await Promise.all(Array.from({ length: Math.min(5, total) }, () => worker()));
      const done = updatedSlots.filter((r) => r.status === 'done').length;
      setStatusMsg(`完成 ${done}/${total}`);

      addTask({
        id: genId(), type: 'detail', skuCode: skuCode || '', productName: skuInfo?.productName || '',
        modelId, provider: getProvider(modelId), prompt: `详情生成 x${total}`,
        params: { slots: total }, status: done >= total ? 'completed' : 'partial',
        progress: Math.round((done / total) * 100), resultUrls: updatedSlots.filter((r) => r.url).map((r) => r.url),
        referenceUrls: [modelUrl].filter(Boolean) as string[],
        error: '', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      });
    } catch (e) {
      addToast('error', '详情生成失败: ' + String(e));
    } finally {
      setIsRunning(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-blue-500 flex items-center justify-center"><LayoutTemplate size={20} className="text-forge-bg" /></div>
          <div><h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">详情页生成</h2><p className="text-xs text-forge-text2">选模特→选模板→逐张可调整→一键生成</p></div>
        </div>
        <div className="flex gap-2">
          {isRunning ? (
            <button onClick={() => { abortRef.current = true; abortControllerRef.current?.abort(); }} className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 bg-forge-red/15 text-forge-red"><StopCircle size={14} />终止</button>
          ) : (
            <>
              {slots.length > 0 && (
                <button onClick={batchAnalyzeRefPrompts} disabled={batchAnalyzing}
                  className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 bg-purple-500/15 text-purple-300 border border-purple-400/30 disabled:opacity-50">
                  {batchAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                  {batchAnalyzing ? '反推中...' : '批量反推'}
                </button>
              )}
              <button onClick={handleGeneratePrompts} disabled={!selectedTemplate} className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 border border-forge-cyan/30 text-forge-cyan hover:bg-forge-cyan/10 disabled:opacity-30"><Zap size={14} />{slots.length > 0 ? `重新生成提示词(${slots.length})` : '一键生成提示词'}</button>
              <button onClick={handleRun} disabled={slots.length === 0} className="orange-btn px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"><Play size={14} />开始生成</button>
            </>
          )}
        </div>
      </div>

      <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="text-xs text-forge-text2 mb-2 block">模特 <Users size={10} className="inline" /></label>
          <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)} className="input-field !py-1.5 text-xs w-full mb-2">
            <option value="">手动上传</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.category === 'tops' ? '上装' : m.category === 'bottoms' ? '下装' : '通用'})</option>)}
          </select>
          {!selectedModelId && (modelImage ? (
            <div className="relative inline-flex"><img src={modelImage.previewUrl} alt="" className="w-12 h-16 object-cover rounded" /><button onClick={() => setModelImage(null)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={8} /></button></div>
          ) : (
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) handleModelUpload(f); }; inp.click(); }} className="text-xs text-forge-cyan hover:underline"><Camera size={12} className="inline mr-1" />上传</button>
          ))}
        </div>
        <div>
          <label className="text-xs text-forge-text2 mb-2 block">款式</label>
          <input value={skuCode} onChange={(e) => setSkuCode(e.target.value)} placeholder="输入款号自动关联" className="input-field !py-1.5 text-xs w-full" />
          {skuInfo && <p className="text-[10px] text-forge-green mt-1">已关联: {skuInfo.productName}</p>}
        </div>
        <div>
          <label className="text-xs text-forge-text2 mb-2 block">白底图</label>
          {productImage ? (
            <div className="relative inline-flex"><img src={productImage.previewUrl} alt="" className="w-12 h-16 object-cover rounded" /><button onClick={() => setProductImage(null)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={8} /></button></div>
          ) : (
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) handleProductUpload(f); }; inp.click(); }} className="text-xs text-forge-cyan hover:underline"><Upload size={12} className="inline mr-1" />上传</button>
          )}
          {skuInfo?.frontImageBase64 && <p className="text-[10px] text-forge-green mt-1">已有款式白底图</p>}
        </div>
        <div>
          <label className="text-xs text-forge-text2 mb-2 block">详情模板 <BookTemplate size={10} className="inline" /></label>
          <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} className="input-field !py-1.5 text-xs w-full">
            <option value="">选择</option>
            {detailTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.refImages.length}图</option>)}
          </select>
        </div>
      </div>

      {statusMsg && (
        <div className="glass-card p-3 border border-forge-cyan/30">
          <div className="flex items-center gap-2 text-xs text-forge-cyan">{isRunning ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}{statusMsg}</div>
        </div>
      )}

      {/* Per-slot editing cards */}
      {slots.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {slots.map((slot) => (
            <div key={slot.refIndex} className={`glass-card overflow-hidden ${slot.status === 'done' ? 'border-forge-green/20' : slot.status === 'failed' ? 'border-forge-red/20' : 'border-forge-border/20'}`}>
              <div className="aspect-square bg-forge-surface2/50 flex items-center justify-center relative">
                {slot.url ? <img src={slot.url} alt="" className="w-full h-full object-cover" loading="lazy" /> : slot.refUrl ? (
                  <>
                    <img src={slot.refUrl} alt="" className="w-full h-full object-cover opacity-60" loading="lazy" />
                    <button onClick={() => {
                      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
                      inp.onchange = () => { const f = inp.files?.[0]; if (f) replaceSlotImage(slot.refIndex, f); };
                      inp.click();
                    }} className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
                      <span className="text-xs text-white bg-forge-cyan/70 px-2 py-1 rounded">更换参考图</span>
                    </button>
                  </>
                ) : slot.status === 'failed' ? <AlertTriangle size={24} className="text-forge-red/40" /> : <span className="text-[10px] text-forge-text2/40">待生成</span>}
              </div>
              <div className="p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-forge-text2/50 font-medium">详情#{slot.refIndex + 1}</span>
                  <div className="flex items-center gap-1">
                    {slot.status === 'done' ? <CheckCircle2 size={10} className="text-forge-green" /> : slot.status === 'failed' ? <AlertTriangle size={10} className="text-forge-red" /> : <span className="text-[9px] text-forge-cyan">等待</span>}
                    {slot.prompt.length > 50 && (
                      <button onClick={() => toggleSlotExpand(slot.refIndex)} className="text-[8px] text-forge-cyan hover:text-forge-cyan/70">
                        {slot.expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  value={slot.prompt}
                  onChange={(e) => updateSlotPrompt(slot.refIndex, e.target.value)}
                  className={`textarea-field !py-1 text-[10px] w-full ${slot.expanded || slot.prompt.length <= 50 ? '!min-h-[50px]' : '!min-h-[40px]'}`}
                  placeholder="详情提示词..."
                  disabled={isRunning}
                  rows={slot.expanded ? 8 : 3}
                />
                {slot.error && <p className="text-[8px] text-forge-red truncate">{slot.error.slice(0, 50)}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
