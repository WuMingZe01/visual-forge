/**
 * ============================================
 * 生图工作流配置文件
 * ============================================
 *
 * 这里是整个生图流程的"控制面板"。
 * 你可以通过修改这个文件来调整生图流程，无需改动业务代码。
 *
 * ## 可用的阶段 ID
 * - prepare   : 图片/数据准备、密钥池同步、并发计算
 * - analyze   : LLM 多模态反推（模特特征 + 风格特征）→ 提示词整合
 * - generate  : 并发生图（Grsai + Yunwu 混合引擎负载均衡）
 * - validate  : Mimo 多模态生成结果校验
 * - finalize  : 任务状态输出
 *
 * ## 配置示例
 * ```typescript
 * // 如果不想用 LLM 反推，直接生图：
 * stages: [
 *   { id: 'prepare', enabled: true },
 *   { id: 'analyze', enabled: false },   // 关掉
 *   { id: 'generate', enabled: true },
 *   { id: 'validate', enabled: false },  // 关掉
 *   { id: 'finalize', enabled: true },
 * ]
 * ```
 *
 * ## 自定义参数
 * config 字段可以给阶段传递参数，各阶段支持的参数：
 * - analyze: { useModelAnalysis: boolean, useProductAnalysis: boolean }
 * - validate: { timeoutMs: number }
 * - generate: (使用 WorkflowOptions 中的全局配置)
 */

import type { WorkflowConfig } from './types';

// ===== 主图批量生成工作流 =====

export const MAIN_BATCH_WORKFLOW: WorkflowConfig = {
  name: '主图批量生成',
  description: '完整批量生图流程：准备 → LLM多模态反推 → 提示词整合 → 混合引擎并发生图 → Mimo校验 → 任务输出',
  stages: [
    { id: 'prepare', enabled: true },
    { id: 'analyze', enabled: true, config: { useModelAnalysis: true, useProductAnalysis: true } },
    { id: 'generate', enabled: true },
    { id: 'validate', enabled: true },
    { id: 'finalize', enabled: true },
  ],
  options: {
    generateConcurrency: 36,
    generateTimeoutMs: 480000,
    validateTimeoutMs: 30000,
    llmMaxConcurrency: 3,
  },
};

// ===== 姿势裂变批量生成工作流 =====

export const POSE_BATCH_WORKFLOW: WorkflowConfig = {
  name: '姿势裂变批量生成',
  description: '姿势裂变：跳过LLM分析，直接用模板参考图和预定义姿势提示词批量生图',
  stages: [
    { id: 'prepare', enabled: true },
    { id: 'analyze', enabled: false },
    { id: 'generate', enabled: true },
    { id: 'validate', enabled: false },
    { id: 'finalize', enabled: true },
  ],
  options: {
    generateConcurrency: 36,
    generateTimeoutMs: 480000,
    validateTimeoutMs: 30000,
    llmMaxConcurrency: 3,
  },
};

// ===== 详情页批量生成工作流 =====

export const DETAIL_BATCH_WORKFLOW: WorkflowConfig = {
  name: '详情页批量生成',
  description: '详情页模块生图：跳过LLM分析，按详情模板参考图1:1生成详情模块',
  stages: [
    { id: 'prepare', enabled: true },
    { id: 'analyze', enabled: false },
    { id: 'generate', enabled: true },
    { id: 'validate', enabled: false },
    { id: 'finalize', enabled: true },
  ],
  options: {
    generateConcurrency: 36,
    generateTimeoutMs: 480000,
    validateTimeoutMs: 30000,
    llmMaxConcurrency: 3,
  },
};

// ===== 快速生图工作流（单张） =====

export const QUICK_GENERATE_WORKFLOW: WorkflowConfig = {
  name: '快速生图',
  description: '单张快速生图：跳过反推和校验，直接生成',
  stages: [
    { id: 'prepare', enabled: true },
    { id: 'analyze', enabled: false },
    { id: 'generate', enabled: true },
    { id: 'validate', enabled: false },
    { id: 'finalize', enabled: true },
  ],
  options: {
    generateConcurrency: 1,
    generateTimeoutMs: 120000,
    validateTimeoutMs: 30000,
    llmMaxConcurrency: 1,
  },
};

// ===== 贯穿管道工作流 =====

export const PIPELINE_FULL_WORKFLOW: WorkflowConfig = {
  name: '贯穿管道（主图→姿势→详情）',
  description: '全自动串联：先跑主图批量 → 再跑姿势裂变 → 最后详情页生成',
  stages: [
    { id: 'prepare', enabled: true },
    { id: 'analyze', enabled: true, config: { useModelAnalysis: true, useProductAnalysis: true } },
    { id: 'generate', enabled: true },
    { id: 'validate', enabled: true },
    { id: 'finalize', enabled: true },
  ],
  options: {
    generateConcurrency: 36,
    generateTimeoutMs: 480000,
    validateTimeoutMs: 30000,
    llmMaxConcurrency: 3,
  },
};

// ===== 简易工作流（无LLM反推，无校验） =====

export const SIMPLE_BATCH_WORKFLOW: WorkflowConfig = {
  name: '简易批量生成',
  description: '最简流程：仅准备 + 并发生图，适合已写好提示词的场景',
  stages: [
    { id: 'prepare', enabled: true },
    { id: 'analyze', enabled: false },
    { id: 'generate', enabled: true },
    { id: 'validate', enabled: false },
    { id: 'finalize', enabled: true },
  ],
  options: {
    generateConcurrency: 36,
    generateTimeoutMs: 480000,
    validateTimeoutMs: 0,
    llmMaxConcurrency: 0,
  },
};
