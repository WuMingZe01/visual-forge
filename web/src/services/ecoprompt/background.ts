import type { ImagePlanItem } from '@/types/eco-types';

export function assignBackgroundColors(items: ImagePlanItem[], palette: string[]): ImagePlanItem[] {
  const bgPool = palette.length >= 3 ? palette : ['#FFFFFF', '#F5F1E8', '#1A3A2E'];

  let lastBg = '';
  return items.map((item, i) => {
    const available = bgPool.filter((c) => c !== lastBg);
    const bgHex = available[i % available.length];
    lastBg = bgHex;
    return { ...item, bgHex };
  });
}
