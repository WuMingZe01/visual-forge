import { create } from 'zustand';
import type {
  ProductInputData, DriverDiagnosis, StyleLock, StyleLockConfig,
  ImagePlanItem, FullImagePlan, AssembledPrompt,
} from '@/types/eco-types';
import { diagnoseDriver } from '@/services/ecoprompt/driver';
import { assembleStyleLock, DEFAULT_STYLE_LOCK } from '@/services/ecoprompt/stylelock';
import { buildEcoPrompts } from '@/services/ecoprompt';

function generateToastId(): string {
  return `eco_toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

interface EcoState {
  productInput: ProductInputData;
  driverResult: DriverDiagnosis | null;
  styleLock: StyleLock | null;
  styleLockConfig: StyleLockConfig;
  imagePlan: ImagePlanItem[];
  fullPlan: FullImagePlan | null;
  prompts: AssembledPrompt[];
  isGenerating: boolean;
  generatingScreenId: string | null;
  generatedResults: Record<string, string[]>;
  toastQueue: ToastMessage[];

  setProductInput: (input: Partial<ProductInputData>) => void;
  addSellingPoint: (point: string) => void;
  removeSellingPoint: (index: number) => void;
  setDriverResult: (result: DriverDiagnosis) => void;
  runDiagnosis: () => void;
  setStyleLockConfig: (config: Partial<StyleLockConfig>) => void;
  setStyleLock: (lock: StyleLock) => void;
  runStyleLock: () => void;
  setFullPlan: (plan: FullImagePlan) => void;
  setPrompts: (prompts: AssembledPrompt[]) => void;
  runFullPlan: () => void;
  setIsGenerating: (v: boolean) => void;
  setGeneratingScreenId: (id: string | null) => void;
  setGeneratedResult: (screenId: string, urls: string[]) => void;
  setBatchResults: (results: Record<string, string[]>) => void;
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
  removeToast: (id: string) => void;
  resetAll: () => void;
}

const defaultProductInput: ProductInputData = {
  category: '',
  sellingPoints: [],
  targetAudience: '',
  proofAssets: '',
};

// 启动时从 localStorage 恢复策略中心数据
function loadPersisted(): Partial<EcoState> {
  try {
    const raw = localStorage.getItem('vf-eco-data');
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export const useEcoStore = create<EcoState>()((set, get) => {
  const persisted = loadPersisted();
  return {
  productInput: persisted.productInput || { ...defaultProductInput },
  driverResult: persisted.driverResult || null,
  styleLock: persisted.styleLock || null,
  styleLockConfig: persisted.styleLockConfig || { ...DEFAULT_STYLE_LOCK },
  imagePlan: persisted.imagePlan || [],
  fullPlan: persisted.fullPlan || null,
  prompts: persisted.prompts || [],
  generatedResults: persisted.generatedResults || {},
  isGenerating: false,
  generatingScreenId: null,
  toastQueue: [],

  setProductInput: (input) => set((s) => ({ productInput: { ...s.productInput, ...input } })),

  addSellingPoint: (point) =>
    set((s) => ({
      productInput: {
        ...s.productInput,
        sellingPoints: [...s.productInput.sellingPoints, point],
      },
    })),

  removeSellingPoint: (index) =>
    set((s) => ({
      productInput: {
        ...s.productInput,
        sellingPoints: s.productInput.sellingPoints.filter((_, i) => i !== index),
      },
    })),

  setDriverResult: (result) => set({ driverResult: result }),

  runDiagnosis: () => {
    const { productInput } = get();
    const result = diagnoseDriver(productInput);
    set({ driverResult: result });
  },

  setStyleLockConfig: (config) =>
    set((s) => ({
      styleLockConfig: { ...s.styleLockConfig, ...config },
    })),

  setStyleLock: (lock) => set({ styleLock: lock }),

  runStyleLock: () => {
    const { styleLockConfig } = get();
    const result = assembleStyleLock(styleLockConfig);
    set({ styleLock: result });
  },

  setFullPlan: (plan) => set({ fullPlan: plan }),

  setPrompts: (prompts) => set({ prompts }),

  runFullPlan: () => {
    const { productInput, styleLockConfig } = get();
    const result = buildEcoPrompts({ product: productInput, styleLockConfig });
    set({
      driverResult: result.driverResult,
      styleLock: result.styleLock,
      fullPlan: result.fullPlan,
      imagePlan: result.fullPlan.items,
      prompts: result.prompts,
    });
  },

  setIsGenerating: (v) => set({ isGenerating: v }),

  setGeneratingScreenId: (id) => set({ generatingScreenId: id }),

  setGeneratedResult: (screenId, urls) =>
    set((s) => ({
      generatedResults: { ...s.generatedResults, [screenId]: urls },
    })),

  setBatchResults: (results) =>
    set((s) => ({
      generatedResults: { ...s.generatedResults, ...results },
    })),

  addToast: (type, message) => {
    const toast: ToastMessage = { id: generateToastId(), type, message };
    set((s) => ({ toastQueue: [...s.toastQueue, toast] }));
    setTimeout(() => get().removeToast(toast.id), 4000);
  },

  removeToast: (id) =>
    set((s) => ({ toastQueue: s.toastQueue.filter((t) => t.id !== id) })),

  resetAll: () =>
    set({
      productInput: { ...defaultProductInput },
      driverResult: null,
      styleLock: null,
      styleLockConfig: { ...DEFAULT_STYLE_LOCK },
      imagePlan: [],
      fullPlan: null,
      prompts: [],
      isGenerating: false,
      generatingScreenId: null,
      generatedResults: {},
    }),
  };
});

// 自动持久化策略中心关键数据
useEcoStore.subscribe((state) => {
  try {
    localStorage.setItem('vf-eco-data', JSON.stringify({
      productInput: state.productInput,
      driverResult: state.driverResult,
      styleLock: state.styleLock,
      styleLockConfig: state.styleLockConfig,
      imagePlan: state.imagePlan,
      fullPlan: state.fullPlan,
      prompts: state.prompts,
      generatedResults: state.generatedResults,
    }));
  } catch {}
});
