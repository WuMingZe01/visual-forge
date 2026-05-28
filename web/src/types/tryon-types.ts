export interface SKUSizeColor {
  sizeName: string;
  colorName: string;
  skuCode: string;
  gbCode: string;
}

export interface SizeGuideItem {
  sizeName: string;
  measurements: Record<string, string>;
}

export interface SizeGuide {
  guideName: string;
  unit: string;
  items: SizeGuideItem[];
}

export interface SKUInfo {
  skuCode: string;
  productName: string;
  unit: string;
  gender: string;
  listDate: string;
  brand: string;
  year: string;
  season: string;
  band: string;
  category: string;
  designGroup: string;
  designer: string;
  supplierName: string;
  supplierCode: string;
  goodCode: string;
  oriBrand: string;
  series: string;
  profile: string;
  srcUrl: string;
  createTime: string;
  degree: string;
  customer: string;
  sizes: string[];
  colors: string[];
  skuList: SKUSizeColor[];
  price: number;
  costPrice: number;
  retailPrice: number;
  standardRule: string;
  safeLevel: string;
  composition: string;
  processDesc: string;
  fabricWeight: string;
  hasQualityReport: string;
  fabricIntro: string;
  profileIntro: string;
  fabricCategory: string;
  shoulderType: string;
  collarType: string;
  sleeveType: string;
  hemDesign: string;
  thicknessElastic: string;
  packaging: string;
  hangTag: string;
  desiccantStorage: string;
  sachetLabel: string;
  saleInfo: string;
  washInfo: string;
  remark: string;
  imgUrls: string[];
  sizeGuide: SizeGuide | null;
  fetchedAt: string;
}

export interface ReferenceImage {
  id: string;
  type: 'model' | 'product_front' | 'product_back' | 'detail_ref';
  previewUrl: string;
  name: string;
  size: number;
}

export interface TryOnParams {
  model: string;
  resolutionRatio: string;
  customWidth?: number;
  customHeight?: number;
  chinesePrompt: string;
  count: number;
}

export interface TryOnTask {
  id: string;
  skuInfo: SKUInfo | null;
  modelImage: ReferenceImage | null;
  productFrontImage: ReferenceImage | null;
  productBackImage: ReferenceImage | null;
  params: TryOnParams;
  results: TryOnResult[];
  status: 'idle' | 'generating' | 'done' | 'partial';
  createdAt: string;
}

export interface TryOnResult {
  index: number;
  poseDesc: string;
  prompt: string;
  imageUrl: string;
  status: 'pending' | 'done' | 'failed';
  error?: string;
}

export interface DetailSection {
  id: string;
  sortOrder: number;
  title: string;
  description: string;
  templateText: string;
  refImage: ReferenceImage | null;
  generatedImageUrl: string;
  status: 'idle' | 'generating' | 'done';
}

export const RESOLUTION_PRESETS = [
  { label: '1024×1024 (1:1, 1K)', width: 1024, height: 1024, ratio: '1:1', res: '1K' },
  { label: '2048×2048 (1:1, 2K)', width: 2048, height: 2048, ratio: '1:1', res: '2K' },
  { label: '1536×1024 (3:2, 2K)', width: 1536, height: 1024, ratio: '3:2', res: '2K' },
  { label: '1024×1536 (2:3, 2K)', width: 1024, height: 1536, ratio: '2:3', res: '2K' },
  { label: '3264×2448 (4:3, 4K)', width: 3264, height: 2448, ratio: '4:3', res: '4K' },
  { label: '2448×3264 (3:4, 4K)', width: 2448, height: 3264, ratio: '3:4', res: '4K' },
  { label: '自定义', width: 0, height: 0, ratio: '', res: '' },
] as const;

export const AI_MODELS_FOR_TRYON = [
  { id: 'gpt-image-2-vip', name: 'GPT Image 2 VIP', desc: 'Grsai·4K·双参考图' },
  { id: 'gpt-image-2-all', name: 'GPT Image 2 ALL', desc: 'Yunwu·4K·双参考图' },
  { id: 'gpt-image-2', name: 'GPT Image 2', desc: 'Yunwu·4K·纯文生图' },
  { id: 'nano-banana-pro', name: 'nano-banana Pro', desc: 'Grsai·创意' },
  { id: 'nano-banana-2', name: 'nano-banana-2', desc: 'Grsai·快速' },
  { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro', desc: 'Yunwu·高清' },
];

// ===== 模特库类型 =====
export interface ModelEntry {
  id: string;
  name: string;
  category: 'tops' | 'bottoms' | 'both';
  previewUrl: string;
  originalName: string;
  size: number;
  description: string;
  tags: string[];
  createdAt: string;
}

// ===== 模板库类型 =====
export type TemplateCategory = 'main' | 'pose' | 'detail';
export type GarmentCategory = 'tops' | 'bottoms';

export interface TemplateRefImage {
  id: string;
  name: string;
  size: number;
  dataUrl: string;  // 300px thumbnail for localStorage
}

export interface TemplateEntry {
  id: string;
  name: string;
  type: 'main' | 'pose' | 'detail';
  garmentCategory: 'tops' | 'bottoms';
  description: string;
  promptTemplate: string;
  refImages: TemplateRefImage[];  // 上传的真实参考图
  createdAt: string;
  updatedAt: string;
}

export const POSE_VARIATIONS = [
  '正面自然站立，双手自然垂放，视线直视镜头，标准模特站姿',
  '侧身45度展示服装轮廓线条，单手自然摆放，展示侧面版型',
  '自然行走动态抓拍，双手轻微摆动，展示服装动态效果，街拍风格',
  '优雅坐姿，身体微微前倾，自然光线，休闲氛围',
  '半身特写，展示上衣领口和肩部细节，面部清晰可见',
  '背对镜头转身回眸，展示服装背面设计，动态瞬间',
  '双手插兜，轻松休闲姿态，微侧身，展示服装日常穿着效果',
  '靠墙站立，一腿微曲，手自然搭放，展示服装垂坠感和廓形',
];

export const DEFAULT_DETAIL_SECTIONS: Pick<DetailSection, 'title' | 'description' | 'templateText'>[] = [
  { title: '首屏承接', description: '延续主图卖点，展示产品整体', templateText: '模特穿着完整搭配的产品，正面展示，高档摄影棚光线' },
  { title: '材质特写', description: '面料质感、细节工艺', templateText: '微距特写镜头，展示面料纹理和缝线细节，聚焦领口/袖口/纽扣区域' },
  { title: '版型展示', description: '正面/侧面/背面多角度', templateText: '三角度展示版型裁剪效果，正面、侧面、背面各一张拼接，展现廓形' },
  { title: '搭配推荐', description: '上下搭配、配饰建议', templateText: '完整搭配造型展示，包含配饰、鞋履等风格化搭配元素' },
  { title: '颜色选择', description: '所有颜色SKU对比', templateText: '多颜色并列对比展示，统一模特姿势统一光线' },
  { title: '尺码参考', description: '尺码表+模特身材参考', templateText: '尺码对照信息图，模特身高体重参考标注' },
  { title: '细节卖点', description: '核心功能标签化展示', templateText: '左图右文布局，产品局部特写配合功能标签和简短卖点文字' },
  { title: '物流/售后CTA', description: '发货时效+退换政策', templateText: '底部转化模块，物流图标+售后保障徽章+引导下单按钮区域' },
];
