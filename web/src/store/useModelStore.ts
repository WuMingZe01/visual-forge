import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModelEntry } from '@/types/tryon-types';

function getDefaultModels(): ModelEntry[] {
  const now = '2026-05-28T10:00:00.000Z';
  return [
    {
      id: 'default_tops_model',
      name: '上装男模-默认',
      category: 'tops',
      previewUrl: '/models/model_tops.jpg',
      originalName: '上装主图参考.jpg',
      size: 1471447,
      description: '青年男模，黑色短发，硬朗脸型，匀称体格',
      tags: ['男模', '上装', '默认'],
      createdAt: now,
    },
    {
      id: 'default_bottoms_model',
      name: '下装男模-默认',
      category: 'bottoms',
      previewUrl: '/models/model_bottoms.jpg',
      originalName: '下装主图参考.jpg',
      size: 625664,
      description: '瘦高男模，浅肤色，左手腕智能手表',
      tags: ['男模', '下装', '默认'],
      createdAt: now,
    },
  ];
}

interface ModelState {
  models: ModelEntry[];
  addModel: (m: ModelEntry) => void;
  updateModel: (id: string, updates: Partial<ModelEntry>) => void;
  removeModel: (id: string) => void;
  getByCategory: (cat: 'tops' | 'bottoms') => ModelEntry[];
}

export const useModelStore = create<ModelState>()(
  persist(
    (set, get) => ({
      models: getDefaultModels(),

      addModel: (m) => set((s) => ({ models: [m, ...s.models] })),

      updateModel: (id, updates) =>
        set((s) => ({
          models: s.models.map((m) => (m.id === id ? { ...m, ...updates } : m)),
        })),

      removeModel: (id) =>
        set((s) => ({ models: s.models.filter((m) => m.id !== id) })),

      getByCategory: (cat) =>
        get().models.filter((m) => m.category === cat || m.category === 'both' || m.category === 'general'),
    }),
    { name: 'vf-model-store' }
  )
);
