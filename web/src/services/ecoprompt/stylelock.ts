import type { StyleLockConfig, StyleLock } from '@/types/eco-types';

export const DEFAULT_STYLE_LOCK: StyleLockConfig = {
  palette: [
    { role: 'background', hex: '#FFFFFF' },
    { role: 'text_primary', hex: '#2D2D2D' },
    { role: 'accent', hex: '#D4AF37' },
    { role: 'secondary', hex: '#B0B0B0' },
  ],
  colorTemp: 'neutral',
  headingFont: 'modern geometric sans-serif (like Didot)',
  bodyFont: 'modern clean sans-serif (like SF Pro Display)',
  backgroundSystem: 'clean off-white studio background, no gradients',
  lightingSystem: 'soft diffused studio lighting, color temperature 5500K, gentle directional shadows from upper-left',
  layoutSystem: 'consistent rounded rectangular info labels with thin borders, generous whitespace, stable product scale',
  iconSystem: 'thin-line monochrome icons, consistent stroke width',
  productRules: 'stable product scale and centered placement',
  noDrift: 'no color palette changes, no mixed fonts, no random backgrounds, no inconsistent lighting, no mismatched icon styles',
};

export function assembleStyleLock(config: StyleLockConfig = DEFAULT_STYLE_LOCK): StyleLock {
  const p = config.palette;
  const bgHex = p.find((c) => c.role === 'background')?.hex || '#FFFFFF';
  const textHex = p.find((c) => c.role === 'text_primary')?.hex || '#2D2D2D';
  const accentHex = p.find((c) => c.role === 'accent')?.hex || '#D4AF37';
  const secondaryHex = p.find((c) => c.role === 'secondary')?.hex || '#B0B0B0';

  const lockText =
    `Campaign Style Lock: consistent premium ecommerce visual system ` +
    `across the entire image set; ` +
    `fixed palette of ${bgHex} background, ${textHex} text, ${accentHex} accent, ${secondaryHex} secondary; ` +
    `${config.colorTemp} color temperature; ` +
    `${config.headingFont} headings, ${config.bodyFont} body; ` +
    `${config.lightingSystem}; ${config.layoutSystem}; ${config.iconSystem}; ` +
    `${config.productRules}; ${config.noDrift}.`;

  return { config, lockText };
}
