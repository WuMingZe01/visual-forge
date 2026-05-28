/**
 * AI提示词生成Hook - 两阶段LLM处理
 * 有白底图时：Kimi 双图分析（模特+白底）→ DeepSeek 整合
 * 无白底图时：Kimi 单图分析（仅模特）→ DeepSeek 生成
 */
import { useState, useCallback } from 'react';
import { useLlmStore } from '@/store/useLlmStore';
import { analyzeModelImage, analyzeBothImages, assembleFinalPrompt } from '@/services/llmService';
import type { SKUInfo, ReferenceImage } from '@/types/tryon-types';
import { compressImageToBase64, compressImageForLLM, blobUrlToFile } from '@/utils/image';

export interface LLMStep {
  step: string;
  status: 'running' | 'done' | 'fail';
  text?: string;
}

export function buildProductInfoString(sku: SKUInfo | null): string {
  if (!sku) return '';
  const lines: string[] = [];
  if (sku.productName) lines.push(`商品名称：${sku.productName}`);
  if (sku.composition) lines.push(`材质成分：${sku.composition}`);
  if (sku.profileIntro) lines.push(`版型：${sku.profileIntro}`);
  if (sku.collarType) lines.push(`领型：${sku.collarType}`);
  if (sku.shoulderType) lines.push(`肩型：${sku.shoulderType}`);
  if (sku.sleeveType) lines.push(`袖型：${sku.sleeveType}`);
  if (sku.hemDesign) lines.push(`下摆：${sku.hemDesign}`);
  if (sku.saleInfo) lines.push(`设计卖点/细节：${sku.saleInfo}`);
  if (sku.fabricIntro) lines.push(`面料介绍：${sku.fabricIntro}`);
  if (sku.fabricCategory) lines.push(`面料类别：${sku.fabricCategory}`);
  if (sku.thicknessElastic) lines.push(`厚薄/弹性：${sku.thicknessElastic}`);
  return lines.join('\n');
}

export function useAIPrompt() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [steps, setSteps] = useState<LLMStep[]>([]);
  const getVisionModel = useLlmStore((s) => s.getVisionModel);
  const getTextModel = useLlmStore((s) => s.getTextModel);

  const generatePrompt = useCallback(
    async (
      modelImage: ReferenceImage | null,
      skuInfo: SKUInfo | null,
      productImage?: ReferenceImage | null
    ): Promise<string | null> => {
      const visionModel = getVisionModel();
      const textModel = getTextModel();

      if (!visionModel || !textModel) {
        throw new Error('请先在系统设置中启用 LLM 模型');
      }

      if (!modelImage) {
        throw new Error('请先上传模特参考图');
      }

      setIsGenerating(true);

      const hasProductImg = !!productImage;

      try {
        const modelFile = await blobUrlToFile(modelImage.previewUrl, modelImage.name);
        const modelB64 = await compressImageForLLM(modelFile);

        let invariantFeats: string;
        let garmentVisualDetails = '';

        if (hasProductImg) {
          // 有白底图 → 双图分析（用 analyzeBoth 模板，详细提取模特不变特征+服装细节）
          setSteps([{ step: 'Step 1: Kimi 双图分析 — 提取模特不变特征 + 服装视觉细节', status: 'running' }]);

          const productFile = await blobUrlToFile(productImage!.previewUrl, productImage!.name);
          const productB64 = await compressImageForLLM(productFile);

          const result = await analyzeBothImages(visionModel, modelB64, productB64);
          invariantFeats = result.invariant;
          garmentVisualDetails = result.garmentDetails;

          setSteps((prev) => [
            { ...prev[0], status: 'done', text: invariantFeats.slice(0, 250) },
            { step: 'Step 2: DeepSeek 整合特征 + 商品资料 → 生图方案', status: 'running' },
          ]);
        } else {
          // 无白底图：只分析模特图
          setSteps([{ step: 'Step 1: Kimi 分析模特图 → 提取不变特征', status: 'running' }]);

          invariantFeats = await analyzeModelImage(visionModel, modelB64);

          setSteps((prev) => [
            { ...prev[0], status: 'done', text: invariantFeats.slice(0, 250) },
            { step: 'Step 2: DeepSeek 整合 → 生图方案', status: 'running' },
          ]);
        }

        const productInfo = buildProductInfoString(skuInfo) || '通用时尚服装';
        const mergedProductInfo = garmentVisualDetails
          ? `${productInfo}\n\n【白底图视觉细节】\n${garmentVisualDetails}`
          : productInfo;

        const finalPrompt = await assembleFinalPrompt(textModel, invariantFeats, mergedProductInfo);

        setSteps((prev) => [prev[0], { ...prev[1], status: 'done', text: finalPrompt.slice(0, 300) }]);

        return finalPrompt;
      } catch (e) {
        const msg = e instanceof Error ? e.message : '未知错误';
        setSteps((prev) =>
          prev.map((s) => (s.status === 'running' ? { ...s, status: 'fail', text: msg.slice(0, 200) } : s))
        );
        throw e;
      } finally {
        setIsGenerating(false);
      }
    },
    [getVisionModel, getTextModel]
  );

  const reset = useCallback(() => {
    setSteps([]);
    setIsGenerating(false);
  }, []);

  return {
    isGenerating,
    steps,
    generatePrompt,
    reset,
  };
}
