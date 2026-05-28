import type { ProductInputData, DriverDiagnosis, ConversionDriver } from '@/types/eco-types';

const VISUAL_CATEGORIES = ['服饰', '珠宝', '家居', '美妆', '3C数码', '鞋包', '配饰', '香氛', '文具', '玩具'];
const PAIN_CATEGORIES = ['清洁', '修复', '保健', '防护', '工具', '药品', '母婴', '宠物', '厨房', '收纳'];
const EMOTIONAL_CATEGORIES = ['香水', '礼品', '奢侈品', '旅行', '运动', '户外', '潮玩', '收藏'];

const VISUAL_KW = ['设计', '质感', '颜色', '外观', '工艺', '材质', '光泽', '造型', '颜值', '拍照'];
const PAIN_KW = ['解决', '消除', '修复', '不伤', '温和', '安全', '防护', '清洁', '快速', '有效'];
const EMOTIONAL_KW = ['自信', '优雅', '品位', '惊喜', '享受', '宠爱', '仪式感', '犒劳', '高端', '独特'];

export function diagnoseDriver(product: ProductInputData): DriverDiagnosis {
  const signals = { visual: 0, painPoint: 0, emotional: 0 };

  const catLower = product.category.toLowerCase();
  for (const c of VISUAL_CATEGORIES) { if (catLower.includes(c)) signals.visual += 2; }
  for (const c of PAIN_CATEGORIES) { if (catLower.includes(c)) signals.painPoint += 2; }
  for (const c of EMOTIONAL_CATEGORIES) { if (catLower.includes(c)) signals.emotional += 2; }

  for (const sp of product.sellingPoints) {
    const s = sp.toLowerCase();
    for (const kw of VISUAL_KW) { if (s.includes(kw)) signals.visual += 1; }
    for (const kw of PAIN_KW) { if (s.includes(kw)) signals.painPoint += 1; }
    for (const kw of EMOTIONAL_KW) { if (s.includes(kw)) signals.emotional += 1; }
  }

  const total = signals.visual + signals.painPoint + signals.emotional || 1;
  const keys = ['visual', 'painPoint', 'emotional'] as const;
  let driver: ConversionDriver = 'visual';
  let maxVal = signals.visual;
  if (signals.painPoint > maxVal) { driver = 'pain_point'; maxVal = signals.painPoint; }
  if (signals.emotional > maxVal) { driver = 'emotional'; }

  return { driver, confidence: maxVal / total, signals };
}
