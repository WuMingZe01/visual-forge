"""
Visual Forge 工作流引擎模块

架构：
  types.py         - PipelineContext / WorkflowConfig / StageConfig 类型定义
  engine.py        - PipelineEngine 顺序执行器
  stages.py        - 5个阶段实现（prepare/analyze/generate/validate/finalize）
  presets.py       - 6个默认工作流模板
  node_registry.py - 画布节点类型 → 后端执行函数映射
  executor.py      - 异步并发执行器 + 任务管理
"""

from .types import (
    PipelineContext,
    PipelineProgress,
    StageConfig,
    WorkflowConfig,
    WorkflowOptions,
    RowImages,
    TemplateSlot,
)
from .engine import PipelineEngine, run_pipeline
from .stages import stage_registry as stageRegistry
from .presets import WORKFLOW_PRESETS
from .node_registry import NODE_TYPE_MAP, get_node_handler, list_node_types
from .executor import WorkflowExecutor, WorkflowTask, TaskStatus, get_executor

__all__ = [
    "PipelineEngine",
    "run_pipeline",
    "PipelineContext",
    "PipelineProgress",
    "StageConfig",
    "WorkflowConfig",
    "WorkflowOptions",
    "RowImages",
    "TemplateSlot",
    "stageRegistry",
    "WORKFLOW_PRESETS",
    "NODE_TYPE_MAP",
    "get_node_handler",
    "list_node_types",
    "WorkflowExecutor",
    "WorkflowTask",
    "TaskStatus",
    "get_executor",
]
