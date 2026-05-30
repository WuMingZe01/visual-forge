from dataclasses import dataclass, field
from typing import Any, Callable, Optional


# ===== Supporting Types =====

@dataclass
class RowImages:
    product_b64: str
    model_b64: str
    style_ref_b64: Optional[str] = None
    detail_b64: Optional[str] = None


@dataclass
class PipelineProgress:
    stage: str
    step: int
    total: int
    message: str


@dataclass
class TemplateSlot:
    ref_index: int
    ref_url: str
    prompt: str


@dataclass
class WorkflowOptions:
    generate_concurrency: int = 4
    generate_timeout_ms: int = 300_000
    validate_timeout_ms: int = 30_000
    llm_max_concurrency: int = 4


# ===== Core Types =====

@dataclass
class PipelineContext:
    rows: list[Any]
    model_id: str
    width: int
    height: int
    has_lingmao_data: bool
    use_hybrid: bool = False
    vision_model: Optional[Any] = None
    text_model: Optional[Any] = None
    logo_b64: Optional[str] = None
    template_slots: Optional[list[TemplateSlot]] = None
    selected_model_id: Optional[str] = None

    row_images: dict[str, RowImages] = field(default_factory=dict)
    row_prompts: dict[str, str] = field(default_factory=dict)
    row_results: dict[str, dict[str, Any]] = field(default_factory=dict)

    abort_ref: dict[str, bool] = field(default_factory=lambda: {"current": False})
    signal: Optional[Any] = None

    on_progress: Callable[[PipelineProgress], None] = lambda _: None
    on_row_result: Callable[[str, list[str], list[str]], None] = lambda _id, _urls, _errors: None


@dataclass
class StageConfig:
    id: str
    enabled: bool = True
    config: Optional[dict[str, Any]] = None


@dataclass
class WorkflowConfig:
    name: str
    description: str
    stages: list[StageConfig] = field(default_factory=list)
    options: WorkflowOptions = field(default_factory=WorkflowOptions)
