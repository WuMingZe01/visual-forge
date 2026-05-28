export interface AIModel {
  id: string;
  name: string;
  provider: 'yunwu' | 'grsai';
  fallbackModel?: string;
  recommendedFor?: string[];
}

export interface AspectPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  ratio: string;
  scene: string[];
}

export type Resolution = '1K' | '2K' | '4K';

export interface StylePreset {
  id: string;
  name: string;
  keywords: string[];
  category: 'cover' | 'infographic' | 'freeform' | 'ppt';
  ratio: string;
  promptTemplate?: string;
  modifier?: string;
  colorGradient?: string;
}

export type ReferenceType = 'product' | 'model' | 'reference';

export interface ReferenceImage {
  id: string;
  type: ReferenceType;
  previewUrl: string;
  name: string;
  size: number;
}

export type TaskStatus = 'pending' | 'optimizing' | 'generating' | 'completed' | 'failed';

export interface GenerateTask {
  id: string;
  model: AIModel;
  aspectPreset: AspectPreset;
  resolution: Resolution;
  stylePreset?: StylePreset;
  chinesePrompt: string;
  englishPrompt: string;
  negativePrompt: string;
  productImages: ReferenceImage[];
  modelImages: ReferenceImage[];
  styleStrength: number;
  status: TaskStatus;
  progress: number;
  resultUrls: string[];
  seed?: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
  retryCount: number;
}

export interface CanvasProject {
  id: string;
  name: string;
  productRef?: ReferenceImage;
  sceneResults: GenerateTask[];
  infographicResults: GenerateTask[];
  detailResults: GenerateTask[];
  layoutTemplate: string;
  finalImageUrl?: string;
  createdAt: string;
}

export interface SellingPoint {
  id: string;
  text: string;
  icon: string;
}

export interface ScenarioTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  promptEnhancer: string;
}

export interface DetailCloseup {
  id: string;
  name: string;
  description: string;
  promptEnhancer: string;
  icon: string;
}

export interface SystemConfig {
  yunwuApiKeys: string[];
  yunwuBaseUrl: string;
  grsaiApiKeys: string[];
  grsaiApiUrl: string;
  defaultProvider: 'auto' | 'yunwu' | 'grsai';
  defaultModelId: string;
  ossAccessKeyId: string;
  ossAccessKeySecret: string;
  ossEndpoint: string;
  ossBucket: string;
}

export interface DraftItem {
  id: string;
  task: GenerateTask;
  savedAt: string;
  name: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}
