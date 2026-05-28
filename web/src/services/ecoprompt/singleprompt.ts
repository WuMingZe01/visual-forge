import type { ImagePlanItem, StyleLock } from '@/types/eco-types';

export const DETAIL_PREFIX: Record<string, string> = {
  D1: 'E-commerce product infographic, vertical layout for mobile.',
  D2: 'E-commerce problem vs solution infographic, vertical layout.',
  D3: 'Product mechanism infographic, vertical mobile layout.',
  D4: 'E-commerce infographic benefits screen.',
  D5: 'Usage steps infographic, numbered timeline layout.',
  D6: 'Lifestyle scene collage infographic, vertical mobile.',
  D7: 'Comparison infographic, before-and-after layout.',
  D8: 'Trust and certification infographic.',
  D9: 'FAQ / CTA infographic, mobile-optimized.',
};

export const DEFAULT_NEGATIVE =
  'Do not add: props, hands, watermarks, fake logos, extra text, ' +
  'decorative elements, gradient backgrounds, dense body text, ' +
  '乱码, 多余手指, 假logo, 水印, 伪文案.';

export function buildSinglePrompt(item: ImagePlanItem, styleLock: StyleLock, productDescription: string): string {
  const parts: string[] = [];

  parts.push(styleLock.lockText);
  parts.push('');

  if (item.isDetailPage) {
    const prefix = DETAIL_PREFIX[item.screenId] || 'E-commerce infographic, vertical mobile layout.';
    parts.push(prefix);
  }

  if (item.isMainImage && item.screenId === 'H1') {
    parts.push(`Professional product photography on pure #FFFFFF seamless background. ${productDescription}.`);
  } else {
    parts.push(`On ${item.bgHex} background. ${item.purpose}：${productDescription}.`);
  }

  if (item.isDetailPage && item.ecommerceStructure) {
    parts.push(item.ecommerceStructure);
  }

  parts.push(item.cameraAngleText + '.');

  parts.push('Soft diffused studio lighting from upper-left, color temperature 5500K, subtle rim light.');

  parts.push(`Product occupies ${item.productRatio}% of frame. Whitespace at least ${item.whitespaceRate}%.`);

  if (item.isMainImage && item.platformOverlay) {
    parts.push('Top center 200x100 pixel area kept completely clear for platform price overlay.');
  }
  if (item.logoCorner) {
    parts.push('Top-left corner 200x100 pixel area kept completely clear for brand logo.');
  }

  for (const t of item.textElements) {
    parts.push(`${t.role} in ${t.hex} at ${t.ptSize}pt reading 「${t.content}」.`);
  }
  if (item.isDetailPage && item.textElements.length > 0) {
    parts.push('Headlines 6-12 Chinese characters. Total text under 50 characters per screen.');
  }

  parts.push(DEFAULT_NEGATIVE);
  parts.push(`${item.aspectRatio} aspect ratio.`);

  return parts.filter(Boolean).join('\n');
}
