"""
Pipeline stage implementations.

Generic orchestrator — reads runtime template node graph,
dispatches to providers based on node type.

Each stage is a pure async function: (ctx, config) -> None
Stages communicate via PipelineContext — they read from and write to ctx.

多模态/视觉识别: MiMo (mimo-v2.5)
文本模型: DeepSeek (deepseek-chat / deepseek-v4-flash)
生图引擎: Yunwu + Grsai 混合
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from .types import PipelineContext, PipelineProgress, NodeOutput
from .providers import get_provider

logger = logging.getLogger(__name__)

# Default generation prompt
DEFAULT_PROMPT = (
    "Professional product photo of a fashion item, "
    "clean background, studio lighting, high quality, 8K, commercial photography"
)


# ============================================================================
# Helpers
# ============================================================================

def _get_upstream_output(node_id: str, ctx: PipelineContext) -> Any:
    """Get the first upstream output for a node by traversing connections."""
    connections = ctx.runtime_template.get("connections") or ctx.runtime_template.get("canvas_connections") or []
    for conn in connections:
        if conn.get("to") == node_id:
            upstream = ctx.node_outputs.get(conn["from"])
            if upstream and upstream.result is not None:
                return upstream.result
    return None


def _get_upstream_image(node_id: str, ctx: PipelineContext) -> str | None:
    """Get the first upstream image URL for a node."""
    connections = ctx.runtime_template.get("connections") or ctx.runtime_template.get("canvas_connections") or []
    for conn in connections:
        if conn.get("to") == node_id:
            upstream = ctx.node_outputs.get(conn["from"])
            if upstream and upstream.node_type == "image" and upstream.result:
                return upstream.result
    return None


def _get_all_upstream_images(node_id: str, ctx: PipelineContext) -> list[str]:
    """Get all upstream image URLs for a node."""
    connections = ctx.runtime_template.get("connections") or ctx.runtime_template.get("canvas_connections") or []
    images = []
    for conn in connections:
        if conn.get("to") == node_id:
            upstream = ctx.node_outputs.get(conn["from"])
            if upstream and upstream.node_type == "image" and upstream.result:
                images.append(upstream.result)
    return images


def _find_nodes_by_type(nodes: list[dict], node_type: str) -> list[dict]:
    """Find all nodes of a given type."""
    return [n for n in nodes if isinstance(n, dict) and n.get("type") == node_type]


# ============================================================================
# Stage 1: Prepare
# ============================================================================

async def stage_prepare(ctx: PipelineContext, config: dict[str, Any] | None = None) -> None:
    """Prepare: validate inputs, register image + prompt nodes."""
    _ = config
    nodes = ctx.runtime_template.get("nodes") or ctx.runtime_template.get("canvas_nodes") or []
    image_nodes = _find_nodes_by_type(nodes, "image")
    prompt_nodes = _find_nodes_by_type(nodes, "prompt")

    total = len(image_nodes) + len(prompt_nodes)

    ctx.on_progress(PipelineProgress(
        stage="prepare", step=0, total=total,
        message=f"准备 {len(image_nodes)} 图片 + {len(prompt_nodes)} 提示词",
    ))

    for node in image_nodes:
        url = node.get("url", "")
        if url:
            ctx.node_outputs[node["id"]] = NodeOutput(
                node_id=node["id"], node_type="image", result=url,
            )

    for node in prompt_nodes:
        text = node.get("text", "")
        if text:
            ctx.node_outputs[node["id"]] = NodeOutput(
                node_id=node["id"], node_type="prompt", result=text,
            )

    ctx.on_progress(PipelineProgress(
        stage="prepare", step=total, total=total,
        message=f"就绪 · {len(image_nodes)} 图片 + {len(prompt_nodes)} 提示词",
    ))


# ============================================================================
# Stage 2: Analyze (LLM multimodal analysis)
# ============================================================================

async def stage_analyze(ctx: PipelineContext, config: dict[str, Any] | None = None) -> None:
    """Analyze: run LLM on input images."""
    cfg = config or {}
    nodes = ctx.runtime_template.get("nodes") or ctx.runtime_template.get("canvas_nodes") or []
    llm_nodes = _find_nodes_by_type(nodes, "llm")

    if not llm_nodes:
        return

    mimo = get_provider("mimo")
    completed = 0
    total = len(llm_nodes)

    for node in llm_nodes:
        if ctx.abort_ref.get("current", False):
            return

        # Get input from upstream
        upstream_image = _get_upstream_image(node["id"], ctx)
        prompt = node.get("prompt", "分析图片内容")

        ctx.on_progress(PipelineProgress(
            stage="analyze", step=completed + 1, total=total,
            message=f"分析中 · {prompt[:20]}",
        ))

        try:
            if upstream_image:
                result = await mimo.analyze(image_url=upstream_image, prompt=prompt)
            else:
                result = prompt  # No image upstream, pass through prompt

            ctx.node_outputs[node["id"]] = NodeOutput(
                node_id=node["id"], node_type="llm", result=result,
            )
        except Exception as e:
            logger.warning(f"LLM analysis failed for node {node['id']}: {e}")
            ctx.node_outputs[node["id"]] = NodeOutput(
                node_id=node["id"], node_type="llm", result=prompt, error=str(e),
            )

        completed += 1

    ctx.on_progress(PipelineProgress(
        stage="analyze", step=total, total=total,
        message=f"LLM 分析完成 · {total} 个节点",
    ))


# ============================================================================
# Stage 3: Generate (concurrent image generation)
# ============================================================================

# Node types that are treated as "generators" (produce images)
GENERATOR_TYPES = {"generator", "msgen", "comfy", "rh", "video", "ltxDirector"}


async def stage_generate(ctx: PipelineContext, config: dict[str, Any] | None = None) -> None:
    """Generate: call image generation providers for all generator-type nodes."""
    _ = config
    nodes = ctx.runtime_template.get("nodes") or ctx.runtime_template.get("canvas_nodes") or []
    gen_nodes = [n for n in nodes if isinstance(n, dict) and n.get("type") in GENERATOR_TYPES]

    if not gen_nodes:
        ctx.on_progress(PipelineProgress(
            stage="generate", step=0, total=0, message="无生成节点",
        ))
        return

    concurrency = ctx.generate_concurrency
    total_tasks = len(gen_nodes)
    completed_count = 0
    completed_lock = asyncio.Lock()

    sem = asyncio.Semaphore(concurrency)

    ctx.on_progress(PipelineProgress(
        stage="generate", step=0, total=total_tasks,
        message=f"{concurrency}路并发 · 生图中",
    ))

    async def run_gen(node: dict) -> None:
        nonlocal completed_count

        if ctx.abort_ref.get("current", False):
            return

        async with sem:
            provider_name = node.get("apiProvider", "auto")
            provider = get_provider(provider_name)

            # Gather inputs from upstream nodes
            prompt = ""
            ref_image = None
            connections = ctx.runtime_template.get("connections") or ctx.runtime_template.get("canvas_connections") or []
            for conn in connections:
                if conn.get("to") == node["id"]:
                    upstream_output = ctx.node_outputs.get(conn["from"])
                    if upstream_output:
                        if upstream_output.node_type == "prompt":
                            prompt = upstream_output.result or ""
                        elif upstream_output.node_type == "image":
                            ref_image = upstream_output.result
                        elif upstream_output.node_type == "llm":
                            # LLM output can be used as prompt
                            if not prompt:
                                prompt = upstream_output.result or ""

            if not prompt:
                prompt = DEFAULT_PROMPT

            try:
                result = await provider.generate(
                    prompt=prompt,
                    ref_image_url=ref_image,
                    ratio=node.get("ratio", "square"),
                    resolution=node.get("resolution", "2k"),
                )

                async with completed_lock:
                    completed_count += 1
                    current = completed_count

                ctx.on_progress(PipelineProgress(
                    stage="generate", step=current, total=total_tasks,
                    message=f"生图 {current}/{total_tasks}",
                ))

                ctx.node_outputs[node["id"]] = NodeOutput(
                    node_id=node["id"], node_type="generator",
                    result=result.urls if result.success else None,
                    error=result.error if not result.success else None,
                )

                # Also store in row_results for backward compatibility
                if result.success and result.urls:
                    entry = ctx.runtime_template.setdefault("_results", {})
                    entry.setdefault(node["id"], {"urls": [], "error": ""})
                    entry[node["id"]]["urls"].extend(result.urls)
                    ctx.on_row_result(node["id"], result.urls, [])

            except Exception as e:
                if ctx.abort_ref.get("current", False):
                    return

                async with completed_lock:
                    completed_count += 1

                err_msg = str(e)[:80]
                logger.warning(f"Generation failed for node {node['id']}: {err_msg}")

                ctx.node_outputs[node["id"]] = NodeOutput(
                    node_id=node["id"], node_type="generator",
                    result=None, error=err_msg,
                )

                ctx.on_row_result(node["id"], [], [err_msg])

    await asyncio.gather(*[run_gen(n) for n in gen_nodes])

    ctx.on_progress(PipelineProgress(
        stage="generate", step=total_tasks, total=total_tasks,
        message=f"生图完成 · {completed_count} 张",
    ))


# ============================================================================
# Stage 4: Validate (quality check generated images)
# ============================================================================

async def stage_validate(ctx: PipelineContext, config: dict[str, Any] | None = None) -> None:
    """Validate: quality check generated images."""
    _ = config
    nodes = ctx.runtime_template.get("nodes") or ctx.runtime_template.get("canvas_nodes") or []

    # Find all generator outputs
    gen_nodes = _find_nodes_by_type(nodes, "generator")
    gen_outputs = [
        ctx.node_outputs[n["id"]]
        for n in gen_nodes
        if n["id"] in ctx.node_outputs and ctx.node_outputs[n["id"]].result
    ]

    if not gen_outputs:
        return

    mimo = get_provider("mimo")
    validated = 0

    for output in gen_outputs:
        if ctx.abort_ref.get("current", False):
            return

        if output.result and isinstance(output.result, list):
            for url in output.result:
                try:
                    score = await mimo.validate(image_url=url)
                    output.metadata.setdefault("scores", []).append(score)
                    validated += 1
                except Exception as e:
                    logger.warning(f"Validation failed for {output.node_id}: {e}")

    ctx.on_progress(PipelineProgress(
        stage="validate", step=validated, total=validated,
        message=f"校验完成 · {validated} 张",
    ))


# ============================================================================
# Stage 5: Finalize
# ============================================================================

async def stage_finalize(ctx: PipelineContext, config: dict[str, Any] | None = None) -> None:
    """Finalize: collect results from output nodes."""
    _ = config
    nodes = ctx.runtime_template.get("nodes") or ctx.runtime_template.get("canvas_nodes") or []
    output_nodes = _find_nodes_by_type(nodes, "output")

    results = []
    for node in output_nodes:
        connections = ctx.runtime_template.get("connections") or ctx.runtime_template.get("canvas_connections") or []
        for conn in connections:
            if conn.get("to") == node["id"]:
                upstream = ctx.node_outputs.get(conn["from"])
                if upstream and upstream.result:
                    if isinstance(upstream.result, list):
                        results.extend(upstream.result)
                    else:
                        results.append(upstream.result)

    ctx.node_outputs["__final__"] = NodeOutput(
        node_id="__final__", node_type="output", result=results,
    )

    ctx.on_progress(PipelineProgress(stage="finalize", step=0, total=0, message="完成"))


# ============================================================================
# Stage Registry
# ============================================================================

stage_registry: dict[str, Callable[[PipelineContext, dict[str, Any] | None], Any]] = {
    "prepare": stage_prepare,
    "analyze": stage_analyze,
    "generate": stage_generate,
    "validate": stage_validate,
    "finalize": stage_finalize,
}
