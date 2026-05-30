import type { LlmConfig } from '@/store/useLlmStore';
import type { SKUInfo, ReferenceImage } from '@/types/tryon-types';

// ===== Row & Task Types =====

export interface BatchRow {
  id: string;
  skuCode: string;
  productName: string;
  frontImage: ReferenceImage | null;
  backImage: ReferenceImage | null;
  modelImage: ReferenceImage | null;
  styleImage: ReferenceImage | null;
  detailImages: string[];
  prompt: string;
  lingmaoData: SKUInfo | null;
  status: 'idle' | 'generating' | 'done' | 'failed';
  resultUrls: string[];
  error: string;
  runningIdx: number;
  count: number;
}

export interface TemplateSlot {
  refIndex: number;
  refUrl: string;
  prompt: string;
}

// ===== Pipeline Context =====

export interface RowImages {
  productB64: string;
  modelB64: string;
  styleRefB64?: string;
  detailB64?: string;
}

export interface PipelineContext {
  // Input config
  rows: BatchRow[];
  visionModel?: LlmConfig;
  textModel?: LlmConfig;
  modelId: string;
  width: number;
  height: number;
  logoB64?: string;
  useHybrid: boolean;

  // Template data (pose/detail modes)
  templateSlots?: TemplateSlot[];
  selectedModelId?: string;

  // Lingmao (ERP) data availability
  hasLingmaoData: boolean;

  // Per-row state populated by stages
  rowImages: Map<string, RowImages>;
  rowPrompts: Map<string, string>;
  rowResults: Map<string, { urls: string[]; error: string }>;

  // Control
  abortRef: { current: boolean };
  signal?: AbortSignal;

  // Progress callback
  onProgress: (event: PipelineProgress) => void;
  onRowResult: (rowId: string, urls: string[], errors: string[]) => void;
}

export interface PipelineProgress {
  stage: string;
  step: number;
  total: number;
  message: string;
}

export interface ImageGenTask {
  rowId: string;
  skuCode: string;
  productB64: string;
  modelB64: string;
  styleRefB64?: string;
  detailB64?: string;
  prompt: string;
  count: number;
  idxInRow: number;
  modelId: string;
  width: number;
  height: number;
}

// ===== Workflow Config =====

export interface StageConfig {
  /** Stage identifier — must match a registered stage name */
  id: string;
  /** Whether this stage is enabled */
  enabled: boolean;
  /** Optional stage-specific configuration */
  config?: Record<string, unknown>;
}

export interface WorkflowOptions {
  /** Max concurrent image generation workers */
  generateConcurrency: number;
  /** Total timeout for generation phase (ms) */
  generateTimeoutMs: number;
  /** Timeout for validation per item (ms) */
  validateTimeoutMs: number;
  /** Max concurrent LLM analysis calls */
  llmMaxConcurrency: number;
}

export interface WorkflowConfig {
  name: string;
  description: string;
  stages: StageConfig[];
  options: WorkflowOptions;
}

// ===== Stage Function Type =====

export type StageFn = (ctx: PipelineContext, config?: Record<string, unknown>) => Promise<void>;

// ===== Task History Types =====

export interface TaskRecord {
  id: string;
  rowId: string;
  skuCode: string;
  productName: string;
  status: 'generating' | 'completed' | 'partial' | 'failed';
  progress: number;
  resultUrls: string[];
  error: string;
  prompt: string;
  modelId: string;
  width: number;
  height: number;
  validationReport?: unknown;
  batchId: string;
  completedAt?: string;
}
