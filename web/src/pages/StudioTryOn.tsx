import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shirt,
  Sparkles,
  Upload,
  X,
  Loader2,
  Plus,
  Minus,
  Pencil,
  Package,
  Camera,
  Info,
  History,
  FileText,
  ArrowRight,
  Trash2,
  Layers,
  Play,
  Search,
  Wand2,
  ChevronDown,
  ZoomIn,
  Download,
} from 'lucide-react';
import { useTryOnStore } from '@/store/useTryOnStore';
import { useTaskHistoryStore } from '@/store/useTaskHistoryStore';
import { useAppStore } from '@/store/useAppStore';
import type { ReferenceImage, TryOnResult, SKUInfo } from '@/types/tryon-types';
import {
  AI_MODELS_FOR_TRYON,
  RESOLUTION_PRESETS,
  POSE_VARIATIONS,
} from '@/types/tryon-types';
import { generateTryOnImage, getStoredModelConfig, isModelEnabled } from '@/services/tryonApi';
import { useAIPrompt } from '@/hooks/useAIPrompt';
import { useLocalLibrary } from '@/hooks/useLocalLibrary';
import { compressImageToBase64, compressImageForRef, blobUrlToFile } from '@/utils/image';
import { StyleDropdown } from '@/components/studio/StyleDropdown';
import { UploadBlock } from '@/components/studio/UploadBlock';
import { Chip, LLMSteps } from '@/components/studio/Common';
import { ImageCompareModal, type CompareImage } from '@/components/ImageCompareModal';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

interface TemplateSlot {
  id: string;
  label: string;
  image: ReferenceImage | null;
  prompt: string;
}

export function StudioTryOn() {
  const navigate = useNavigate();
  const { library, searchStyles } = useLocalLibrary();
  const { isGenerating: aiGenerating, steps: aiSteps, generatePrompt, reset: resetAI } = useAIPrompt();

  // Store state
  const skuInfo = useTryOnStore((s) => s.skuInfo);
  const modelImage = useTryOnStore((s) => s.modelImage);
  const productFrontImage = useTryOnStore((s) => s.productFrontImage);
  const productBackImage = useTryOnStore((s) => s.productBackImage);
  const tryOnParams = useTryOnStore((s) => s.tryOnParams);
  const tryOnResults = useTryOnStore((s) => s.tryOnResults);
  const isGenerating = useTryOnStore((s) => s.isGenerating);
  const setSkuInfo = useTryOnStore((s) => s.setSkuInfo);
  const setModelImage = useTryOnStore((s) => s.setModelImage);
  const setProductFrontImage = useTryOnStore((s) => s.setProductFrontImage);
  const setProductBackImage = useTryOnStore((s) => s.setProductBackImage);
  const setTryOnParams = useTryOnStore((s) => s.setTryOnParams);
  const setTryOnResults = useTryOnStore((s) => s.setTryOnResults);
  const setIsGenerating = useTryOnStore((s) => s.setIsGenerating);

  // Task history
  const addTask = useTaskHistoryStore((s) => s.addTask);
  const updateTask = useTaskHistoryStore((s) => s.updateTask);
  const addToast = useAppStore((s) => s.addToast);

  // 每次进入页面清理旧状态，但恢复上次参数
  useEffect(() => {
    setSkuInfo(null);
    setModelImage(null);
    setProductFrontImage(null);
    setProductBackImage(null);
    setTryOnResults([]);
    resetAI();
    autoTriggeredRef.current = '';
    selectedByUser.current = false;
    // 恢复上次使用的参数
    try {
      const saved = localStorage.getItem('vf-last-params');
      if (saved) {
        const p = JSON.parse(saved);
        setTryOnParams({ model: p.model || 'gpt-image-2-vip', resolutionRatio: p.resolutionRatio || '2448×3264 (3:4, 4K)', chinesePrompt: '', count: p.count || 1 });
      }
    } catch {}
  }, []);

  const abortRef = useRef(false);

  // 自动保存参数偏好
  useEffect(() => {
    try { localStorage.setItem('vf-last-params', JSON.stringify({ model: tryOnParams.model, resolutionRatio: tryOnParams.resolutionRatio, count: tryOnParams.count })); } catch {}
  }, [tryOnParams.model, tryOnParams.resolutionRatio, tryOnParams.count]);

  // Local state
  const [generatingIndex, setGeneratingIndex] = useState(-1);
  const [showCustomModel, setShowCustomModel] = useState(false);
  const [customModelId, setCustomModelId] = useState('');
  const [mode, setMode] = useState<'single' | 'template'>('single');
  const [styleSearch, setStyleSearch] = useState('');
  const [styleDropdownOpen, setStyleDropdownOpen] = useState(false);
  const styleInputRef = useRef<HTMLDivElement>(null);

  // Image compare modal
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareImages, setCompareImages] = useState<CompareImage[]>([]);
  const [compareIndex, setCompareIndex] = useState(0);

  // Template slots for pose裂变
  const [templateSlots, setTemplateSlots] = useState<TemplateSlot[]>(() => [
    { id: genId(), label: '正面站姿', image: null, prompt: '正面自然站立，双手垂放，面向镜头' },
    { id: genId(), label: '侧面展示', image: null, prompt: '侧身45度展示轮廓线条，单手优雅摆放' },
    { id: genId(), label: '坐姿/半身', image: null, prompt: '优雅坐姿，身体微倾，自然光线' },
  ]);
  const [templateConfig, setTemplateConfig] = useState({
    countPerSlot: 1,
    model: 'gpt-image-2',
    resolutionRatio: '3264×2448 (4:3, 4K)',
  });

  // Computed
  const filteredStyles = useMemo(() => searchStyles(styleSearch), [styleSearch, searchStyles]);
  const selectedPreset = RESOLUTION_PRESETS.find(
    (p) => p.label === (mode === 'template' ? templateConfig.resolutionRatio : tryOnParams.resolutionRatio)
  );
  const modelConfig = getStoredModelConfig();
  const allModels = [
    ...AI_MODELS_FOR_TRYON.filter((m) => isModelEnabled(m.id)),
    ...(modelConfig.customModels || []).map((m) => ({ id: m.id, name: m.name, desc: '自定义' })),
    { id: 'custom', name: '✏️ 自定义 ID', desc: '输入模型ID' },
  ];

  // API Prompt (English) — 避免 "try-on" 等可能触发平台内容审核的词
  const apiPrompt = useMemo(() => {
    const parts: string[] = [];
    parts.push(
      'Fashion e-commerce product showcase: the product garment shown on a model, ' +
        'matching the reference photo in pose, face, lighting, background, composition and overall style. ' +
        'The garment should be worn naturally by the model, replacing only the clothing item.'
    );
    if (skuInfo) {
      const infoLines: string[] = [];
      if (skuInfo.composition) infoLines.push(`Fabric: ${skuInfo.composition}`);
      if (skuInfo.fabricIntro) infoLines.push(`Details: ${skuInfo.fabricIntro.slice(0, 100)}`);
      if (skuInfo.profileIntro) infoLines.push(`Fit: ${skuInfo.profileIntro}`);
      if (skuInfo.collarType) infoLines.push(`Collar: ${skuInfo.collarType}`);
      if (skuInfo.shoulderType) infoLines.push(`Shoulder: ${skuInfo.shoulderType}`);
      if (skuInfo.saleInfo) infoLines.push(`Highlights: ${skuInfo.saleInfo.slice(0, 100)}`);
      if (infoLines.length > 0) parts.push('Product — ' + infoLines.join('; '));
    }
    parts.push(
      'Professional e-commerce fashion photography, soft diffused studio lighting 5500K, clean seamless white background, 8K quality, sharp details'
    );
    return parts.join('\n\n');
  }, [skuInfo]);

  // Handlers
  const selectedByUser = useRef(false);
  const handleSelectSku = useCallback(
    (info: SKUInfo | null) => {
      setSkuInfo(info);
      setTryOnParams({ chinesePrompt: '' });
      setStyleDropdownOpen(false);
      resetAI();
      selectedByUser.current = !!info;
    },
    [setSkuInfo, setTryOnParams, resetAI]
  );

  const downloadResultImage = async (url: string, filename: string) => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch { window.open(url, '_blank'); }
  };

  const openCompare = (index: number) => {
    setCompareImages(
      tryOnResults
        .filter((r) => r.imageUrl)
        .map((r) => ({ url: r.imageUrl, label: r.poseDesc || `结果 #${r.index + 1}` }))
    );
    const imageIdx = tryOnResults.filter((r) => r.imageUrl).findIndex((r) => r.index === index);
    setCompareIndex(imageIdx >= 0 ? imageIdx : 0);
    setCompareOpen(true);
  };

  const handleSmartPrompt = useCallback(async () => {
    if (!modelImage) {
      return;
    }
    try {
      const prompt = await generatePrompt(modelImage, skuInfo, productFrontImage);
      if (prompt) {
        setTryOnParams({ chinesePrompt: prompt });
      }
    } catch (e) {
      console.error('AI 分析失败:', e instanceof Error ? e.message : e);
      // 静默失败 — 用户仍可手动输入提示词
    }
  }, [modelImage, skuInfo, productFrontImage, generatePrompt, setTryOnParams]);

  // 用户主动选择领猫款式后自动触发 Kimi → DeepSeek
  const autoTriggeredRef = useRef<string>('');
  const smartPromptRef = useRef(handleSmartPrompt);
  smartPromptRef.current = handleSmartPrompt;

  useEffect(() => {
    if (!modelImage || !skuInfo || !selectedByUser.current || aiGenerating || isGenerating) return;
    const triggerKey = `${modelImage.id}_${skuInfo.skuCode}_${productFrontImage?.id || 'noproduct'}`;
    if (autoTriggeredRef.current === triggerKey) return;
    autoTriggeredRef.current = triggerKey;
    smartPromptRef.current();
  }, [modelImage?.id, skuInfo?.skuCode, productFrontImage?.id, aiGenerating, isGenerating]);

  const updateTemplateSlot = useCallback((id: string, updates: Partial<TemplateSlot>) => {
    setTemplateSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }, []);

  const addTemplateSlot = useCallback(() => {
    setTemplateSlots((prev) => [...prev, { id: genId(), label: '新姿势', image: null, prompt: '' }]);
  }, []);

  const removeTemplateSlot = useCallback((id: string) => {
    setTemplateSlots((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.id !== id)));
  }, []);

  const uploadSlotImage = useCallback((id: string, file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_FILE_SIZE) {
      addToast('warning', '单文件最大 50MB');
      return;
    }
    updateTemplateSlot(id, {
      image: {
        id: genId(),
        type: 'model',
        previewUrl: URL.createObjectURL(file),
        name: file.name,
        size: file.size,
      },
    });
  }, [updateTemplateSlot]);

  // Generate functions
  const handleGenerate = useCallback(async () => {
    if (!modelImage) {
      addToast('warning', '请上传模特参考图');
      return;
    }
    if (!productFrontImage && !productBackImage) {
      addToast('warning', '请至少上传一张商品图片');
      return;
    }

    abortRef.current = false;
    setIsGenerating(true);
    setTryOnResults([]);

    const modelId =
      tryOnParams.model === 'custom' ? customModelId || 'gpt-image-2' : tryOnParams.model;
    const taskId = genId();

    // 给用户提示当前模型信息
    let currentModelId = modelId;
    let modelAttempted: string[] = [];

    addTask({
      id: taskId,
      type: 'tryon',
      skuCode: skuInfo?.skuCode || '',
      productName: skuInfo?.productName || '',
      modelId,
      provider:
        modelId.startsWith('nano-banana') || modelId === 'gpt-image-2-vip' ? 'grsai' : 'yunwu',
      prompt: apiPrompt,
      params: {
        count: tryOnParams.count,
        resolution: tryOnParams.resolutionRatio,
        model: tryOnParams.model,
      },
      status: 'generating',
      progress: 0,
      resultUrls: [],
      referenceUrls: [modelImage?.previewUrl, productFrontImage?.previewUrl].filter(Boolean) as string[],
      error: '',
      createdAt: new Date().toISOString(),
    });

    try {
      let modelB64: string | undefined;
      try {
        const mf = await blobUrlToFile(modelImage.previewUrl, modelImage.name);
        modelB64 = await compressImageForRef(mf); // 参考图用激缩，避免 4K 请求超时
      } catch {
        modelB64 = undefined;
      }

      const results: TryOnResult[] = [];
      for (let i = 0; i < tryOnParams.count; i++) {
        if (abortRef.current) break;
        setGeneratingIndex(i);
        const pose =
          i === 0 ? 'keep the same pose as reference' : POSE_VARIATIONS[(i - 1) % POSE_VARIATIONS.length];
        // 优先用 Kimi+DeepSeek 生成的详细提示词，其次用英文模板
        const basePrompt = tryOnParams.chinesePrompt?.trim() || apiPrompt;
        const prompt = `${basePrompt}, ${pose}`;
        results.push({ index: i, poseDesc: pose, prompt, imageUrl: '', status: 'pending' });

        try {
          let productB64 = '';
          if (productFrontImage) {
            const rf = await blobUrlToFile(productFrontImage.previewUrl, productFrontImage.name);
            productB64 = await compressImageForRef(rf); // 参考图用激缩
          }

          const realUrl = await generateTryOnImage({
            prompt,
            productImageBase64: productB64,
            modelImageBase64: modelB64,
            width: selectedPreset?.width || 3264,
            height: selectedPreset?.height || 2448,
            modelId,
          });

          results[i] = { ...results[i], imageUrl: realUrl, status: 'done' };
          updateTask(taskId, {
            progress: Math.round(((i + 1) / tryOnParams.count) * 100),
            resultUrls: results.filter((r) => r.imageUrl).map((r) => r.imageUrl),
          });
        } catch (e) {
          results[i] = {
            ...results[i],
            status: 'failed',
            error: e instanceof Error ? e.message : '未知错误',
          };
          updateTask(taskId, {
            progress: Math.round(((i + 1) / tryOnParams.count) * 100),
            error: results.filter((r) => r.status === 'failed').map((r) => r.error).join('; '),
          });
        }
      }

      updateTask(taskId, {
        status: results.every((r) => r.status === 'done') ? 'completed' : 'partial',
        progress: 100,
        prompt: apiPrompt,
        resultUrls: results.filter((r) => r.imageUrl).map((r) => r.imageUrl),
        completedAt: new Date().toISOString(),
      });
      setTryOnResults(results);
    } catch (e) {
      updateTask(taskId, {
        status: 'failed',
        error: e instanceof Error ? e.message : '未知错误',
        completedAt: new Date().toISOString(),
      });
      addToast('error', '生成失败: ' + (e instanceof Error ? e.message : ''));
    } finally {
      setGeneratingIndex(-1);
      setIsGenerating(false);
    }
  }, [
    modelImage,
    productFrontImage,
    productBackImage,
    tryOnParams,
    apiPrompt,
    selectedPreset,
    skuInfo,
    customModelId,
    setIsGenerating,
    setTryOnResults,
    addTask,
    updateTask,
  ]);

  const handleTemplateGenerate = useCallback(async () => {
    const filledSlots = templateSlots.filter((s) => s.image);
    if (filledSlots.length === 0) {
      addToast('warning', '请至少为一个姿势槽位上传参考图');
      return;
    }
    if (!productFrontImage && !productBackImage) {
      addToast('warning', '请上传商品图片');
      return;
    }

    setIsGenerating(true);
    setTryOnResults([]);

    const modelId =
      templateConfig.model === 'custom' ? customModelId || 'gpt-image-2' : templateConfig.model;
    const results: TryOnResult[] = [];
    let globalIdx = 0;

    for (const slot of filledSlots) {
      if (!slot.image) continue;

      try {
        const slotB64 = await blobUrlToFile(slot.image.previewUrl, slot.image.name).then(
          compressImageForRef
        );

        let productB64 = '';
        if (productFrontImage) {
          const rf = await blobUrlToFile(productFrontImage.previewUrl, productFrontImage.name);
          productB64 = await compressImageForRef(rf);
        }

        const finalSlotPrompt = `${apiPrompt}, ${slot.prompt}`;

        for (let j = 0; j < templateConfig.countPerSlot; j++) {
          setGeneratingIndex(globalIdx);
          const realUrl = await generateTryOnImage({
            prompt: finalSlotPrompt,
            productImageBase64: productB64,
            modelImageBase64: slotB64,
            width: selectedPreset?.width || 3264,
            height: selectedPreset?.height || 2448,
            modelId,
          });

          results.push({
            index: globalIdx,
            poseDesc: `${slot.label} #${j + 1}`,
            prompt: finalSlotPrompt,
            imageUrl: realUrl,
            status: 'done',
          });
          globalIdx++;
        }
      } catch (e) {
        results.push({
          index: globalIdx,
          poseDesc: slot.label,
          prompt: '',
          imageUrl: '',
          status: 'failed',
          error: e instanceof Error ? e.message : '未知错误',
        });
        globalIdx++;
      }
    }

    const taskId = genId();
    addTask({
      id: taskId,
      type: 'tryon',
      skuCode: skuInfo?.skuCode || '',
      productName: skuInfo?.productName || '',
      modelId,
      provider:
        modelId.startsWith('nano-banana') || modelId === 'gpt-image-2-vip' ? 'grsai' : 'yunwu',
      prompt: `模板批量 × ${filledSlots.length}`,
      params: {
        slots: filledSlots.length,
        perSlot: templateConfig.countPerSlot,
        model: templateConfig.model,
      },
      status: results.every((r) => r.status === 'done') ? 'completed' : 'partial',
      progress: 100,
      resultUrls: results.filter((r) => r.imageUrl).map((r) => r.imageUrl),
      referenceUrls: [productFrontImage?.previewUrl].filter(Boolean) as string[],
      error: results.filter((r) => r.status === 'failed').map((r) => r.error).join('; '),
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    setTryOnResults(results);
    setGeneratingIndex(-1);
    setIsGenerating(false);
  }, [
    templateSlots,
    templateConfig,
    productFrontImage,
    productBackImage,
    apiPrompt,
    selectedPreset,
    skuInfo,
    customModelId,
    setIsGenerating,
    setTryOnResults,
    addTask,
  ]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-forge-cyan to-forge-orange flex items-center justify-center">
            <Shirt size={20} className="text-forge-bg" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-gradient-cyan tracking-wider">
              主图
            </h2>
            <p className="text-xs text-forge-text2">
              {skuInfo
                ? `${skuInfo.productName} · ${skuInfo.skuCode}`
                : '上传图片 → AI 生成方案 → 开始生成'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 p-0.5 glass-card rounded-lg">
            {([
              { value: 'single' as const, label: '单图生成' },
              { value: 'template' as const, label: '姿势裂变' }
            ]).map((item) => (
              <button
                key={item.value}
                onClick={() => setMode(item.value)}
                className={`px-3 py-1.5 rounded-md text-xs transition-all ${
                  mode === item.value
                    ? 'bg-forge-cyan/15 text-forge-cyan font-medium'
                    : 'text-forge-text2 hover:text-forge-text'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => navigate('/batch')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-forge-orange hover:text-forge-cyan border border-forge-orange/30 rounded-lg transition-colors"
          >
            <Layers size={13} />
            批量工单
          </button>
          <button
            onClick={() => navigate('/history')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-forge-text2 hover:text-forge-cyan border border-forge-border/40 rounded-lg transition-colors"
          >
            <History size={13} />
            任务历史
          </button>
          <button
            onClick={() => navigate('/canvas')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-forge-text2 hover:text-forge-cyan border border-forge-border/40 rounded-lg transition-colors"
          >
            详情页 <ArrowRight size={13} />
          </button>
        </div>
      </div>

      {/* Style Selection */}
      <div className="glass-card p-4">
        <h3 className="text-xs text-forge-text2 mb-2.5 flex items-center gap-2">
          <Package size={13} />
          选择款式获取产品资料
        </h3>
        <div className="flex items-center gap-2">
          <div className="relative flex-1" ref={styleInputRef}>
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-forge-text2/30" />
            <input
              value={skuInfo ? `${skuInfo.productName} • ${skuInfo.skuCode}` : styleSearch}
              onChange={(e) => {
                setStyleSearch(e.target.value);
                setStyleDropdownOpen(true);
                if (skuInfo) handleSelectSku(null);
              }}
              onFocus={() => setStyleDropdownOpen(true)}
              placeholder="输入款号或名称搜索..."
              className="input-field !py-2 pl-9 pr-16 text-xs"
            />
            {(skuInfo || styleSearch) && (
              <button
                onClick={() => {
                  handleSelectSku(null);
                  setStyleSearch('');
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-forge-text2/30 hover:text-forge-red"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={() => setStyleDropdownOpen(!styleDropdownOpen)}
            className="p-2 rounded-lg border border-forge-border/40 text-forge-text2 hover:text-forge-cyan"
          >
            <ChevronDown size={14} />
          </button>
        </div>
        {styleDropdownOpen && !skuInfo && (
          <StyleDropdown
            styles={filteredStyles}
            onSelect={handleSelectSku}
            onClose={() => setStyleDropdownOpen(false)}
            anchorRef={styleInputRef}
          />
        )}
      </div>

      {/* SKU Info Display */}
      {skuInfo && (
        <div className="glass-card p-4 space-y-2">
          <h3 className="text-xs text-forge-cyan font-medium flex items-center gap-1.5">
            <Info size={12} />
            已加载款式资料
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
            {skuInfo.composition && <Chip label="成分" value={skuInfo.composition} />}
            {skuInfo.fabricIntro && <Chip label="面料" value={skuInfo.fabricIntro.slice(0, 40)} />}
            {skuInfo.profileIntro && <Chip label="版型" value={skuInfo.profileIntro} />}
            {skuInfo.collarType && <Chip label="领型" value={skuInfo.collarType} />}
            {skuInfo.shoulderType && <Chip label="肩型" value={skuInfo.shoulderType} />}
            {skuInfo.saleInfo && <Chip label="卖点" value={skuInfo.saleInfo.slice(0, 40)} />}
            {skuInfo.fabricCategory && <Chip label="面料类别" value={skuInfo.fabricCategory} />}
            {skuInfo.thicknessElastic && <Chip label="厚薄/弹性" value={skuInfo.thicknessElastic} />}
          </div>
        </div>
      )}

      {/* Product Images Upload */}
      <div className="glass-card p-4 space-y-4">
        <h3 className="section-title flex items-center gap-2">
          <Camera size={14} />
          商品图片
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UploadBlock
            label="商品正面白底图（必选）"
            icon={Upload}
            img={productFrontImage}
            onUp={setProductFrontImage}
            onRm={() => setProductFrontImage(null)}
            maxSize={MAX_FILE_SIZE}
          />
          <UploadBlock
            label="商品反面白底图（可选）"
            icon={Upload}
            img={productBackImage}
            onUp={setProductBackImage}
            onRm={() => setProductBackImage(null)}
            maxSize={MAX_FILE_SIZE}
          />
        </div>
      </div>

      {/* Single Mode */}
      {mode === 'single' && (
        <>
          <div className="glass-card p-4 space-y-4">
            <h3 className="section-title flex items-center gap-2">
              <Camera size={14} />
              模特参考图
            </h3>
            <UploadBlock
              label="模特姿势参考图（必选）"
              icon={Camera}
              img={modelImage}
              onUp={setModelImage}
              onRm={() => setModelImage(null)}
              maxSize={MAX_FILE_SIZE}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[45fr_55fr] gap-6">
            {/* Left: Params */}
            <div className="glass-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="section-title flex items-center gap-2 mb-0">
                  <Play size={14} />
                  生成参数
                </h3>
                {!skuInfo && (
                  <button
                    onClick={handleSmartPrompt}
                    disabled={aiGenerating || !modelImage}
                    className="px-2.5 py-1 rounded-lg text-[10px] bg-purple-500/15 text-purple-300 border border-purple-400/30 hover:bg-purple-500/25 transition-all flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {aiGenerating ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
                    {aiGenerating ? 'AI 分析中...' : 'AI 反推提示词'}
                  </button>
                )}
              </div>

              <LLMSteps steps={aiSteps} />

              <div>
                <label className="text-xs text-forge-text2 block mb-1">AI 模型</label>
                <select
                  value={tryOnParams.model}
                  onChange={(e) => {
                    setTryOnParams({ model: e.target.value });
                    setShowCustomModel(e.target.value === 'custom');
                  }}
                  className="input-field"
                >
                  {allModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.desc}
                    </option>
                  ))}
                </select>
                {showCustomModel && (
                  <div className="mt-2 flex items-center gap-2">
                    <Pencil size={12} className="text-forge-orange" />
                    <input
                      type="text"
                      value={customModelId}
                      onChange={(e) => setCustomModelId(e.target.value)}
                      placeholder="自定义模型ID"
                      className="input-field !py-1.5 text-xs"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-forge-text2 block mb-1">分辨率比例</label>
                <select
                  value={tryOnParams.resolutionRatio}
                  onChange={(e) => setTryOnParams({ resolutionRatio: e.target.value })}
                  className="input-field"
                >
                  {RESOLUTION_PRESETS.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {selectedPreset && selectedPreset.width > 0 && (
                  <p className="text-[10px] text-forge-text2/60 mt-1">
                    {selectedPreset.width} × {selectedPreset.height} px
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs text-forge-text2 block mb-1">
                  <FileText size={12} className="inline mr-1" />
                  参考方案（可修改）
                </label>
                <textarea
                  value={tryOnParams.chinesePrompt}
                  onChange={(e) => setTryOnParams({ chinesePrompt: e.target.value })}
                  placeholder={apiPrompt}
                  className="textarea-field h-28 text-xs"
                />
                <p className="text-[10px] text-forge-text2/50 mt-1">
                  💡 上方：中文方案（可修改）。下方：发送给 API 的英文提示词。
                </p>
                <div className="mt-1.5 p-2 rounded bg-forge-surface2/50 text-[10px] text-forge-cyan/70 max-h-20 overflow-y-auto border border-forge-border/20">
                  {apiPrompt}
                </div>
              </div>

              <div>
                <label className="text-xs text-forge-text2 block mb-1">生成数量</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTryOnParams({ count: Math.max(1, tryOnParams.count - 1) })}
                    className="p-2 rounded-lg bg-forge-surface2 border border-forge-border/40 text-forge-text2 hover:text-forge-cyan"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-10 text-center font-display text-forge-cyan text-sm">
                    {tryOnParams.count}
                  </span>
                  <button
                    onClick={() => setTryOnParams({ count: Math.min(8, tryOnParams.count + 1) })}
                    className="p-2 rounded-lg bg-forge-surface2 border border-forge-border/40 text-forge-text2 hover:text-forge-cyan"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Preview */}
            <div className="glass-card p-4">
              <h3 className="section-title flex items-center gap-2">
                <Sparkles size={14} />
                生成预览区
              </h3>
              {isGenerating && (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 size={36} className="animate-spin text-forge-cyan mb-3" />
                  <p className="text-forge-cyan text-sm font-medium">
                    生成第 {generatingIndex + 1}/{tryOnParams.count} 张...
                  </p>
                  <div className="w-48 h-1.5 rounded-full bg-forge-surface2 overflow-hidden mt-3">
                    <div
                      className="h-full bg-gradient-to-r from-forge-cyan to-forge-orange transition-all duration-500"
                      style={{ width: `${Math.round(((generatingIndex + 1) / tryOnParams.count) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {!isGenerating && tryOnResults.length > 0 && (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  {tryOnResults.map((r) => (
                    <div key={r.index} className="glass-card p-2 text-center">
                      {r.imageUrl ? (
                        <div className="relative group cursor-pointer" onClick={() => openCompare(r.index)}>
                          <img
                            src={r.imageUrl}
                            alt=""
                            className="w-full aspect-[3/4] object-cover rounded-lg mb-1.5 group-hover:ring-2 group-hover:ring-forge-cyan/50 transition-all"
                          />
                          <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center mb-1.5">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded bg-forge-cyan/90 text-white text-[10px] font-medium flex items-center gap-1">
                              <ZoomIn size={11} />对比原图
                            </span>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); downloadResultImage(r.imageUrl, `vf-result-${r.index + 1}.png`); }}
                            className="absolute top-1.5 right-1.5 p-1 rounded bg-black/60 text-white hover:bg-forge-cyan transition-colors"
                            title="下载此图"
                          >
                            <Download size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="w-full aspect-[3/4] bg-forge-surface2 rounded-lg flex items-center justify-center mb-1.5">
                          <X size={20} className="text-forge-red/50" />
                        </div>
                      )}
                      <span className="text-[10px] text-forge-cyan font-bold mr-1">
                        #{String(r.index + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[10px] text-forge-text2">{r.poseDesc}</span>
                      {r.status === 'failed' && r.error && (
                        <p className="text-[9px] text-forge-red mt-0.5 truncate">{r.error.slice(0, 40)}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!isGenerating && tryOnResults.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-14 h-14 rounded-full bg-forge-surface2 flex items-center justify-center mb-3">
                    <Shirt size={24} className="text-forge-text2/25" />
                  </div>
                  <p className="text-forge-text2 text-sm">上传商品图和模特图后</p>
                  <p className="text-forge-text2/40 text-xs">上传模特图后自动 AI 分析生成方案</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={isGenerating || aiGenerating}
              className="orange-btn flex-1 px-6 py-4 rounded-lg text-base flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <><Loader2 size={18} className="animate-spin" />正在生成 {generatingIndex + 1}/{tryOnParams.count}</>
              ) : aiGenerating ? (
                <><Loader2 size={18} className="animate-spin" />等待 AI 分析完成...</>
              ) : (
                <><Sparkles size={18} />开始生成（{tryOnParams.count} 张）</>
              )}
            </button>
            {isGenerating && (
              <button onClick={() => { abortRef.current = true; }} className="px-6 py-4 rounded-lg text-sm border border-forge-red/30 text-forge-red hover:bg-forge-red/10 transition-colors">
                取消
              </button>
            )}
          </div>
        </>
      )}

      {/* Template Mode */}
      {mode === 'template' && (
        <>
          <div className="glass-card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="section-title flex items-center gap-2 mb-0">
                <Layers size={14} />
                姿势裂变槽位
              </h3>
              <button
                onClick={addTemplateSlot}
                className="text-[10px] text-forge-cyan hover:underline flex items-center gap-1"
              >
                <Plus size={12} />
                添加姿势
              </button>
            </div>
            <p className="text-[10px] text-forge-text2/60">
              每个槽位上传参考图 + 姿势描述，批量生成多张图
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {templateSlots.map((slot) => (
                <div key={slot.id} className="glass-card p-3 space-y-2 border border-forge-border/30">
                  <div className="flex items-center justify-between">
                    <input
                      value={slot.label}
                      onChange={(e) => updateTemplateSlot(slot.id, { label: e.target.value })}
                      className="input-field !py-1 text-xs font-medium"
                      placeholder="姿势名称"
                    />
                    <button
                      onClick={() => removeTemplateSlot(slot.id)}
                      className="p-1 text-forge-text2/40 hover:text-forge-red ml-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {slot.image ? (
                    <div className="relative">
                      <img
                        src={slot.image.previewUrl}
                        alt=""
                        className="w-full aspect-[4/5] object-cover rounded-lg border border-forge-border/30"
                      />
                      <button
                        onClick={() => updateTemplateSlot(slot.id, { image: null })}
                        className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white hover:bg-forge-red"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        const inp = document.createElement('input');
                        inp.type = 'file';
                        inp.accept = 'image/*';
                        inp.onchange = () => {
                          const f = inp.files?.[0];
                          if (f) uploadSlotImage(slot.id, f);
                        };
                        inp.click();
                      }}
                      className="w-full aspect-[4/5] rounded-lg border-2 border-dashed border-forge-border/40 flex flex-col items-center justify-center hover:border-forge-cyan/30 transition-colors gap-1"
                    >
                      <Upload size={18} className="text-forge-text2/30" />
                      <span className="text-[10px] text-forge-text2/50">上传参考图</span>
                    </button>
                  )}
                  <textarea
                    value={slot.prompt}
                    onChange={(e) => updateTemplateSlot(slot.id, { prompt: e.target.value })}
                    className="textarea-field !min-h-[40px] !py-1.5 text-[10px]"
                    placeholder="姿势描述..."
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-4 space-y-3">
            <h3 className="section-title flex items-center gap-2">
              <Play size={14} />
              批量生成参数
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-forge-text2 block mb-1">AI 模型</label>
                <select
                  value={templateConfig.model}
                  onChange={(e) => {
                    setTemplateConfig((prev) => ({ ...prev, model: e.target.value }));
                    setShowCustomModel(e.target.value === 'custom');
                  }}
                  className="input-field"
                >
                  {allModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.desc}
                    </option>
                  ))}
                </select>
                {showCustomModel && (
                  <div className="mt-2 flex items-center gap-2">
                    <Pencil size={12} className="text-forge-orange" />
                    <input
                      type="text"
                      value={customModelId}
                      onChange={(e) => setCustomModelId(e.target.value)}
                      placeholder="自定义模型ID"
                      className="input-field !py-1.5 text-xs"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-forge-text2 block mb-1">分辨率</label>
                <select
                  value={templateConfig.resolutionRatio}
                  onChange={(e) =>
                    setTemplateConfig((prev) => ({ ...prev, resolutionRatio: e.target.value }))
                  }
                  className="input-field"
                >
                  {RESOLUTION_PRESETS.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-forge-text2 block mb-1">每槽位生成数量</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setTemplateConfig((prev) => ({
                        ...prev,
                        countPerSlot: Math.max(1, prev.countPerSlot - 1),
                      }))
                    }
                    className="p-2 rounded-lg bg-forge-surface2 border border-forge-border/40 text-forge-text2 hover:text-forge-cyan"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-8 text-center font-display text-forge-cyan text-sm">
                    {templateConfig.countPerSlot}
                  </span>
                  <button
                    onClick={() =>
                      setTemplateConfig((prev) => ({
                        ...prev,
                        countPerSlot: Math.min(4, prev.countPerSlot + 1),
                      }))
                    }
                    className="p-2 rounded-lg bg-forge-surface2 border border-forge-border/40 text-forge-text2 hover:text-forge-cyan"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-forge-text2/50">
              预计 {templateSlots.filter((s) => s.image).length * templateConfig.countPerSlot} 张
            </p>
          </div>

          <div className="glass-card p-4">
            <h3 className="section-title flex items-center gap-2">
              <Sparkles size={14} />
              批量生成预览区
            </h3>
            {isGenerating && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 size={36} className="animate-spin text-forge-cyan mb-3" />
                <p className="text-forge-cyan text-sm font-medium">批量生成中...</p>
              </div>
            )}
            {!isGenerating && tryOnResults.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mt-2">
                {tryOnResults.map((r) => (
                  <div key={r.index} className="glass-card p-2 text-center">
                    {r.imageUrl ? (
                      <div className="relative group cursor-pointer" onClick={() => openCompare(r.index)}>
                        <img
                          src={r.imageUrl}
                          alt=""
                          className="w-full aspect-[3/4] object-cover rounded-lg mb-1.5 group-hover:ring-2 group-hover:ring-forge-cyan/50 transition-all"
                        />
                        <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center mb-1.5">
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded bg-forge-cyan/90 text-white text-[10px] font-medium flex items-center gap-1">
                            <ZoomIn size={11} />对比原图
                          </span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); downloadResultImage(r.imageUrl, `vf-result-${r.index + 1}.png`); }}
                          className="absolute top-1.5 right-1.5 p-1 rounded bg-black/60 text-white hover:bg-forge-cyan transition-colors"
                          title="下载此图"
                        >
                          <Download size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="w-full aspect-[3/4] bg-forge-surface2 rounded-lg flex items-center justify-center mb-1.5">
                        <X size={20} className="text-forge-red/50" />
                      </div>
                    )}
                    <span className="text-[10px] text-forge-cyan font-bold mr-1">
                      #{String(r.index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[10px] text-forge-text2">{r.poseDesc}</span>
                    {r.status === 'failed' && r.error && (
                      <p className="text-[9px] text-forge-red mt-0.5 truncate">{r.error.slice(0, 40)}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!isGenerating && tryOnResults.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="w-14 h-14 rounded-full bg-forge-surface2 flex items-center justify-center mb-3">
                  <Layers size={24} className="text-forge-text2/25" />
                </div>
                <p className="text-forge-text2 text-sm">上传商品图并填好槽位后</p>
                <p className="text-forge-text2/40 text-xs">点击下方按钮批量生成</p>
              </div>
            )}
          </div>

          <button
            onClick={handleTemplateGenerate}
            disabled={isGenerating}
            className="orange-btn w-full px-6 py-4 rounded-lg text-base flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            {isGenerating ? '批量生成中...' : `批量生成（${templateSlots.filter((s) => s.image).length * templateConfig.countPerSlot} 张）`}
          </button>
        </>
      )}

      {/* Image Compare Modal */}
      <ImageCompareModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        beforeUrl={modelImage?.previewUrl || productFrontImage?.previewUrl || ''}
        beforeLabel={modelImage ? '模特参考图' : '商品参考图'}
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
