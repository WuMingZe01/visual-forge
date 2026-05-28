import type { ImagePlanItem, ConversionDriver, ProductInputData } from '@/types/eco-types';

export const VISUAL_SEQUENCE: ImagePlanItem[] = [];
export const PAIN_SEQUENCE: ImagePlanItem[] = [];
export const EMOTIONAL_SEQUENCE: ImagePlanItem[] = [];

export function getMainTemplates(driver: ConversionDriver): { screenId: string; purpose: string }[] {
  if (driver === 'pain_point') {
    return [
      { screenId: 'H1', purpose: '问题快照' },
      { screenId: 'H2', purpose: '解决机制' },
      { screenId: 'H3', purpose: '利益证明' },
      { screenId: 'H4', purpose: '信任画面' },
      { screenId: 'H5', purpose: '优惠+紧迫CTA' },
    ];
  }
  if (driver === 'emotional') {
    return [
      { screenId: 'H1', purpose: '情绪场景钩子' },
      { screenId: 'H2', purpose: '身份/价值表达' },
      { screenId: 'H3', purpose: '产品作为实现方式' },
      { screenId: 'H4', purpose: '归属/社交信号' },
      { screenId: 'H5', purpose: '情绪强化+CTA' },
    ];
  }
  return [
    { screenId: 'H1', purpose: '一眼可懂的视觉主张' },
    { screenId: 'H2', purpose: '核心功能/质感特写' },
    { screenId: 'H3', purpose: '使用场景匹配' },
    { screenId: 'H4', purpose: '普通vs本品对比' },
    { screenId: 'H5', purpose: '保障/CTA画面' },
  ];
}

export function getDetailScreens(): { screenId: string; purpose: string }[] {
  return [
    { screenId: 'D1', purpose: '首屏承接' },
    { screenId: 'D2', purpose: '痛点放大' },
    { screenId: 'D3', purpose: '机制解释' },
    { screenId: 'D4', purpose: '核心利益' },
    { screenId: 'D5', purpose: '使用步骤' },
    { screenId: 'D6', purpose: '场景覆盖' },
    { screenId: 'D7', purpose: '对比选择' },
    { screenId: 'D8', purpose: '信任背书' },
  ];
}
