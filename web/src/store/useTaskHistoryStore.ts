import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '@/services/idbStorage';

export type TaskType = 'tryon' | 'detail' | 'general';
export type TaskStatus = 'generating' | 'completed' | 'failed' | 'partial';

export interface TaskRecord {
  id: string;
  type: TaskType;
  skuCode: string;
  productName: string;
  modelId: string;
  provider: string;
  prompt: string;
  params: Record<string, unknown>;
  status: TaskStatus;
  progress: number;
  resultUrls: string[];
  referenceUrls: string[];
  error: string;
  /** Mimo 自动校验报告 */
  validationReport?: string;
  createdAt: string;
  completedAt?: string;
  batchId?: string;
  batchLabel?: string;
}

/** 持久化版本：保留 resultUrls（HTTPS URL 短字符串），去掉 referenceUrls（blob URL 不持久化） */
interface PersistedTaskRecord {
  id: string; type: TaskType; skuCode: string; productName: string;
  modelId: string; provider: string; prompt: string;
  params: Record<string, unknown>; status: TaskStatus; progress: number;
  resultUrls: string[]; error: string;
  createdAt: string; completedAt?: string; batchId?: string; batchLabel?: string;
}

interface TaskHistoryState {
  tasks: TaskRecord[];
  addTask: (task: TaskRecord) => void;
  updateTask: (id: string, updates: Partial<TaskRecord>) => void;
  removeTask: (id: string) => void;
  clearHistory: () => void;
}

// 清理旧的 localStorage 副本（已迁移到 IndexedDB）
try { localStorage.removeItem('vf-task-history-v1'); } catch {}

export const useTaskHistoryStore = create<TaskHistoryState>()(
  persist(
    (set) => ({
      tasks: [],

      addTask: (task) =>
        set((s) => ({
          tasks: [task, ...s.tasks].slice(0, 200),
        })),

      updateTask: (id, updates) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        })),

      removeTask: (id) =>
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
        })),

      clearHistory: () => set({ tasks: [] }),
    }),
    {
      name: 'vf-task-history-v3',
      storage: createJSONStorage(() => idbStorage),
      version: 3,
      partialize: (state) => ({
        tasks: state.tasks.slice(0, 100).map((t): PersistedTaskRecord => ({
          id: t.id, type: t.type, skuCode: t.skuCode, productName: t.productName,
          modelId: t.modelId, provider: t.provider, prompt: t.prompt.slice(0, 500),
          params: t.params, status: t.status, progress: t.progress,
          resultUrls: t.resultUrls.slice(0, 20), error: t.error.slice(0, 500),
          createdAt: t.createdAt, completedAt: t.completedAt, batchId: t.batchId, batchLabel: t.batchLabel,
        })),
      }),
      merge: (persisted, current) => {
        const saved = (persisted as { tasks?: PersistedTaskRecord[] })?.tasks || [];
        const mergedTasks: TaskRecord[] = saved.map((pt) => ({
          ...pt,
          prompt: pt.prompt || '',
          error: pt.error || '',
          resultUrls: pt.resultUrls || [],
          referenceUrls: [],
        }));
        return { ...current, tasks: mergedTasks };
      },
      migrate: (persisted: unknown, _version: number) => {
        // v1→v2: 清理可能存在的旧格式数据
        const old = persisted as { tasks?: unknown[] };
        return { tasks: (old?.tasks || []).slice(0, 100) };
      },
    }
  )
);
