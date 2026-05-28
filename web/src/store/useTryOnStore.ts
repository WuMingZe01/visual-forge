import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SKUInfo, ReferenceImage, TryOnParams, TryOnTask, TryOnResult, DetailSection } from '@/types/tryon-types';
import { DEFAULT_DETAIL_SECTIONS } from '@/types/tryon-types';

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

interface TryOnState {
  skuInfo: SKUInfo | null;
  modelImage: ReferenceImage | null;
  productFrontImage: ReferenceImage | null;
  productBackImage: ReferenceImage | null;
  tryOnParams: TryOnParams;
  tryOnResults: TryOnResult[];
  isGenerating: boolean;
  detailSections: DetailSection[];
  detailRefImage: ReferenceImage | null;

  setSkuInfo: (info: SKUInfo | null) => void;
  setModelImage: (img: ReferenceImage | null) => void;
  setProductFrontImage: (img: ReferenceImage | null) => void;
  setProductBackImage: (img: ReferenceImage | null) => void;
  setTryOnParams: (params: Partial<TryOnParams>) => void;
  setTryOnResults: (results: TryOnResult[]) => void;
  updateTryOnResult: (index: number, update: Partial<TryOnResult>) => void;
  setIsGenerating: (v: boolean) => void;
  setDetailSections: (sections: DetailSection[]) => void;
  updateDetailSection: (id: string, update: Partial<DetailSection>) => void;
  setDetailRefImage: (img: ReferenceImage | null) => void;
  resetTryOn: () => void;
}

const defaultParams: TryOnParams = {
  model: 'gpt-image-2-vip',
  resolutionRatio: '2448×3264 (3:4, 4K)',
  chinesePrompt: '',
  count: 1,
};

function createDefaultSections(): DetailSection[] {
  return DEFAULT_DETAIL_SECTIONS.map((s, i) => ({
    id: genId(),
    sortOrder: i,
    ...s,
    refImage: null,
    generatedImageUrl: '',
    status: 'idle' as const,
  }));
}

export const useTryOnStore = create<TryOnState>()(
  persist(
    (set) => ({
      skuInfo: null,
      modelImage: null,
      productFrontImage: null,
      productBackImage: null,
      tryOnParams: { ...defaultParams },
      tryOnResults: [],
      isGenerating: false,
      detailSections: createDefaultSections(),
      detailRefImage: null,

      setSkuInfo: (info) => set({ skuInfo: info }),
      setModelImage: (img) => set({ modelImage: img }),
      setProductFrontImage: (img) => set({ productFrontImage: img }),
      setProductBackImage: (img) => set({ productBackImage: img }),
      setTryOnParams: (params) => set((s) => ({ tryOnParams: { ...s.tryOnParams, ...params } })),
      setTryOnResults: (results) => set({ tryOnResults: results }),
      updateTryOnResult: (index, update) =>
        set((s) => ({
          tryOnResults: s.tryOnResults.map((r, i) => (i === index ? { ...r, ...update } : r)),
        })),
      setIsGenerating: (v) => set({ isGenerating: v }),
      setDetailSections: (sections) => set({ detailSections: sections }),
      updateDetailSection: (id, update) =>
        set((s) => ({ detailSections: s.detailSections.map((sec) => (sec.id === id ? { ...sec, ...update } : sec)) })),
      setDetailRefImage: (img) => set({ detailRefImage: img }),
      resetTryOn: () =>
        set({
          tryOnResults: [],
          isGenerating: false,
        }),
    }),
    { name: 'vf-tryon-store-v3', partialize: (s) => ({ detailSections: s.detailSections, tryOnParams: s.tryOnParams }) }
  )
);
