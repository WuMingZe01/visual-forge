import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TemplateEntry } from '@/types/tryon-types';

function getDefaultTemplates(): TemplateEntry[] {
  const now = '2026-05-28T10:00:00.000Z';
  const POSE_TOPS = [{id:"pose_tops_1",name:"1.jpg",size:4154,dataUrl:"/templates/pose/tops/1.jpg"},{id:"pose_tops_2",name:"2.jpg",size:2845,dataUrl:"/templates/pose/tops/2.jpg"},{id:"pose_tops_3",name:"3.jpg",size:2926,dataUrl:"/templates/pose/tops/3.jpg"},{id:"pose_tops_4",name:"4.jpg",size:3774,dataUrl:"/templates/pose/tops/4.jpg"},{id:"pose_tops_5",name:"5.jpg",size:4846,dataUrl:"/templates/pose/tops/5.jpg"},{id:"pose_tops_6",name:"6.jpg",size:3034,dataUrl:"/templates/pose/tops/6.jpg"},{id:"pose_tops_7",name:"7.jpg",size:4447,dataUrl:"/templates/pose/tops/7.jpg"}];
  const POSE_BOTTOMS = [{id:"pose_bottoms_1",name:"1.jpg",size:2770,dataUrl:"/templates/pose/bottoms/1.jpg"},{id:"pose_bottoms_2",name:"2.jpg",size:3107,dataUrl:"/templates/pose/bottoms/2.jpg"},{id:"pose_bottoms_3",name:"3.jpg",size:3040,dataUrl:"/templates/pose/bottoms/3.jpg"},{id:"pose_bottoms_4",name:"4.jpg",size:3046,dataUrl:"/templates/pose/bottoms/4.jpg"},{id:"pose_bottoms_5",name:"5.jpg",size:4538,dataUrl:"/templates/pose/bottoms/5.jpg"},{id:"pose_bottoms_6",name:"6.jpg",size:2712,dataUrl:"/templates/pose/bottoms/6.jpg"},{id:"pose_bottoms_7",name:"7.jpg",size:4013,dataUrl:"/templates/pose/bottoms/7.jpg"}];
  const DETAIL_TOPS = [{id:"detail_tops_BM25B066CM-01",name:"BM25B066CM-01.jpg",size:3629,dataUrl:"/templates/detail/tops/BM25B066CM-01.jpg"},{id:"detail_tops_BM25B066CM-02",name:"BM25B066CM-02.jpg",size:4999,dataUrl:"/templates/detail/tops/BM25B066CM-02.jpg"},{id:"detail_tops_BM25B066CM-03",name:"BM25B066CM-03.jpg",size:3993,dataUrl:"/templates/detail/tops/BM25B066CM-03.jpg"},{id:"detail_tops_BM25B066CM-04",name:"BM25B066CM-04.jpg",size:4730,dataUrl:"/templates/detail/tops/BM25B066CM-04.jpg"},{id:"detail_tops_BM25B066CM-05",name:"BM25B066CM-05.jpg",size:4361,dataUrl:"/templates/detail/tops/BM25B066CM-05.jpg"},{id:"detail_tops_BM25B066CM-06",name:"BM25B066CM-06.jpg",size:4143,dataUrl:"/templates/detail/tops/BM25B066CM-06.jpg"},{id:"detail_tops_BM25B066CM-07",name:"BM25B066CM-07.jpg",size:5880,dataUrl:"/templates/detail/tops/BM25B066CM-07.jpg"},{id:"detail_tops_BM25B066CM-08",name:"BM25B066CM-08.jpg",size:4181,dataUrl:"/templates/detail/tops/BM25B066CM-08.jpg"},{id:"detail_tops_BM25B066CM-09",name:"BM25B066CM-09.jpg",size:5954,dataUrl:"/templates/detail/tops/BM25B066CM-09.jpg"},{id:"detail_tops_BM25B066CM-10",name:"BM25B066CM-10.jpg",size:5668,dataUrl:"/templates/detail/tops/BM25B066CM-10.jpg"},{id:"detail_tops_BM25B066CM-11",name:"BM25B066CM-11.jpg",size:4190,dataUrl:"/templates/detail/tops/BM25B066CM-11.jpg"},{id:"detail_tops_BM25B066CM-12",name:"BM25B066CM-12.jpg",size:3538,dataUrl:"/templates/detail/tops/BM25B066CM-12.jpg"},{id:"detail_tops_BM25B066CM-13",name:"BM25B066CM-13.jpg",size:2897,dataUrl:"/templates/detail/tops/BM25B066CM-13.jpg"},{id:"detail_tops_BM25B066CM-14",name:"BM25B066CM-14.jpg",size:3284,dataUrl:"/templates/detail/tops/BM25B066CM-14.jpg"},{id:"detail_tops_BM25B066CM-15",name:"BM25B066CM-15.jpg",size:2895,dataUrl:"/templates/detail/tops/BM25B066CM-15.jpg"},{id:"detail_tops_BM25B066CM-16",name:"BM25B066CM-16.jpg",size:2947,dataUrl:"/templates/detail/tops/BM25B066CM-16.jpg"},{id:"detail_tops_BM25B066CM-17",name:"BM25B066CM-17.jpg",size:3026,dataUrl:"/templates/detail/tops/BM25B066CM-17.jpg"},{id:"detail_tops_BM25B066CM-18",name:"BM25B066CM-18.jpg",size:2881,dataUrl:"/templates/detail/tops/BM25B066CM-18.jpg"},{id:"detail_tops_BM25B066CM-19",name:"BM25B066CM-19.jpg",size:2978,dataUrl:"/templates/detail/tops/BM25B066CM-19.jpg"}];
  const DETAIL_BOTTOMS = [{id:"detail_bottoms_BM26A039CM_01",name:"BM26A039CM_01.jpg",size:2873,dataUrl:"/templates/detail/bottoms/BM26A039CM_01.jpg"},{id:"detail_bottoms_BM26A039CM_02",name:"BM26A039CM_02.jpg",size:3916,dataUrl:"/templates/detail/bottoms/BM26A039CM_02.jpg"},{id:"detail_bottoms_BM26A039CM_03",name:"BM26A039CM_03.jpg",size:3651,dataUrl:"/templates/detail/bottoms/BM26A039CM_03.jpg"},{id:"detail_bottoms_BM26A039CM_04",name:"BM26A039CM_04.jpg",size:2922,dataUrl:"/templates/detail/bottoms/BM26A039CM_04.jpg"},{id:"detail_bottoms_BM26A039CM_05",name:"BM26A039CM_05.jpg",size:4686,dataUrl:"/templates/detail/bottoms/BM26A039CM_05.jpg"},{id:"detail_bottoms_BM26A039CM_06",name:"BM26A039CM_06.jpg",size:4185,dataUrl:"/templates/detail/bottoms/BM26A039CM_06.jpg"},{id:"detail_bottoms_BM26A039CM_07",name:"BM26A039CM_07.jpg",size:2885,dataUrl:"/templates/detail/bottoms/BM26A039CM_07.jpg"},{id:"detail_bottoms_BM26A039CM_08",name:"BM26A039CM_08.jpg",size:2245,dataUrl:"/templates/detail/bottoms/BM26A039CM_08.jpg"},{id:"detail_bottoms_BM26A039CM_09",name:"BM26A039CM_09.jpg",size:3298,dataUrl:"/templates/detail/bottoms/BM26A039CM_09.jpg"},{id:"detail_bottoms_BM26A039CM_10",name:"BM26A039CM_10.jpg",size:2671,dataUrl:"/templates/detail/bottoms/BM26A039CM_10.jpg"},{id:"detail_bottoms_BM26A039CM_11",name:"BM26A039CM_11.jpg",size:2956,dataUrl:"/templates/detail/bottoms/BM26A039CM_11.jpg"},{id:"detail_bottoms_BM26A039CM_12",name:"BM26A039CM_12.jpg",size:2867,dataUrl:"/templates/detail/bottoms/BM26A039CM_12.jpg"},{id:"detail_bottoms_BM26A039CM_13",name:"BM26A039CM_13.jpg",size:2401,dataUrl:"/templates/detail/bottoms/BM26A039CM_13.jpg"},{id:"detail_bottoms_BM26A039CM_14",name:"BM26A039CM_14.jpg",size:3022,dataUrl:"/templates/detail/bottoms/BM26A039CM_14.jpg"},{id:"detail_bottoms_BM26A039CM_15",name:"BM26A039CM_15.jpg",size:3380,dataUrl:"/templates/detail/bottoms/BM26A039CM_15.jpg"},{id:"detail_bottoms_BM26A039CM_16",name:"BM26A039CM_16.jpg",size:3147,dataUrl:"/templates/detail/bottoms/BM26A039CM_16.jpg"},{id:"detail_bottoms_BM26A039CM_17",name:"BM26A039CM_17.jpg",size:2868,dataUrl:"/templates/detail/bottoms/BM26A039CM_17.jpg"}];

  return [
    { id: 'default_main_tops', name: '主图-上装标准', type: 'main', garmentCategory: 'tops', description: '正面全身, 纯白背景, 棚拍灯光, 4K超清', promptTemplate: '服装电商主图，模特穿着{sku}款服装，正面全身展示，纯白背景，柔和棚拍灯光，4K超清画质，中文标识', refImages: [], createdAt: now, updatedAt: now },
    { id: 'default_main_bottoms', name: '主图-下装标准', type: 'main', garmentCategory: 'bottoms', description: '正面全身, 纯白背景, 棚拍灯光, 4K超清', promptTemplate: '服装电商主图，模特穿着{sku}款下装，正面全身展示，纯白背景，柔和棚拍灯光，4K超清画质，中文标识', refImages: [], createdAt: now, updatedAt: now },
    { id: 'default_pose_tops', name: '裂变-上装7姿势', type: 'pose', garmentCategory: 'tops', description: '上装7个标准姿势裂变模板 (已含7张参考图)', promptTemplate: '服装电商姿势展示，模特穿着{sku}款服装，纯白背景，4K超清画质，中文标识', refImages: POSE_TOPS, createdAt: now, updatedAt: now },
    { id: 'default_pose_bottoms', name: '裂变-下装7姿势', type: 'pose', garmentCategory: 'bottoms', description: '下装7个标准姿势裂变模板 (已含7张参考图)', promptTemplate: '服装电商姿势展示，模特穿着{sku}款下装，纯白背景，4K超清画质，中文标识', refImages: POSE_BOTTOMS, createdAt: now, updatedAt: now },
    { id: 'default_detail_tops', name: '详情-上装19图', type: 'detail', garmentCategory: 'tops', description: '上装详情页19个布局模板 (已含19张参考图)', promptTemplate: '电商详情页，模特穿着{sku}款服装，纯白棚拍，4K超清画质，中文标注卖点、材质、尺码信息', refImages: DETAIL_TOPS, createdAt: now, updatedAt: now },
    { id: 'default_detail_bottoms', name: '详情-下装17图', type: 'detail', garmentCategory: 'bottoms', description: '下装详情页17个布局模板 (已含17张参考图)', promptTemplate: '电商详情页，模特穿着{sku}款下装，纯白棚拍，4K超清画质，中文标注卖点、材质、尺码信息', refImages: DETAIL_BOTTOMS, createdAt: now, updatedAt: now },
  ];
}

interface TemplateState {
  templates: TemplateEntry[];
  addTemplate: (t: TemplateEntry) => void;
  updateTemplate: (id: string, updates: Partial<TemplateEntry>) => void;
  removeTemplate: (id: string) => void;
  getByType: (type: TemplateEntry['type'], garmentCat?: TemplateEntry['garmentCategory']) => TemplateEntry[];
}

export const useTemplateStore = create<TemplateState>()(
  persist(
    (set, get) => ({
      templates: getDefaultTemplates(),

      addTemplate: (t) => set((s) => ({ templates: [t, ...s.templates] })),

      updateTemplate: (id, updates) =>
        set((s) => ({
          templates: s.templates.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        })),

      removeTemplate: (id) =>
        set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),

      getByType: (type, garmentCat) =>
        get().templates.filter(
          (t) => t.type === type && (!garmentCat || t.garmentCategory === garmentCat)
        ),
    }),
    { name: 'vf-template-store-v2' }
  )
);
