import { useState, useCallback, useRef } from 'react';
import {
  LayoutTemplate, ImagePlus, Download, Play, Sparkles, Upload, X,
  Loader2, Camera, CheckCircle2, Package, Layers, Trash2,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useTryOnStore } from '@/store/useTryOnStore';
import type { ReferenceImage } from '@/types/tryon-types';
import { compressImageForRef, blobUrlToFile, compressImageForLLM } from '@/utils/image';
import { UploadBlock } from '@/components/studio/UploadBlock';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const DETAIL_MODULES = [
  { id: 'hero', label: '首屏承接', desc: '完整模特上身效果，展示服装整体廓形', icon: 'Camera' },
  { id: 'fabric', label: '材质特写', desc: '微距展示面料纹理、缝线、纽扣等细节', icon: 'Layers' },
  { id: 'fit', label: '版型展示', desc: '正面/侧面/背面三角度拼接', icon: 'LayoutTemplate' },
  { id: 'detail', label: '细节卖点', desc: '局部特写+功能标签，左图右文', icon: 'ImagePlus' },
  { id: 'color', label: '颜色尺码', desc: '颜色并列+尺码参考信息图', icon: 'Package' },
  { id: 'styling', label: '搭配推荐', desc: '完整搭配造型，含配饰鞋履', icon: 'Sparkles' },
];

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

export function CanvasPage() {
  const addToast = useAppStore((s) => s.addToast);
  const productFrontImage = useTryOnStore((s) => s.productFrontImage);
  const setProductFrontImage = useTryOnStore((s) => s.setProductFrontImage);
  const modelImage = useTryOnStore((s) => s.modelImage);
  const setModelImage = useTryOnStore((s) => s.setModelImage);

  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set(DETAIL_MODULES.map(m => m.id)));
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingModule, setGeneratingModule] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { url?: string; status: 'done' | 'failed'; error?: string }>>({});
  const abortRef = useRef(false);

  const toggleModule = (id: string) => {
    setSelectedModules(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleGenerateAll = async () => {
    if (!productFrontImage) { addToast('warning', '请先上传商品白底图'); return; }
    if (!modelImage) { addToast('warning', '请上传模特参考图（可选但推荐）'); }
    if (selectedModules.size === 0) { addToast('warning', '请至少选择一个模块'); return; }

    abortRef.current = false;
    setIsGenerating(true);
    setResults({});
    let ok = 0;
    let fail = 0;

    // Kimi analysis
    addToast('info', 'Kimi 分析中...');
    let invariant = '';
    let garment = '';
    try {
      const modelFile = modelImage ? await blobUrlToFile(modelImage.previewUrl, modelImage.name) : null;
      const modelB64 = modelFile ? await compressImageForLLM(modelFile) : '';
      const productFile = await blobUrlToFile(productFrontImage.previewUrl, productFrontImage.name);
      const productB64_llm = await compressImageForLLM(productFile);

      const { analyzeBothImages, analyzeModelImage } = await import('@/services/llmService');
      const { useLlmStore } = await import('@/store/useLlmStore');
      const visionModel = useLlmStore.getState().getVisionModel();
      if (!visionModel) { addToast('error', '请先配置 Kimi 多模态模型'); setIsGenerating(false); return; }

      if (modelB64) {
        const result = await analyzeBothImages(visionModel, modelB64, productB64_llm);
        const parts = result.invariant ? ['', ''] : [result, ''];
        invariant = result.invariant || '';
        garment = result.garmentDetails || '';
      } else {
        invariant = await analyzeModelImage(visionModel, productB64_llm);
      }
    } catch (e) {
      addToast('warning', 'Kimi 分析失败，使用通用模板');
    }

    // Generate each module
    const modules = DETAIL_MODULES.filter(m => selectedModules.has(m.id));
    const total = modules.length;
    addToast('info', `开始生成 ${total} 个详情模块...`);

    for (const mod of modules) {
      if (abortRef.current) break;
      setGeneratingModule(mod.id);

      // DeepSeek prompt
      let prompt = '';
      try {
        const { assembleFinalPrompt } = await import('@/services/llmService');
        const { useLlmStore } = await import('@/store/useLlmStore');
        const textModel = useLlmStore.getState().getTextModel();
        if (textModel) {
          const extra =
            mod.id === 'hero' ? '完整模特上身效果，展示服装整体廓形。简约干净背景，专业摄影棚光，正面全貌。' :
            mod.id === 'fabric' ? '微距特写面料纹理和缝线细节。浅灰背景，极致简约，突出材质本身。' :
            mod.id === 'fit' ? '正面/侧面/背面三角度拼接，展现廓形线条。干净留白，专业lookbook风格。' :
            mod.id === 'detail' ? '左图右文布局，产品局部特写配合功能标签。极简排版，克制用色。' :
            mod.id === 'color' ? '颜色并列展示，尺码参考信息图。干净网格布局，品牌色点缀。' :
            '完整搭配造型含配饰鞋履。简约高级街拍质感。';
          prompt = await assembleFinalPrompt(textModel, invariant || '模特', `${garment || '时尚服装'}\n\n模块：${mod.label}。${extra}`);
        }
      } catch { prompt = `${mod.label} - ${mod.desc}`; }

      // Generate image
      try {
        const { generateTryOnImage } = await import('@/services/tryonApi');
        const productFile = await blobUrlToFile(productFrontImage.previewUrl, productFrontImage.name);
        const productB64 = await compressImageForRef(productFile);
        let modelB64: string | undefined;
        if (modelImage) {
          const mf = await blobUrlToFile(modelImage.previewUrl, modelImage.name);
          modelB64 = await compressImageForRef(mf);
        }
        const url = await generateTryOnImage({
          prompt: prompt || `${mod.label} - professional fashion photography`, productImageBase64: productB64,
          modelImageBase64: modelB64, width: 2448, height: 3264, modelId: 'gpt-image-2-vip', skipCooldown: true,
        });
        setResults(prev => ({ ...prev, [mod.id]: { url, status: 'done' } }));
        ok++;
      } catch (e) {
        setResults(prev => ({ ...prev, [mod.id]: { status: 'failed', error: e instanceof Error ? e.message : '未知' } }));
        fail++;
      }
    }

    setGeneratingModule(null);
    setIsGenerating(false);
    addToast('success', `详情页完成: ${ok} 成功${fail > 0 ? ` / ${fail} 失败` : ''}`);
  };

  const doneCount = Object.values(results).filter(r => r.status === 'done' && r.url).length;

  return (
    <div className="max-w-5xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-orange to-orange-500 flex items-center justify-center">
            <LayoutTemplate size={20} className="text-white" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">详情页生成</h2>
            <p className="text-xs text-forge-text2">上传商品图 → 勾选模块 → 一键生成全套详情图</p>
          </div>
        </div>
      </div>

      {/* Upload area */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UploadBlock label="商品白底图（必选）" icon={Upload} img={productFrontImage}
          onUp={setProductFrontImage} onRm={() => setProductFrontImage(null)} maxSize={MAX_FILE_SIZE} />
        <UploadBlock label="模特参考图（推荐）" icon={Camera} img={modelImage}
          onUp={setModelImage} onRm={() => setModelImage(null)} maxSize={MAX_FILE_SIZE} />
      </div>

      {/* Module selection */}
      <div className="glass-card p-4">
        <h3 className="text-xs text-forge-text2 mb-3 flex items-center gap-2">
          <CheckCircle2 size={14} />选择详情模块（{selectedModules.size}/{DETAIL_MODULES.length}）
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {DETAIL_MODULES.map(mod => {
            const selected = selectedModules.has(mod.id);
            const result = results[mod.id];
            return (
              <button key={mod.id}
                onClick={() => !isGenerating && toggleModule(mod.id)}
                disabled={isGenerating}
                className={`p-3 rounded-lg text-left transition-all border ${
                  selected ? 'bg-forge-cyan/10 border-forge-cyan/40' : 'bg-forge-surface2/30 border-forge-border/30'
                } ${result?.status === 'done' ? 'border-forge-green/50' : ''} ${result?.status === 'failed' ? 'border-forge-red/50' : ''}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-forge-text">{mod.label}</span>
                  {generatingModule === mod.id && <Loader2 size={12} className="animate-spin text-forge-cyan" />}
                  {result?.status === 'done' && <CheckCircle2 size={12} className="text-forge-green" />}
                </div>
                <p className="text-[10px] text-forge-text2/60">{mod.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Results grid */}
      {doneCount > 0 && (
        <div className="glass-card p-4">
          <h3 className="text-xs text-forge-text2 mb-3">生成结果（{doneCount} 个模块）</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {DETAIL_MODULES.map(mod => {
              const result = results[mod.id];
              if (!result || result.status !== 'done') return null;
              return (
                <div key={mod.id} className="glass-card p-2 group">
                  {result.url && <img src={result.url} alt={mod.label} className="w-full aspect-[3/4] object-cover rounded-lg mb-1.5" />}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-forge-text2">{mod.label}</span>
                    {result.url && <button onClick={() => window.open(result.url, '_blank')}
                      className="text-forge-text2/30 hover:text-forge-cyan"><Download size={12} /></button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action button */}
      <button onClick={handleGenerateAll} disabled={isGenerating || !productFrontImage}
        className="orange-btn w-full px-6 py-4 rounded-lg text-base flex items-center justify-center gap-2 disabled:opacity-50">
        {isGenerating ? <><Loader2 size={18} className="animate-spin" />生成中...</> :
         <><Sparkles size={18} />一键生成 {selectedModules.size} 个详情模块</>}
      </button>
      {isGenerating && (
        <button onClick={() => { abortRef.current = true; addToast('info', '已取消'); }}
          className="w-full py-2 text-xs text-forge-text2/60 hover:text-forge-red">取消生成</button>
      )}
    </div>
  );
}
