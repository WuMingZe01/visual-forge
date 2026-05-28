import type { ImagePlanItem, ProductInputData, ConversionDriver } from '@/types/eco-types';

type ItemOverride = Partial<ImagePlanItem> & { screenId: string };

function makeItem(overrides: ItemOverride, seqIndex: number): ImagePlanItem {
  const { screenId, ...rest } = overrides;
  return {
    screenId,
    seqIndex,
    purpose: '',
    aspectRatio: '1:1',
    templateId: '01-hero-image',
    cameraAngleId: 'front34',
    cameraAngleText: '',
    shotTypeId: 'wide',
    bgHex: '#FFFFFF',
    productRatio: 38,
    whitespaceRate: 45,
    ecommerceStructure: '',
    textElements: [],
    platformOverlay: false,
    logoCorner: false,
    isMainImage: false,
    isDetailPage: false,
    ...rest,
  };
}

const VISUAL_MAIN: ItemOverride[] = [
  { screenId: 'H1', purpose: '一眼可懂的视觉主张', isMainImage: true, aspectRatio: '1:1', productRatio: 38, whitespaceRate: 45, templateId: '01-hero-image', platformOverlay: true },
  { screenId: 'H2', purpose: '核心功能/质感特写', isMainImage: true, aspectRatio: '1:1', productRatio: 55, whitespaceRate: 40, templateId: '04-detail-macro', shotTypeId: 'closeup' },
  { screenId: 'H3', purpose: '使用场景匹配', isMainImage: true, aspectRatio: '1:1', productRatio: 22, whitespaceRate: 50, templateId: '02-lifestyle-scene' },
  { screenId: 'H4', purpose: '普通 vs 本品对比', isMainImage: true, aspectRatio: '1:1', productRatio: 30, whitespaceRate: 45, templateId: '09-before-after' },
  { screenId: 'H5', purpose: '保障/CTA 画面', isMainImage: true, aspectRatio: '1:1', productRatio: 25, whitespaceRate: 50, templateId: '05-poster-banner' },
];

const PAIN_MAIN: ItemOverride[] = [
  { screenId: 'H1', purpose: '问题快照', isMainImage: true, aspectRatio: '1:1', productRatio: 30, whitespaceRate: 45, templateId: '02-lifestyle-scene', platformOverlay: true },
  { screenId: 'H2', purpose: '解决机制', isMainImage: true, aspectRatio: '1:1', productRatio: 45, whitespaceRate: 40, templateId: '11-infographic', shotTypeId: 'medium' },
  { screenId: 'H3', purpose: '利益证明', isMainImage: true, aspectRatio: '1:1', productRatio: 38, whitespaceRate: 45, templateId: '01-hero-image' },
  { screenId: 'H4', purpose: '信任画面', isMainImage: true, aspectRatio: '1:1', productRatio: 55, whitespaceRate: 40, templateId: '04-detail-macro', shotTypeId: 'closeup' },
  { screenId: 'H5', purpose: '优惠+紧迫CTA', isMainImage: true, aspectRatio: '1:1', productRatio: 25, whitespaceRate: 50, templateId: '05-poster-banner' },
];

const EMOTIONAL_MAIN: ItemOverride[] = [
  { screenId: 'H1', purpose: '情绪场景钩子', isMainImage: true, aspectRatio: '1:1', productRatio: 20, whitespaceRate: 50, templateId: '02-lifestyle-scene', platformOverlay: true },
  { screenId: 'H2', purpose: '身份/价值表达', isMainImage: true, aspectRatio: '1:1', productRatio: 30, whitespaceRate: 45, templateId: '20-magazine-editorial' },
  { screenId: 'H3', purpose: '产品作为实现方式', isMainImage: true, aspectRatio: '1:1', productRatio: 38, whitespaceRate: 45, templateId: '01-hero-image' },
  { screenId: 'H4', purpose: '归属/社交信号', isMainImage: true, aspectRatio: '1:1', productRatio: 25, whitespaceRate: 50, templateId: '02-lifestyle-scene' },
  { screenId: 'H5', purpose: '情绪强化+CTA', isMainImage: true, aspectRatio: '1:1', productRatio: 25, whitespaceRate: 50, templateId: '05-poster-banner' },
];

const DETAIL_SCREENS: ItemOverride[] = [
  { screenId: 'D1', purpose: '首屏承接：延续主图卖点', isDetailPage: true, aspectRatio: '2:3', productRatio: 35, whitespaceRate: 48, templateId: '11-infographic', shotTypeId: 'medium', ecommerceStructure: 'Top headline and product centered. Below: four feature icons with short labels in a horizontal row.' },
  { screenId: 'D2', purpose: '痛点放大：当前不便/风险', isDetailPage: true, aspectRatio: '2:3', productRatio: 30, whitespaceRate: 48, templateId: '09-before-after', ecommerceStructure: 'Problem-vs-solution layout: left side shows pain point visualization, right side shows solution with product.' },
  { screenId: 'D3', purpose: '机制解释：产品如何发挥作用', isDetailPage: true, aspectRatio: '2:3', productRatio: 40, whitespaceRate: 48, templateId: '17-exploded-view', shotTypeId: 'medium', ecommerceStructure: 'Product cross-section or mechanism diagram with thin callout lines connecting to feature blocks with monochrome icons.' },
  { screenId: 'D4', purpose: '核心利益：左图右文引线图标', isDetailPage: true, aspectRatio: '2:3', productRatio: 35, whitespaceRate: 48, templateId: '11-infographic', ecommerceStructure: 'Left side: product shown at elevated overhead angle. Right side: four benefit rows stacked vertically with thin-line icons and short labels.' },
  { screenId: 'D5', purpose: '使用步骤：3-4步流程', isDetailPage: true, aspectRatio: '2:3', productRatio: 30, whitespaceRate: 48, templateId: '13-size-spec', shotTypeId: 'medium', ecommerceStructure: 'Numbered timeline layout: 3-4 steps in numbered circles with icons, connected by thin lines, final step shows product in use.' },
  { screenId: 'D6', purpose: '场景覆盖：典型使用场景', isDetailPage: true, aspectRatio: '2:3', productRatio: 22, whitespaceRate: 50, templateId: '02-lifestyle-scene', ecommerceStructure: 'Three lifestyle scenes arranged vertically, each with scene label. Thin dividing lines between scenes.' },
  { screenId: 'D7', purpose: '对比选择：普通 vs 本品', isDetailPage: true, aspectRatio: '2:3', productRatio: 30, whitespaceRate: 48, templateId: '09-before-after', shotTypeId: 'medium', ecommerceStructure: 'Split comparison layout: left half "普通方案" with dimmed visuals, right half "本品" with bright highlight and checkmark badges.' },
  { screenId: 'D8', purpose: '信任背书：徽章/证明', isDetailPage: true, aspectRatio: '2:3', productRatio: 35, whitespaceRate: 48, templateId: '11-infographic', ecommerceStructure: 'Certification and trust layout: product image with surrounding trust badges, certification icons, and proof placeholder badges in rounded rectangles.' },
];

export function generateImagePlan(product: ProductInputData, driver: ConversionDriver): ImagePlanItem[] {
  const mainTemplates = driver === 'pain_point' ? PAIN_MAIN : driver === 'emotional' ? EMOTIONAL_MAIN : VISUAL_MAIN;
  const mainImages = mainTemplates.map((t, i) => makeItem({ ...t }, i));

  const detailImages = DETAIL_SCREENS.map((t, i) => makeItem({ ...t }, mainImages.length + i));

  const allItems = [...mainImages, ...detailImages];
  const productDesc = `${product.category}：${product.sellingPoints.slice(0, 3).join('、')}`;

  for (const item of allItems) {
    item.ecommerceStructure = (item.ecommerceStructure || '')
      .replace(/\{PRODUCT\}/g, productDesc);
  }

  return allItems;
}
