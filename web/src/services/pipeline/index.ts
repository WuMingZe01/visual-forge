/**
 * Visual Forge Pipeline Module
 *
 * 可配置的生图流程管道引擎。
 *
 * ## 快速开始
 * ```typescript
 * import { runPipeline, MAIN_BATCH_WORKFLOW } from '@/services/pipeline';
 *
 * await runPipeline(MAIN_BATCH_WORKFLOW, context);
 * ```
 *
 * ## 调整流程
 * 编辑 `preset.ts` 中的工作流定义，或创建自定义工作流对象。
 * 阶段启用/禁用：设置 `enabled: true/false`
 * 阶段参数：通过 `config` 字段传递
 *
 * ## 可用阶段
 * - prepare  : 密钥池同步、并发计算、数据验证
 * - analyze  : LLM 多模态分析 + 提示词整合
 * - generate : 并发生图（混合引擎负载均衡）
 * - validate : Mimo 多模态质量校验
 * - finalize : 任务状态输出
 */

export { PipelineEngine, runPipeline } from './engine';
export { stageRegistry } from './stages';
export { runBatchWithPipeline } from './batchAdapter';
export type { BatchAdapterInput } from './batchAdapter';
export {
  MAIN_BATCH_WORKFLOW,
  POSE_BATCH_WORKFLOW,
  DETAIL_BATCH_WORKFLOW,
  QUICK_GENERATE_WORKFLOW,
  PIPELINE_FULL_WORKFLOW,
  SIMPLE_BATCH_WORKFLOW,
} from './preset';
export type {
  PipelineContext,
  PipelineProgress,
  WorkflowConfig,
  WorkflowOptions,
  StageConfig,
  StageFn,
  BatchRow,
  TemplateSlot,
  RowImages,
  ImageGenTask,
  TaskRecord,
} from './types';
