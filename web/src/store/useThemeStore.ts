import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeId = 'cyber' | 'forest' | 'sunset' | 'midnight' | 'light';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  gradient: string;
  vars: Record<string, string>;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'cyber', name: '赛博暗蓝', description: '深邃科技 · 霓虹青点缀',
    gradient: 'from-cyan-400 via-blue-500 to-indigo-600',
    vars: {
      '--forge-bg': '#0a0e1a',
      '--forge-surface': '#11162a',
      '--forge-surface2': '#192040',
      '--forge-border': '#252d4a',
      '--forge-cyan': '#22d3ee',
      '--forge-orange': '#f97316',
      '--forge-text': '#e8ebf5',
      '--forge-text2': '#8b90b8',
      '--forge-green': '#34d399',
      '--forge-red': '#f87171',
    },
  },
  {
    id: 'forest', name: '松石深林', description: '沉静绿意 · 暖金高光',
    gradient: 'from-emerald-500 via-teal-600 to-amber-500',
    vars: {
      '--forge-bg': '#0c1914',
      '--forge-surface': '#12231c',
      '--forge-surface2': '#173025',
      '--forge-border': '#1e3e2f',
      '--forge-cyan': '#6ee7b7',
      '--forge-orange': '#fbbf24',
      '--forge-text': '#e2ede6',
      '--forge-text2': '#7da890',
      '--forge-green': '#4ade80',
      '--forge-red': '#fca5a5',
    },
  },
  {
    id: 'sunset', name: '暮光暖紫', description: '温暖晚霞 · 琥珀柔光',
    gradient: 'from-purple-500 via-pink-500 to-amber-500',
    vars: {
      '--forge-bg': '#1c111a',
      '--forge-surface': '#2a1a26',
      '--forge-surface2': '#382332',
      '--forge-border': '#4d3142',
      '--forge-cyan': '#f0abfc',
      '--forge-orange': '#fb923c',
      '--forge-text': '#efe2ea',
      '--forge-text2': '#b495a8',
      '--forge-green': '#bef264',
      '--forge-red': '#fca5a5',
    },
  },
  {
    id: 'midnight', name: '纯黑极简', description: '极致对比 · 冷白光感',
    gradient: 'from-zinc-400 via-gray-500 to-zinc-600',
    vars: {
      '--forge-bg': '#050508',
      '--forge-surface': '#0e0e11',
      '--forge-surface2': '#18181b',
      '--forge-border': '#27272a',
      '--forge-cyan': '#e4e4e7',
      '--forge-orange': '#a1a1aa',
      '--forge-text': '#ececed',
      '--forge-text2': '#71717a',
      '--forge-green': '#86efac',
      '--forge-red': '#fca5a5',
    },
  },
  {
    id: 'light', name: '霜白晨曦', description: '明亮清透 · 天空蓝点缀',
    gradient: 'from-sky-400 via-blue-400 to-indigo-400',
    vars: {
      '--forge-bg': '#f0f2f5',
      '--forge-surface': '#ffffff',
      '--forge-surface2': '#e8ecf0',
      '--forge-border': '#d4d8df',
      '--forge-cyan': '#2563eb',
      '--forge-orange': '#ea580c',
      '--forge-text': '#111827',
      '--forge-text2': '#6b7280',
      '--forge-green': '#059669',
      '--forge-red': '#dc2626',
    },
  },
];

interface ThemeState {
  current: ThemeId;
  setTheme: (id: ThemeId) => void;
  applyTheme: (id: ThemeId) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      current: 'cyber',
      setTheme: (id) => { set({ current: id }); get().applyTheme(id); },
      applyTheme: (id) => {
        const theme = THEMES.find((t) => t.id === id) || THEMES[0];
        const root = document.documentElement;
        for (const [key, value] of Object.entries(theme.vars)) {
          root.style.setProperty(key, value);
        }
      },
    }),
    {
      name: 'vf-theme-v2',
      partialize: (s) => ({ current: s.current }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const t = THEMES.find((x) => x.id === state.current) || THEMES[0];
          for (const [k, v] of Object.entries(t.vars)) document.documentElement.style.setProperty(k, v);
        }
      },
    }
  )
);
