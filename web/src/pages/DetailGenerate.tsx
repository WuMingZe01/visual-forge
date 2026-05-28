import { useState, useRef } from 'react';
import { LayoutTemplate, Play, Upload, X, Loader2, Camera, CheckCircle2, AlertTriangle, Download, StopCircle, Users, BookTemplate, Zap } from 'lucide-react';
import { useModelStore } from '@/store/useModelStore';
import { useTemplateStore } from '@/store/useTemplateStore';
import { useLlmStore } from '@/store/useLlmStore';
import { useAppStore } from '@/store/useAppStore';
import type { ReferenceImage } from '@/types/tryon-types';
import { generateTryOnImage } from '@/services/tryonApi';
import { syncKeyPools } from '@/services/keyPool';
import { analyzeModelImage, assembleFinalPrompt } from '@/services/llmService';
import { buildProductInfoString } from '@/hooks/useAIPrompt';
import { compressImageForLLM, compressImageForRef, blobUrlToFile, withTimeout } from '@/utils/image';
import { queryStyleByCode } from '@/services/lingmao';

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

interface DetailResult { refIndex: number; prompt: string; url: string; status: 'idle' | 'done' | 'failed'; error?: string; }

export function DetailGenerate() {
  const models = useModelStore((s) => s.models);
  const templates = useTemplateStore((s) => s.templates);
  const getVisionModel = useLlmStore((s) => s.getVisionModel);
  const getTextModel = useLlmStore((s) => s.getTextModel);
  const addToast = useAppStore((s) => s.addToast);

  const [modelImage, setModelImage] = useState<ReferenceImage | null>(null);
  const [productImage, setProductImage] = useState<ReferenceImage | null>(null);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [skuCode, setSkuCode] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<DetailResult[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const abortRef = useRef(false);

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

  const handleGeneratePrompts = async () => {
    const textModel = getTextModel();
    if (!textModel) { addToast('warning', '请先启用 DeepSeek 文本模型'); return; }
    if (!selectedTemplate) { addToast('warning', '请先选择详情模板'); return; }

    setStatusMsg('DeepSeek 生成提示词中...');

    try {
      // 查询领猫
      let lingmaoData: string | undefined;
      if (skuCode.trim()) {
        try { const r = await queryStyleByCode([skuCode.trim()]); if (r.skuInfo) lingmaoData = buildProductInfoString(r.skuInfo); } catch { }
      }

      const refCount = selectedTemplate.refImages.length;
      const newResults: DetailResult[] = [];
      for (let i = 0; i < refCount; i++) {
        const merged = `【模板提示词】\n${selectedTemplate.promptTemplate}\n【领猫商品资料】\n${lingmaoData || skuCode || ''}\n【详情图序号：${i + 1}/${refCount}】`;
        const prompt = await assembleFinalPrompt(textModel, merged, `参考图#${i + 1}`);
        newResults.push({ refIndex: i, prompt, url: '', status: 'idle' });
      }
      setResults(newResults);
      setStatusMsg(`${refCount} 个提示词已生成`);
      addToast('success', `已生成 ${refCount} 个详情提示词`);
    } catch (e) {
      addToast('error', '提示词生成失败: ' + String(e));
    }
  };

  const handleRun = async () => {
    if (results.length === 0) { addToast('warning', '请先生成提示词'); return; }
    if (!modelImage && !selectedModelId) { addToast('warning', '请选择模特'); return; }
    if (!productImage) { addToast('warning', '请上传商品白底图'); return; }
    const visionModel = getVisionModel();
    if (!visionModel) { addToast('warning', '请启用 Kimi 模型'); return; }

    syncKeyPools();
    abortRef.current = false;
    setIsRunning(true);
    setStatusMsg('加载参考图...');

    try {
      const modelUrl = selectedModel?.previewUrl || modelImage?.previewUrl || '';
      const modelFile = await withTimeout(blobUrlToFile(modelUrl, 'model.jpg'), 15000, 'model');
      const modelB64 = await withTimeout(compressImageForRef(modelFile), 15000, 'compress');
      const pf = await withTimeout(blobUrlToFile(productImage.previewUrl, productImage.name), 15000, 'product');
      const productB64 = await withTimeout(compressImageForRef(pf), 15000, 'compress');

      let idx = 0;
      const total = results.length;
      setStatusMsg(`详情生成 ${total}张 · 5路并发`);

      const worker = async () => {
        while (true) {
          if (abortRef.current) return;
          const i = idx++;
          if (i >= total) return;
          try {
            const url = await generateTryOnImage({
              prompt: results[i].prompt, modelImageBase64: modelB64, productImageBase64: productB64,
              width: 2448, height: 3264, modelId: 'gpt-image-2-all',
            });
            setResults((prev) => prev.map((r, j) => j === i ? { ...r, url, status: 'done' as const } : r));
          } catch (e) {
            setResults((prev) => prev.map((r, j) => j === i ? { ...r, status: 'failed' as const, error: String(e).slice(0, 80) } : r));
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(5, total) }, () => worker()));
      const done = results.filter((r) => r.status === 'done').length;
      setStatusMsg(`完成 ${done}/${total}`);
    } catch (e) {
      addToast('error', '详情生成失败: ' + String(e));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-blue-500 flex items-center justify-center"><LayoutTemplate size={20} className="text-forge-bg" /></div>
          <div><h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">详情页生成</h2><p className="text-xs text-forge-text2">模板驱动 · 领猫适配 · 一键生成</p></div>
        </div>
        <div className="flex gap-2">
          {isRunning ? (
            <button onClick={() => { abortRef.current = true; }} className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 bg-forge-red/15 text-forge-red"><StopCircle size={14} />终止</button>
          ) : (
            <>
              <button onClick={handleGeneratePrompts} disabled={!selectedTemplate} className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 border border-forge-cyan/30 text-forge-cyan hover:bg-forge-cyan/10 disabled:opacity-30"><Zap size={14} />{results.length > 0 ? `重新生成提示词(${results.length})` : '一键生成提示词'}</button>
              <button onClick={handleRun} disabled={results.length === 0} className="orange-btn px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"><Play size={14} />开始生成</button>
            </>
          )}
        </div>
      </div>

      {/* Config Row */}
      <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="text-xs text-forge-text2 mb-2 block">模特 <Users size={10} className="inline" /></label>
          <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)} className="input-field !py-1.5 text-xs w-full mb-2">
            <option value="">手动上传</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {!selectedModelId && (modelImage ? (
            <div className="relative inline-flex"><img src={modelImage.previewUrl} alt="" className="w-12 h-16 object-cover rounded" /><button onClick={() => setModelImage(null)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={8} /></button></div>
          ) : (
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) handleModelUpload(f); }; inp.click(); }} className="text-xs text-forge-cyan hover:underline"><Camera size={12} className="inline mr-1" />上传</button>
          ))}
        </div>
        <div>
          <label className="text-xs text-forge-text2 mb-2 block">白底图</label>
          {productImage ? (
            <div className="relative inline-flex"><img src={productImage.previewUrl} alt="" className="w-12 h-16 object-cover rounded" /><button onClick={() => setProductImage(null)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={8} /></button></div>
          ) : (
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) handleProductUpload(f); }; inp.click(); }} className="text-xs text-forge-cyan hover:underline"><Upload size={12} className="inline mr-1" />上传</button>
          )}
        </div>
        <div>
          <label className="text-xs text-forge-text2 mb-2 block">款式</label>
          <input value={skuCode} onChange={(e) => setSkuCode(e.target.value)} placeholder="款号" className="input-field !py-1.5 text-xs w-full" />
        </div>
        <div>
          <label className="text-xs text-forge-text2 mb-2 block">详情模板 <BookTemplate size={10} className="inline" /></label>
          <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} className="input-field !py-1.5 text-xs w-full">
            <option value="">选择</option>
            {detailTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.refImages.length}图</option>)}
          </select>
        </div>
      </div>

      {/* Status */}
      {statusMsg && (
        <div className="glass-card p-3 border border-forge-cyan/30">
          <div className="flex items-center gap-2 text-xs text-forge-cyan">{isRunning ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}{statusMsg}</div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {results.map((r) => (
            <div key={r.refIndex} className={`glass-card overflow-hidden ${r.status === 'done' ? 'border-forge-green/20' : r.status === 'failed' ? 'border-forge-red/20' : 'border-forge-border/20'}`}>
              <div className="aspect-square bg-forge-surface2/50 flex items-center justify-center">
                {r.url ? <img src={r.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  : r.status === 'idle' ? <span className="text-[10px] text-forge-text2/40">待生成</span>
                    : r.status === 'failed' ? <AlertTriangle size={24} className="text-forge-red/40" />
                      : <Loader2 size={24} className="animate-spin text-forge-cyan" />}
              </div>
              <div className="p-2">
                <p className="text-[10px] text-forge-text2 truncate">{r.prompt.slice(0, 40)}...</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] text-forge-text2/50">#{r.refIndex + 1}</span>
                  {r.status === 'done' ? <CheckCircle2 size={10} className="text-forge-green" />
                    : r.status === 'failed' ? <AlertTriangle size={10} className="text-forge-red" />
                      : <span className="text-[9px] text-forge-cyan">等待</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
