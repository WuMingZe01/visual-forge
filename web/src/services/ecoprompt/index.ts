import type {
  ProductInputData, StyleLock, StyleLockConfig, ConversionDriver,
  ImagePlanItem, AssembledPrompt, FullImagePlan, BatchGenerationResult,
} from '@/types/eco-types';
import { diagnoseDriver } from './driver';
import { assembleStyleLock } from './stylelock';
import { generateImagePlan } from './imageplan';
import { assignCameraAngles } from './camera';
import { assignBackgroundColors } from './background';
import { buildSinglePrompt } from './singleprompt';

export interface EcoPromptInput {
  product: ProductInputData;
  styleLockConfig?: StyleLockConfig;
}

export interface EcoPromptOutput {
  driverResult: { driver: ConversionDriver; confidence: number; signals: { visual: number; painPoint: number; emotional: number } };
  styleLock: StyleLock;
  fullPlan: FullImagePlan;
  prompts: AssembledPrompt[];
}

export function buildEcoPrompts(input: EcoPromptInput): EcoPromptOutput {
  const driverResult = diagnoseDriver(input.product);
  const styleLock = assembleStyleLock(input.styleLockConfig);
  const planItems = generateImagePlan(input.product, driverResult.driver);
  let itemsWithAngles = assignCameraAngles(planItems);
  const bgPalette = styleLock.config.palette.map((c) => c.hex);
  itemsWithAngles = assignBackgroundColors(itemsWithAngles, bgPalette);

  const productDesc = `${input.product.category}：${input.product.sellingPoints.slice(0, 3).join('、')}`;
  const prompts = itemsWithAngles.map((item): AssembledPrompt => ({
    screenId: item.screenId,
    prompt: buildSinglePrompt(item, styleLock, productDesc),
    imagePlan: item,
  }));

  let totalWide = 0;
  const angleDist: Record<string, number> = {};
  for (const item of itemsWithAngles) {
    if (item.cameraAngleId === 'front34' || item.cameraAngleId === 'overhead' || item.cameraAngleId === 'lowAngle') totalWide++;
    angleDist[item.cameraAngleId] = (angleDist[item.cameraAngleId] || 0) + 1;
  }

  const fullPlan: FullImagePlan = {
    driver: driverResult.driver,
    items: itemsWithAngles,
    totalWide,
    maxWide: Math.floor(itemsWithAngles.length * 0.4),
    angleDistribution: angleDist as FullImagePlan['angleDistribution'],
  };

  return { driverResult, styleLock, fullPlan, prompts };
}
