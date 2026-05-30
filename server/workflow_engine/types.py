"""
Pipeline type definitions.

Generic types for the template-driven workflow engine.
No business-specific fields — all data flows through runtime_template.
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Optional


# ===== Core Types =====

@dataclass
class NodeOutput:
    """Output from a single node execution."""
    node_id: str
    node_type: str
    result: Any = None
    error: Optional[str] = None
    metadata: dict = field(default_factory=dict)


@dataclass
class PipelineProgress:
    """Progress update from a pipeline stage."""
    stage: str
    step: int
    total: int
    message: str


@dataclass
class PipelineContext:
    """Generic pipeline context — no business-specific fields.

    All node data flows through runtime_template (the injected template JSON).
    Node outputs are stored in node_outputs keyed by node_id.
    """
    runtime_template: dict
    dynamic_inputs: dict[str, Any] = field(default_factory=dict)
    node_outputs: dict[str, NodeOutput] = field(default_factory=dict)
    abort_ref: dict[str, bool] = field(default_factory=lambda: {"current": False})
    signal: Optional[Any] = None
    on_progress: Callable[[PipelineProgress], None] = lambda _: None
    on_row_result: Callable[[str, list[str], list[str]], None] = lambda _id, _urls, _errors: None

    # Execution options (from template or API)
    generate_concurrency: int = 4
    generate_timeout_ms: int = 300_000
    validate_timeout_ms: int = 30_000


@dataclass
class StageConfig:
    """Configuration for a single pipeline stage."""
    id: str
    enabled: bool = True
    config: Optional[dict[str, Any]] = None


@dataclass
class WorkflowConfig:
    """Complete workflow configuration."""
    name: str
    description: str
    stages: list[StageConfig] = field(default_factory=list)
    options: dict = field(default_factory=dict)
    exposed_mapping: dict = field(default_factory=dict)


# Legacy compatibility shims — kept for import stability
# These are no longer used by the engine but may be imported elsewhere
RowImages = None
TemplateSlot = None
WorkflowOptions = None
