"""
Visual Forge 工作流引擎模块

架构：
  types.py         - NodeOutput / PipelineContext / WorkflowConfig / StageConfig 类型定义
  engine.py        - PipelineEngine 顺序执行器
  stages.py        - 5个阶段实现（prepare/analyze/generate/validate/finalize）
  presets.py       - 6个默认工作流模板（含 exposed_mapping）
  node_registry.py - 画布节点类型 → 后端执行函数映射
  executor.py      - 异步并发执行器 + 任务管理
  injector.py      - 参数注入引擎（exposed_mapping → 动态参数注入）
  providers/       - 提供者抽象层
    base.py        - BaseProvider / ProviderResult 抽象基类
    key_pool.py    - 共享密钥池管理
    yunwu.py       - Yunwu 生图提供者
    grsai.py       - GrsAI 生图提供者
    mimo.py        - MiMo 视觉分析提供者
    llm.py         - DeepSeek 文本补全提供者
"""

from .types import (
    NodeOutput,
    PipelineContext,
    PipelineProgress,
    StageConfig,
    WorkflowConfig,
    # Legacy compatibility
    WorkflowOptions,
    RowImages,
    TemplateSlot,
)
from .engine import PipelineEngine, run_pipeline
from .stages import stage_registry as stageRegistry
from .presets import WORKFLOW_PRESETS
from .node_registry import NODE_TYPE_MAP, get_node_handler, list_node_types
from .executor import WorkflowExecutor, WorkflowTask, TaskStatus, get_executor
from .injector import inject_parameters, get_exposed_fields, InjectionError
from .providers import (
    get_provider,
    get_provider_for_model,
    BaseProvider,
    ProviderResult,
    YunwuProvider,
    GrsAIProvider,
    MiMoProvider,
    LLMProvider,
)

__all__ = [
    # Core types
    "NodeOutput",
    "PipelineEngine",
    "run_pipeline",
    "PipelineContext",
    "PipelineProgress",
    "StageConfig",
    "WorkflowConfig",
    # Legacy compatibility
    "WorkflowOptions",
    "RowImages",
    "TemplateSlot",
    # Stage registry
    "stageRegistry",
    # Presets
    "WORKFLOW_PRESETS",
    # Node registry
    "NODE_TYPE_MAP",
    "get_node_handler",
    "list_node_types",
    # Executor
    "WorkflowExecutor",
    "WorkflowTask",
    "TaskStatus",
    "get_executor",
    # Injector
    "inject_parameters",
    "get_exposed_fields",
    "InjectionError",
    # Providers
    "get_provider",
    "get_provider_for_model",
    "BaseProvider",
    "ProviderResult",
    "YunwuProvider",
    "GrsAIProvider",
    "MiMoProvider",
    "LLMProvider",
]
