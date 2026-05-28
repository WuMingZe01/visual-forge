import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AIModel,
  AspectPreset,
  Resolution,
  StylePreset,
  ReferenceImage,
  ReferenceType,
  GenerateTask,
  CanvasProject,
  SystemConfig,
  DraftItem,
  ToastMessage,
  TaskStatus,
} from '@/types';
import { AI_MODELS, ASPECT_PRESETS } from '@/data/constants';
import { generateImage, optimizeChinesePrompt } from '@/services/api';

function generateId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateToastId(): string {
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

interface AppState {
  selectedModel: AIModel;
  selectedAspect: AspectPreset;
  selectedResolution: Resolution;
  selectedStyle: StylePreset | null;
  chinesePrompt: string;
  englishPrompt: string;
  negativePrompt: string;
  productImages: ReferenceImage[];
  modelImages: ReferenceImage[];
  styleStrength: number;

  taskQueue: GenerateTask[];
  taskHistory: GenerateTask[];
  drafts: DraftItem[];
  canvasProjects: CanvasProject[];

  config: SystemConfig;
  toasts: ToastMessage[];

  setModel: (model: AIModel) => void;
  setAspect: (aspect: AspectPreset) => void;
  setResolution: (resolution: Resolution) => void;
  setStyle: (style: StylePreset | null) => void;
  setChinesePrompt: (prompt: string) => void;
  setEnglishPrompt: (prompt: string) => void;
  setNegativePrompt: (prompt: string) => void;
  setStyleStrength: (strength: number) => void;

  addProductImage: (image: ReferenceImage) => void;
  removeProductImage: (id: string) => void;
  addModelImage: (image: ReferenceImage) => void;
  removeModelImage: (id: string) => void;

  addToQueue: () => GenerateTask | null;
  removeFromQueue: (id: string) => void;
  updateTaskStatus: (id: string, status: TaskStatus, resultUrls?: string[], error?: string) => void;
  updateTaskProgress: (id: string, progress: number) => void;

  submitAllTasks: () => Promise<void>;

  optimizePrompt: () => Promise<void>;

  saveDraft: (name: string) => void;
  loadDraft: (draft: DraftItem) => void;
  deleteDraft: (id: string) => void;

  addCanvasProject: (project: CanvasProject) => void;

  updateConfig: (config: Partial<SystemConfig>) => void;

  addToast: (type: ToastMessage['type'], message: string) => void;
  removeToast: (id: string) => void;

  resetConfigForm: () => void;
}

const defaultConfig: SystemConfig = {
  yunwuApiKeys: [],  // 在系统设置中配置
  yunwuBaseUrl: 'https://yunwu.ai/v1',
  grsaiApiKeys: [],  // 在系统设置中配置
  grsaiApiUrl: 'https://grsai.dakka.com.cn',
  defaultProvider: 'auto',
  defaultModelId: 'gpt-image-2',
  ossAccessKeyId: '',
  ossAccessKeySecret: '',
  ossEndpoint: 'oss-cn-beijing.aliyuncs.com',
  ossBucket: 'hermes-grsai',
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      selectedModel: AI_MODELS[0],
      selectedAspect: ASPECT_PRESETS[0],
      selectedResolution: '1K',
      selectedStyle: null,
      chinesePrompt: '',
      englishPrompt: '',
      negativePrompt: '',
      productImages: [],
      modelImages: [],
      styleStrength: 50,

      taskQueue: [],
      taskHistory: [],
      drafts: [],
      canvasProjects: [],

      config: defaultConfig,
      toasts: [],

      setModel: (model) => set({ selectedModel: model }),
      setAspect: (aspect) => set({ selectedAspect: aspect }),
      setResolution: (resolution) => set({ selectedResolution: resolution }),
      setStyle: (style) => set({ selectedStyle: style }),
      setChinesePrompt: (prompt) => set({ chinesePrompt: prompt }),
      setEnglishPrompt: (prompt) => set({ englishPrompt: prompt }),
      setNegativePrompt: (prompt) => set({ negativePrompt: prompt }),
      setStyleStrength: (strength) => set({ styleStrength: strength }),

      addProductImage: (image) => set((s) => ({ productImages: [...s.productImages, image] })),
      removeProductImage: (id) => set((s) => ({ productImages: s.productImages.filter((i) => i.id !== id) })),
      addModelImage: (image) => set((s) => ({ modelImages: [...s.modelImages, image] })),
      removeModelImage: (id) => set((s) => ({ modelImages: s.modelImages.filter((i) => i.id !== id) })),

      addToQueue: () => {
        const { selectedModel, selectedAspect, selectedResolution, selectedStyle, chinesePrompt, englishPrompt, negativePrompt, productImages, modelImages, styleStrength } = get();
        if (!chinesePrompt.trim() && !englishPrompt.trim()) return null;

        const task: GenerateTask = {
          id: generateId(),
          model: selectedModel,
          aspectPreset: selectedAspect,
          resolution: selectedResolution,
          stylePreset: selectedStyle || undefined,
          chinesePrompt,
          englishPrompt,
          negativePrompt,
          productImages: [...productImages],
          modelImages: [...modelImages],
          styleStrength,
          status: 'pending',
          progress: 0,
          resultUrls: [],
          createdAt: new Date().toISOString(),
          retryCount: 0,
        };
        set((s) => ({ taskQueue: [...s.taskQueue, task] }));
        return task;
      },

      removeFromQueue: (id) => set((s) => ({ taskQueue: s.taskQueue.filter((t) => t.id !== id) })),

      updateTaskStatus: (id, status, resultUrls, error) =>
        set((s) => ({
          taskQueue: s.taskQueue.map((t) =>
            t.id === id
              ? { ...t, status, resultUrls: resultUrls || t.resultUrls, completedAt: status === 'completed' || status === 'failed' ? new Date().toISOString() : t.completedAt, error }
              : t
          ),
        })),

      updateTaskProgress: (id, progress) =>
        set((s) => ({
          taskQueue: s.taskQueue.map((t) => (t.id === id ? { ...t, progress } : t)),
        })),

      submitAllTasks: async () => {
        const { taskQueue, config, addToast } = get();
        const pendingTasks = taskQueue.filter((t) => t.status === 'pending');

        if (pendingTasks.length === 0) return;

        for (const task of pendingTasks) {
          get().updateTaskStatus(task.id, 'generating');
          get().updateTaskProgress(task.id, 10);
          addToast('info', `正在生成: ${(task.chinesePrompt || task.englishPrompt).slice(0, 30)}`);

          try {
            const urls = await generateImage(config, task);
            get().updateTaskProgress(task.id, 100);
            get().updateTaskStatus(task.id, 'completed', urls);
            addToast('success', `生成完成: ${urls.length} 张图片`);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : '未知错误';
            get().updateTaskProgress(task.id, 0);
            get().updateTaskStatus(task.id, 'failed', undefined, msg);
            addToast('error', `生成失败: ${msg.slice(0, 80)}`);
          }
        }

        set((s) => ({
          taskHistory: [...s.taskHistory, ...s.taskQueue.filter((t) => t.status === 'completed' || t.status === 'failed')],
          taskQueue: s.taskQueue.filter((t) => t.status === 'pending'),
        }));
      },

      optimizePrompt: async () => {
        const { chinesePrompt, config, addToast, setEnglishPrompt } = get();
        if (!chinesePrompt.trim()) {
          addToast('warning', '请先输入中文提示词');
          return;
        }

        addToast('info', '正在优化翻译...');
        try {
          const result = await optimizeChinesePrompt(config, chinesePrompt);
          setEnglishPrompt(result);
          addToast('success', '翻译优化完成');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : '未知错误';
          addToast('error', `翻译失败: ${msg.slice(0, 80)}`);
        }
      },

      saveDraft: (name) => {
        const { selectedModel, selectedAspect, selectedResolution, selectedStyle, chinesePrompt, englishPrompt, negativePrompt, productImages, modelImages, styleStrength } = get();
        const task: GenerateTask = {
          id: generateId(),
          model: selectedModel,
          aspectPreset: selectedAspect,
          resolution: selectedResolution,
          stylePreset: selectedStyle || undefined,
          chinesePrompt,
          englishPrompt,
          negativePrompt,
          productImages: [...productImages],
          modelImages: [...modelImages],
          styleStrength,
          status: 'pending',
          progress: 0,
          resultUrls: [],
          createdAt: new Date().toISOString(),
          retryCount: 0,
        };
        const draft: DraftItem = { id: generateId(), task, savedAt: new Date().toISOString(), name };
        set((s) => ({ drafts: [draft, ...s.drafts] }));
      },

      loadDraft: (draft) => {
        set({
          selectedModel: draft.task.model,
          selectedAspect: draft.task.aspectPreset,
          selectedResolution: draft.task.resolution,
          selectedStyle: draft.task.stylePreset || null,
          chinesePrompt: draft.task.chinesePrompt,
          englishPrompt: draft.task.englishPrompt,
          negativePrompt: draft.task.negativePrompt,
          productImages: draft.task.productImages,
          modelImages: draft.task.modelImages,
          styleStrength: draft.task.styleStrength ?? 50,
        });
      },

      deleteDraft: (id) => set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) })),

      addCanvasProject: (project) => set((s) => ({ canvasProjects: [project, ...s.canvasProjects] })),

      updateConfig: (config) => set((s) => ({ config: { ...s.config, ...config } })),

      addToast: (type, message) => {
        const toast: ToastMessage = { id: generateToastId(), type, message };
        set((s) => ({ toasts: [...s.toasts, toast] }));
        setTimeout(() => get().removeToast(toast.id), 4000);
      },

      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      resetConfigForm: () => set((s) => ({ selectedModel: s.taskQueue.length > 0 ? s.selectedModel : AI_MODELS[0] })),
    }),
    {
      name: 'visual-forge-store',
      version: 5,
      migrate: (persisted, version) => {
        const p = persisted as Record<string, unknown>;
        const cfg = (p.config || {}) as Record<string, unknown>;
        if (version < 5) {
          cfg.yunwuApiKeys = defaultConfig.yunwuApiKeys;
          cfg.grsaiApiKeys = defaultConfig.grsaiApiKeys;
          if (cfg.grsaiApiUrl === 'http://grsai.dakka.com.cn/v1/draw/nano-banana') {
            cfg.grsaiApiUrl = defaultConfig.grsaiApiUrl;
          }
          p.config = cfg;
        }
        return p as AppState;
      },
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<AppState>),
        config: {
          ...(current as AppState).config,
          ...((persisted as Partial<AppState>)?.config ?? {}),
        },
      }),
      partialize: (state) => {
        const stripImages = (tasks: GenerateTask[]) =>
          tasks.map((t) => ({ ...t, resultUrls: [] as string[], productImages: [] as ReferenceImage[], modelImages: [] as ReferenceImage[] }));
        return {
          config: state.config,
          taskHistory: stripImages(state.taskHistory),
          drafts: state.drafts.map((d) => ({ ...d, task: { ...d.task, resultUrls: [] as string[], productImages: [] as ReferenceImage[], modelImages: [] as ReferenceImage[] } })),
          canvasProjects: state.canvasProjects,
        };
      },
    }
  )
);
