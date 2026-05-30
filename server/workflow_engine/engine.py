"""
Pipeline execution engine.

Reads a WorkflowConfig, executes enabled stages in order,
passing PipelineContext between them.
"""

import logging
from typing import Any

from .stages import stage_registry as stageRegistry
from .types import PipelineContext, PipelineProgress, WorkflowConfig

logger = logging.getLogger(__name__)


class PipelineEngine:
    """Execute a pipeline — runs all enabled stages in sequence."""

    def __init__(self, config: WorkflowConfig, ctx: PipelineContext) -> None:
        self.config: WorkflowConfig = config
        self.ctx: PipelineContext = ctx

    async def run(self) -> None:
        """Execute all enabled stages in order.

        Skips disabled stages and unknown stage IDs (with a warning).
        Checks ctx.abort_ref['current'] before each stage to support
        cooperative cancellation.  Stage failures are re-raised, not
        swallowed — callers are expected to handle them.
        """
        for stage_cfg in self.config.stages:
            if self.ctx.abort_ref["current"]:
                break

            if not stage_cfg.enabled:
                continue

            stage_fn = stageRegistry.get(stage_cfg.id)
            if stage_fn is None:
                logger.warning(
                    "[Pipeline] Unknown stage: %s, skipping", stage_cfg.id
                )
                continue

            self.ctx.on_progress(
                PipelineProgress(
                    stage=stage_cfg.id,
                    step=0,
                    total=0,
                    message=f"执行阶段: {stage_cfg.id}",
                )
            )

            try:
                await stage_fn(self.ctx, stage_cfg.config)
            except Exception:
                logger.exception(
                    '[Pipeline] Stage "%s" failed', stage_cfg.id
                )
                raise

    def abort(self) -> None:
        """Signal the pipeline to stop before the next stage begins."""
        self.ctx.abort_ref["current"] = True


async def run_pipeline(config: WorkflowConfig, ctx: PipelineContext) -> None:
    """Convenience function: create and run a pipeline."""
    engine = PipelineEngine(config, ctx)
    await engine.run()
