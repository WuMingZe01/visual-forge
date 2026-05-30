import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LlmConfig {
  id: string;
  name: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  type: 'text' | 'vision';
  enabled: boolean;
  /** 模型上下文长度 (max_tokens)，默认 1M (1048576) */
  maxTokens: number;
}

const DEFAULT_CONFIGS: LlmConfig[] = [
  {
    id: 'ds-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek',
    apiKey: import.meta.env.VITE_LLM_DEEPSEEK_KEY || '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat', type: 'text', enabled: true,
    maxTokens: 1048576,
  },
  {
    id: 'mimo-vision', name: 'MiMo V2.5 多模态', provider: 'mimo',
    apiKey: import.meta.env.VITE_LLM_MIMO_KEY || 'sk-ceqaykkja91qsnxxane5qomonzfmyog3lquha9xwgfptgyk7',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5', type: 'vision', enabled: true,
    maxTokens: 1048576,
  },
  {
    id: 'kimi-vision', name: 'Kimi K2.6 多模态', provider: 'moonshot',
    apiKey: import.meta.env.VITE_LLM_KIMI_KEY || '',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6', type: 'vision', enabled: false,
    maxTokens: 1048576,
  },
];

const LS_KEY = 'vf-llm-configs-v2';

function loadDefaultsWithSaved(): LlmConfig[] {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (!saved) return [...DEFAULT_CONFIGS];
    const parsed = JSON.parse(saved) as LlmConfig[];
    const defaultIds = new Set(DEFAULT_CONFIGS.map(d => d.id));
    const merged = DEFAULT_CONFIGS.map(d => {
      const existing = parsed.find((p: LlmConfig) => p.id === d.id);
      return existing ? { ...d, apiKey: d.apiKey || existing.apiKey, maxTokens: existing.maxTokens || d.maxTokens } : d;
    });
    for (const p of parsed) {
      if (!defaultIds.has(p.id)) {
        merged.push({ ...p, maxTokens: p.maxTokens || 1048576 });
      }
    }
    return merged;
  } catch { return [...DEFAULT_CONFIGS]; }
}

interface LlmState {
  configs: LlmConfig[];
  updateConfig: (id: string, updates: Partial<LlmConfig>) => void;
  toggleEnabled: (id: string) => void;
  addConfig: (cfg: LlmConfig) => void;
  removeConfig: (id: string) => void;
  getVisionModel: () => LlmConfig | undefined;
  getTextModel: () => LlmConfig | undefined;
  getEnabledVision: () => LlmConfig[];
  getEnabledText: () => LlmConfig[];
}

export const useLlmStore = create<LlmState>()(
  persist(
    (set, get) => ({
      configs: loadDefaultsWithSaved(),

      updateConfig: (id, updates) =>
        set((s) => {
          const next = s.configs.map((c) => (c.id === id ? { ...c, ...updates } : c));
          localStorage.setItem(LS_KEY, JSON.stringify(next));
          return { configs: next };
        }),

      toggleEnabled: (id) =>
        set((s) => {
          const next = s.configs.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c));
          localStorage.setItem(LS_KEY, JSON.stringify(next));
          return { configs: next };
        }),

      addConfig: (cfg) =>
        set((s) => {
          const next = [cfg, ...s.configs];
          localStorage.setItem(LS_KEY, JSON.stringify(next));
          return { configs: next };
        }),

      removeConfig: (id) =>
        set((s) => {
          const next = s.configs.filter((c) => c.id !== id);
          localStorage.setItem(LS_KEY, JSON.stringify(next));
          return { configs: next };
        }),

      getVisionModel: () => get().configs.find((c) => c.enabled && c.type === 'vision'),
      getTextModel: () => get().configs.find((c) => c.enabled && c.type === 'text'),
      getEnabledVision: () => get().configs.filter((c) => c.enabled && c.type === 'vision'),
      getEnabledText: () => get().configs.filter((c) => c.enabled && c.type === 'text'),
    }),
    {
      name: 'vf-llm-store-v3',
      partialize: (state) => ({ configs: state.configs }),
      onRehydrateStorage: () => (state) => {
        if (state && state.configs.length > 0) localStorage.setItem(LS_KEY, JSON.stringify(state.configs));
      },
    }
  )
);
