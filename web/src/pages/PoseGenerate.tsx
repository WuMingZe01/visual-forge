import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shirt, Play, Upload, X, Loader2, Camera, CheckCircle2, AlertTriangle, Download, StopCircle, Users, BookTemplate } from 'lucide-react';
import { useModelStore } from '@/store/useModelStore';
import { useTemplateStore } from '@/store/useTemplateStore';
import { useLlmStore } from '@/store/useLlmStore';
import { useAppStore } from '@/store/useAppStore';
import type { ReferenceImage } from '@/types/tryon-types';
import { generateTryOnImage, getProvider } from '@/services/tryonApi';
import { availableKeyCount, syncKeyPools } from '@/services/keyPool';
import { analyzeModelImage, assembleFinalPrompt } from '@/services/llmService';
import { buildProductInfoString } from '@/hooks/useAIPrompt';
import { compressImageForLLM, compressImageForRef, blobUrlToFile, withTimeout } from '@/utils/image';
import { queryStyleByCode } from '@/services/lingmao';

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

interface PoseResult { refIndex: number; url: string; status: 'done' | 'failed'; error?: string; }

export function PoseGenerate() {
  const navigate = useNavigate();
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
  const [results, setResults] = useState<PoseResult[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const abortRef = useRef(false);

  const poseTemplates = templates.filter((t) => t.type === 'pose');
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

  const handleRun = async () => {
    const visionModel = getVisionModel();
    const textModel = getTextModel();
    if (!visionModel || !textModel) { addToast('warning', '请先在系统设置中启用 LLM 模型'); return; }
    if (!modelImage && !selectedModelId) { addToast('warning', '请选择或上传模特图'); return; }
    if (!productImage) { addToast('warning', '请上传商品白底图'); return; }
    if (!selectedTemplate || selectedTemplate.refImages.length === 0) { addToast('warning', '请选择包含参考图的姿势模板'); return; }

    syncKeyPools();
    abortRef.current = false;
    setIsRunning(true);
    setResults([]);
    setStatusMsg('Kimi 分析模特图...');

    try {
      // 1. 加载模特图
      const modelUrl = selectedModel?.previewUrl || modelImage?.previewUrl || '';
      const modelFile = await withTimeout(blobUrlToFile(modelUrl, 'model.jpg'), 15000, 'modelFile');
      const modelB64 = await withTimeout(compressImageForRef(modelFile), 15000, 'modelCompress');
      const modelLLM = await withTimeout(compressImageForLLM(modelFile), 15000, 'modelLLM');

      // 2. Kimi 分析
      const invariant = await withTimeout(analyzeModelImage(visionModel, modelLLM), 90000, 'modelAnalysis');

      // 3. 加载白底图
      const pf = await withTimeout(blobUrlToFile(productImage.previewUrl, productImage.name), 15000, 'productFile');
      const productB64 = await withTimeout(compressImageForRef(pf), 15000, 'productCompress');

      // 4. 查询领猫
      let lingmaoData: string | undefined;
      if (skuCode.trim()) {
        try {
          const result = await queryStyleByCode([skuCode.trim()]);
          if (result.skuInfo) lingmaoData = buildProductInfoString(result.skuInfo);
        } catch { }
      }

      // 5. 为每个参考图生成prompt
      const refPaths = selectedTemplate.refImages;
      setStatusMsg(`生成 ${refPaths.length} 个姿势prompt...`);
      const prompts: string[] = [];

      for (const _refPath of refPaths) {
        if (abortRef.current) return;
        const merged = `【模特不变特征】\n${invariant}\n【商品信息】\n${lingmaoData || skuCode || ''}\n【模板提示词】\n${selectedTemplate.promptTemplate}`;
        const prompt = await assembleFinalPrompt(textModel, invariant, merged);
        prompts.push(prompt);
      }

      // 6. 生成图片
      setStatusMsg(`${refPaths.length}张姿势裂变 · 5路并发`);
      const newResults: PoseResult[] = [];
      let idx = 0;

      const worker = async () => {
        while (true) {
          if (abortRef.current) return;
          const i = idx++;
          if (i >= refPaths.length) return;
          try {
            const url = await generateTryOnImage({
              prompt: prompts[i], modelImageBase64: modelB64, productImageBase64: productB64,
              width: 2448, height: 3264, modelId: 'gpt-image-2-all',
            });
            newResults.push({ refIndex: i, url, status: 'done' });
          } catch (e) {
            newResults.push({ refIndex: i, url: '', status: 'failed', error: String(e).slice(0, 100) });
          }
          setResults([...newResults].sort((a, b) => a.refIndex - b.refIndex));
        }
      };

      await Promise.all(Array.from({ length: Math.min(5, refPaths.length) }, () => worker()));
      setStatusMsg(`完成 ${newResults.filter((r) => r.status === 'done').length}/${refPaths.length}`);

    } catch (e) {
      addToast('error', '姿势裂变失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center"><Shirt size={20} className="text-forge-bg" /></div>
          <div><h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">姿势裂变</h2><p className="text-xs text-forge-text2">1:1参考图对应 · 模特一致性</p></div>
        </div>
        {isRunning ? (
          <button onClick={() => { abortRef.current = true; }} className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 bg-forge-red/15 text-forge-red"><StopCircle size={14} />终止</button>
        ) : (
          <button onClick={handleRun} className="orange-btn px-4 py-2 rounded-lg text-sm flex items-center gap-2"><Play size={14} />开始生成</button>
        )}
      </div>

      {/* Config */}
      <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Model Selector */}
        <div>
          <label className="text-xs text-forge-text2 mb-2 block">模特参考图</label>
          <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)} className="input-field !py-1.5 text-xs w-full mb-2">
            <option value="">手动上传</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {!selectedModelId && (
            modelImage ? (
              <div className="relative inline-flex"><img src={modelImage.previewUrl} alt="" className="w-16 h-20 object-cover rounded" /><button onClick={() => setModelImage(null)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={8} /></button></div>
            ) : (
              <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) handleModelUpload(f); }; inp.click(); }} className="text-xs text-forge-cyan hover:underline"><Camera size={12} className="inline mr-1" />上传</button>
            )
          )}
        </div>

        {/* Product Upload */}
        <div>
          <label className="text-xs text-forge-text2 mb-2 block">商品白底图</label>
          {productImage ? (
            <div className="relative inline-flex"><img src={productImage.previewUrl} alt="" className="w-16 h-20 object-cover rounded" /><button onClick={() => setProductImage(null)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-forge-red/80 text-white flex items-center justify-center"><X size={8} /></button></div>
          ) : (
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) handleProductUpload(f); }; inp.click(); }} className="text-xs text-forge-cyan hover:underline"><Upload size={12} className="inline mr-1" />上传白底图</button>
          )}
          <input value={skuCode} onChange={(e) => setSkuCode(e.target.value)} placeholder="款号（可选）" className="input-field !py-1 text-xs w-full mt-2" />
        </div>

        {/* Template Selector */}
        <div>
          <label className="text-xs text-forge-text2 mb-2 block">姿势模板 <BookTemplate size={10} className="inline" /></label>
          <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} className="input-field !py-1.5 text-xs w-full">
            <option value="">选择模板</option>
            {poseTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.refImages.length}参考图</option>)}
          </select>
          {selectedTemplate && <p className="text-[10px] text-forge-text2/60 mt-1">{selectedTemplate.refImages.length} 张参考图将一一对应生成</p>}
        </div>
      </div>

      {/* Progress */}
      {statusMsg && (
        <div className="glass-card p-3 border border-forge-cyan/30">
          <div className="flex items-center gap-2 text-xs text-forge-cyan">
            {isRunning ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            {statusMsg}
          </div>
        </div>
      )}

      {/* Results Grid */}
      {results.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {results.map((r) => (
            <div key={r.refIndex} className={`glass-card overflow-hidden ${r.status === 'done' ? 'border-forge-green/20' : 'border-forge-red/20'}`}>
              <div className="aspect-[3/4] bg-forge-surface2/50 flex items-center justify-center">
                {r.url ? <img src={r.url} alt="" className="w-full h-full object-cover" loading="lazy" /> : <Loader2 size={20} className="animate-spin text-forge-cyan" />}
              </div>
              <div className="p-2 text-center">
                <span className="text-[10px] text-forge-text2">姿势#{r.refIndex + 1}</span>
                {r.status === 'done' ? <CheckCircle2 size={10} className="text-forge-green mx-auto mt-0.5" /> : <AlertTriangle size={10} className="text-forge-red mx-auto mt-0.5" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
