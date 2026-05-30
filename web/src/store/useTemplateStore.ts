import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TemplateEntry } from '@/types/tryon-types';

function getDefaultTemplates(): TemplateEntry[] {
  const now = '2026-05-28T10:00:00.000Z';
  const poseLabels = [
    '正面站立，双手自然垂放，视线直视镜头',
    '侧身45度展示轮廓线条，单手优雅摆放',
    '自然行走动态抓拍，双手轻微摆动',
    '优雅坐姿，身体微倾，自然光线',
    '半身特写，展示领口和肩部细节',
    '背对镜头转身回眸，展示背面设计',
    '靠墙站立，一腿微曲，展示垂坠感',
  ];
  const POSE_TOPS: {id:string;name:string;size:number;dataUrl:string;prompt:string}[] = [
    {id:"pose_tops_1",name:"1.jpg",size:4154,dataUrl:"/templates/pose/tops/1.jpg",prompt:poseLabels[0]},
    {id:"pose_tops_2",name:"2.jpg",size:2845,dataUrl:"/templates/pose/tops/2.jpg",prompt:poseLabels[1]},
    {id:"pose_tops_3",name:"3.jpg",size:2926,dataUrl:"/templates/pose/tops/3.jpg",prompt:poseLabels[2]},
    {id:"pose_tops_4",name:"4.jpg",size:3774,dataUrl:"/templates/pose/tops/4.jpg",prompt:poseLabels[3]},
    {id:"pose_tops_5",name:"5.jpg",size:4846,dataUrl:"/templates/pose/tops/5.jpg",prompt:poseLabels[4]},
    {id:"pose_tops_6",name:"6.jpg",size:3034,dataUrl:"/templates/pose/tops/6.jpg",prompt:poseLabels[5]},
    {id:"pose_tops_7",name:"7.jpg",size:4447,dataUrl:"/templates/pose/tops/7.jpg",prompt:poseLabels[6]},
  ];
  const POSE_BOTTOMS: {id:string;name:string;size:number;dataUrl:string;prompt:string}[] = [
    {id:"pose_bottoms_1",name:"1.jpg",size:2770,dataUrl:"/templates/pose/bottoms/1.jpg",prompt:"正面站立展示裤装整体效果"},
    {id:"pose_bottoms_2",name:"2.jpg",size:3107,dataUrl:"/templates/pose/bottoms/2.jpg",prompt:"侧身展示裤装侧面轮廓线条"},
    {id:"pose_bottoms_3",name:"3.jpg",size:3040,dataUrl:"/templates/pose/bottoms/3.jpg",prompt:"行走动态展示裤装活动效果"},
    {id:"pose_bottoms_4",name:"4.jpg",size:3046,dataUrl:"/templates/pose/bottoms/4.jpg",prompt:"坐姿展示裤装版型和垂坠感"},
    {id:"pose_bottoms_5",name:"5.jpg",size:4538,dataUrl:"/templates/pose/bottoms/5.jpg",prompt:"半身特写展示裤装腰头和口袋细节"},
    {id:"pose_bottoms_6",name:"6.jpg",size:2712,dataUrl:"/templates/pose/bottoms/6.jpg",prompt:"背面展示裤装后袋和后腰设计"},
    {id:"pose_bottoms_7",name:"7.jpg",size:4013,dataUrl:"/templates/pose/bottoms/7.jpg",prompt:"休闲侧靠展示裤装廓形和面料质感"},
  ];
  const detailLabels = [
    '首屏承接-正面全身展示',
    '面料材质近距离特写',
    '领口/肩部细节展示',
    '袖口/下摆设计特写',
    '纽扣/拉链等辅料细节',
    '印花/刺绣/logo特写',
    '缝线/拼接工艺展示',
    '背面整体展示',
    '侧面版型轮廓展示',
    '多色对比陈列',
    '尺码参考信息图',
    '搭配推荐展示',
    '穿着场景化展示',
    '面料透气/弹性功能展示',
    '口袋/收纳细节',
    '里料/内衬展示',
    '吊牌/洗唛/认证标识',
    '包装/开箱展示',
    '模特身材参考标注',
  ];
  const DETAIL_TOPS = [
    {id:"detail_tops_BM25B066CM-01",name:"BM25B066CM-01.jpg",size:3629,dataUrl:"/templates/detail/tops/BM25B066CM-01.jpg",prompt:detailLabels[0]},
    {id:"detail_tops_BM25B066CM-02",name:"BM25B066CM-02.jpg",size:4999,dataUrl:"/templates/detail/tops/BM25B066CM-02.jpg",prompt:detailLabels[1]},
    {id:"detail_tops_BM25B066CM-03",name:"BM25B066CM-03.jpg",size:3993,dataUrl:"/templates/detail/tops/BM25B066CM-03.jpg",prompt:detailLabels[2]},
    {id:"detail_tops_BM25B066CM-04",name:"BM25B066CM-04.jpg",size:4730,dataUrl:"/templates/detail/tops/BM25B066CM-04.jpg",prompt:detailLabels[3]},
    {id:"detail_tops_BM25B066CM-05",name:"BM25B066CM-05.jpg",size:4361,dataUrl:"/templates/detail/tops/BM25B066CM-05.jpg",prompt:detailLabels[4]},
    {id:"detail_tops_BM25B066CM-06",name:"BM25B066CM-06.jpg",size:4143,dataUrl:"/templates/detail/tops/BM25B066CM-06.jpg",prompt:detailLabels[5]},
    {id:"detail_tops_BM25B066CM-07",name:"BM25B066CM-07.jpg",size:5880,dataUrl:"/templates/detail/tops/BM25B066CM-07.jpg",prompt:detailLabels[6]},
    {id:"detail_tops_BM25B066CM-08",name:"BM25B066CM-08.jpg",size:4181,dataUrl:"/templates/detail/tops/BM25B066CM-08.jpg",prompt:detailLabels[7]},
    {id:"detail_tops_BM25B066CM-09",name:"BM25B066CM-09.jpg",size:5954,dataUrl:"/templates/detail/tops/BM25B066CM-09.jpg",prompt:detailLabels[8]},
    {id:"detail_tops_BM25B066CM-10",name:"BM25B066CM-10.jpg",size:5668,dataUrl:"/templates/detail/tops/BM25B066CM-10.jpg",prompt:detailLabels[9]},
    {id:"detail_tops_BM25B066CM-11",name:"BM25B066CM-11.jpg",size:4190,dataUrl:"/templates/detail/tops/BM25B066CM-11.jpg",prompt:detailLabels[10]},
    {id:"detail_tops_BM25B066CM-12",name:"BM25B066CM-12.jpg",size:3538,dataUrl:"/templates/detail/tops/BM25B066CM-12.jpg",prompt:detailLabels[11]},
    {id:"detail_tops_BM25B066CM-13",name:"BM25B066CM-13.jpg",size:2897,dataUrl:"/templates/detail/tops/BM25B066CM-13.jpg",prompt:detailLabels[12]},
    {id:"detail_tops_BM25B066CM-14",name:"BM25B066CM-14.jpg",size:3284,dataUrl:"/templates/detail/tops/BM25B066CM-14.jpg",prompt:detailLabels[13]},
    {id:"detail_tops_BM25B066CM-15",name:"BM25B066CM-15.jpg",size:2895,dataUrl:"/templates/detail/tops/BM25B066CM-15.jpg",prompt:detailLabels[14]},
    {id:"detail_tops_BM25B066CM-16",name:"BM25B066CM-16.jpg",size:2947,dataUrl:"/templates/detail/tops/BM25B066CM-16.jpg",prompt:detailLabels[15]},
    {id:"detail_tops_BM25B066CM-17",name:"BM25B066CM-17.jpg",size:3026,dataUrl:"/templates/detail/tops/BM25B066CM-17.jpg",prompt:detailLabels[16]},
    {id:"detail_tops_BM25B066CM-18",name:"BM25B066CM-18.jpg",size:2881,dataUrl:"/templates/detail/tops/BM25B066CM-18.jpg",prompt:detailLabels[17]},
    {id:"detail_tops_BM25B066CM-19",name:"BM25B066CM-19.jpg",size:2978,dataUrl:"/templates/detail/tops/BM25B066CM-19.jpg",prompt:detailLabels[18]},
  ];
  const DETAIL_BOTTOMS = [
    {id:"detail_bottoms_BM26A039CM_01",name:"BM26A039CM_01.jpg",size:2873,dataUrl:"/templates/detail/bottoms/BM26A039CM_01.jpg",prompt:"首屏承接-正面裤装整体展示"},
    {id:"detail_bottoms_BM26A039CM_02",name:"BM26A039CM_02.jpg",size:3916,dataUrl:"/templates/detail/bottoms/BM26A039CM_02.jpg",prompt:"面料材质近距离特写"},
    {id:"detail_bottoms_BM26A039CM_03",name:"BM26A039CM_03.jpg",size:3651,dataUrl:"/templates/detail/bottoms/BM26A039CM_03.jpg",prompt:"腰头/腰带环细节展示"},
    {id:"detail_bottoms_BM26A039CM_04",name:"BM26A039CM_04.jpg",size:2922,dataUrl:"/templates/detail/bottoms/BM26A039CM_04.jpg",prompt:"前口袋/拉链门襟特写"},
    {id:"detail_bottoms_BM26A039CM_05",name:"BM26A039CM_05.jpg",size:4686,dataUrl:"/templates/detail/bottoms/BM26A039CM_05.jpg",prompt:"后袋/后育克设计展示"},
    {id:"detail_bottoms_BM26A039CM_06",name:"BM26A039CM_06.jpg",size:4185,dataUrl:"/templates/detail/bottoms/BM26A039CM_06.jpg",prompt:"裤脚/下摆特写"},
    {id:"detail_bottoms_BM26A039CM_07",name:"BM26A039CM_07.jpg",size:2885,dataUrl:"/templates/detail/bottoms/BM26A039CM_07.jpg",prompt:"缝线走线和拼接工艺"},
    {id:"detail_bottoms_BM26A039CM_08",name:"BM26A039CM_08.jpg",size:2245,dataUrl:"/templates/detail/bottoms/BM26A039CM_08.jpg",prompt:"背面整体展示"},
    {id:"detail_bottoms_BM26A039CM_09",name:"BM26A039CM_09.jpg",size:3298,dataUrl:"/templates/detail/bottoms/BM26A039CM_09.jpg",prompt:"侧面版型轮廓展示"},
    {id:"detail_bottoms_BM26A039CM_10",name:"BM26A039CM_10.jpg",size:2671,dataUrl:"/templates/detail/bottoms/BM26A039CM_10.jpg",prompt:"多色对比陈列"},
    {id:"detail_bottoms_BM26A039CM_11",name:"BM26A039CM_11.jpg",size:2956,dataUrl:"/templates/detail/bottoms/BM26A039CM_11.jpg",prompt:"尺码参考信息图"},
    {id:"detail_bottoms_BM26A039CM_12",name:"BM26A039CM_12.jpg",size:2867,dataUrl:"/templates/detail/bottoms/BM26A039CM_12.jpg",prompt:"搭配推荐展示"},
    {id:"detail_bottoms_BM26A039CM_13",name:"BM26A039CM_13.jpg",size:2401,dataUrl:"/templates/detail/bottoms/BM26A039CM_13.jpg",prompt:"穿着场景化展示"},
    {id:"detail_bottoms_BM26A039CM_14",name:"BM26A039CM_14.jpg",size:3022,dataUrl:"/templates/detail/bottoms/BM26A039CM_14.jpg",prompt:"面料弹力/透气功能展示"},
    {id:"detail_bottoms_BM26A039CM_15",name:"BM26A039CM_15.jpg",size:3380,dataUrl:"/templates/detail/bottoms/BM26A039CM_15.jpg",prompt:"里料/内衬展示"},
    {id:"detail_bottoms_BM26A039CM_16",name:"BM26A039CM_16.jpg",size:3147,dataUrl:"/templates/detail/bottoms/BM26A039CM_16.jpg",prompt:"洗唛/吊牌/认证标识"},
    {id:"detail_bottoms_BM26A039CM_17",name:"BM26A039CM_17.jpg",size:2868,dataUrl:"/templates/detail/bottoms/BM26A039CM_17.jpg",prompt:"模特身材参考+包装展示"},
  ];

  return [
    { id: 'default_main_tops', name: '主图-上装标准', type: 'main', garmentCategory: 'tops', description: '正面全身, 纯白背景, 棚拍灯光, 4K超清', promptTemplate: '服装电商主图，模特穿着{sku}款服装，正面全身展示，纯白背景，柔和棚拍灯光，4K超清画质，中文标识', reversePromptTemplate: '请你仔细分析这张模特图，只提取换衣时必须100%保留的不变特征：人物特征、光影特征、场景背景、构图参数、风格质感。输出简洁精准，用短语而非句子。', refImages: [], createdAt: now, updatedAt: now },
    { id: 'default_main_bottoms', name: '主图-下装标准', type: 'main', garmentCategory: 'bottoms', description: '正面全身, 纯白背景, 棚拍灯光, 4K超清', promptTemplate: '服装电商主图，模特穿着{sku}款下装，正面全身展示，纯白背景，柔和棚拍灯光，4K超清画质，中文标识', reversePromptTemplate: '请你仔细分析这张模特图，只提取换衣时必须100%保留的不变特征：人物特征、光影特征、场景背景、构图参数、风格质感。输出简洁精准，用短语而非句子。', refImages: [], createdAt: now, updatedAt: now },
    { id: 'default_pose_tops', name: '裂变-上装7姿势', type: 'pose', garmentCategory: 'tops', description: '上装7个标准姿势裂变模板 (已含7张参考图)', promptTemplate: '服装电商姿势展示，模特穿着{sku}款服装，纯白背景，4K超清画质，中文标识', reversePromptTemplate: '请你仔细分析这张模特图，只提取换衣时必须100%保留的不变特征。输出简洁精准。', refImages: POSE_TOPS, createdAt: now, updatedAt: now },
    { id: 'default_pose_bottoms', name: '裂变-下装7姿势', type: 'pose', garmentCategory: 'bottoms', description: '下装7个标准姿势裂变模板 (已含7张参考图)', promptTemplate: '服装电商姿势展示，模特穿着{sku}款下装，纯白背景，4K超清画质，中文标识', reversePromptTemplate: '请你仔细分析这张模特图，只提取换衣时必须100%保留的不变特征。输出简洁精准。', refImages: POSE_BOTTOMS, createdAt: now, updatedAt: now },
    { id: 'default_detail_tops', name: '详情-上装19图', type: 'detail', garmentCategory: 'tops', description: '上装详情页19个布局模板 (已含19张参考图)', promptTemplate: '电商详情页，模特穿着{sku}款服装，纯白棚拍，4K超清画质，中文标注卖点、材质、尺码信息', reversePromptTemplate: '请你仔细分析这张详情参考图，提取构图和排版特征。', refImages: DETAIL_TOPS, createdAt: now, updatedAt: now },
    { id: 'default_detail_bottoms', name: '详情-下装17图', type: 'detail', garmentCategory: 'bottoms', description: '下装详情页17个布局模板 (已含17张参考图)', promptTemplate: '电商详情页，模特穿着{sku}款下装，纯白棚拍，4K超清画质，中文标注卖点、材质、尺码信息', reversePromptTemplate: '请你仔细分析这张详情参考图，提取构图和排版特征。', refImages: DETAIL_BOTTOMS, createdAt: now, updatedAt: now },
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
