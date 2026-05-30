"""
画布节点类型 → 后端执行函数映射表
===============================

将无限画布上拖拽的节点类型映射到 backend workflow engine 的实际处理函数。
当画布保存为工作流模板时，每个 node.type 对应这里的一个 handler。

分类：
  image     — 图片输入节点
  prompt    — 提示词节点
  llm       — LLM 分析节点
  generator — 生图引擎节点
  output    — 输出节点
  loop      — 循环节点
  group     — 分组节点
"""

from __future__ import annotations

from typing import Any, Callable, Coroutine, Optional

from .types import PipelineContext, NodeOutput

# 节点处理函数签名: async (node_dict, ctx) -> NodeOutput
NodeHandler = Callable[..., Coroutine[Any, Any, Optional[NodeOutput]]]


# ============================================================================
# Node Execution Helpers
# ============================================================================

async def execute_image_node(node: dict, ctx: PipelineContext) -> NodeOutput:
    """Execute an image input node — just pass through the URL."""
    url = node.get("url", "")
    return NodeOutput(node_id=node["id"], node_type="image", result=url)


async def execute_prompt_node(node: dict, ctx: PipelineContext) -> NodeOutput:
    """Execute a prompt node — pass through the text."""
    text = node.get("text", "")
    return NodeOutput(node_id=node["id"], node_type="prompt", result=text)


async def execute_llm_node(node: dict, ctx: PipelineContext) -> NodeOutput:
    """Execute an LLM analysis node."""
    from .providers import get_provider

    provider = get_provider("mimo")
    # Get upstream image
    upstream = _get_upstream(node["id"], ctx)
    prompt = node.get("prompt", "分析图片内容")

    if upstream:
        result = await provider.analyze(image_url=upstream, prompt=prompt)
    else:
        result = prompt

    return NodeOutput(node_id=node["id"], node_type="llm", result=result)


# Default prompt used when no upstream prompt node is connected
DEFAULT_PROMPT = (
    "Professional product photo of a fashion item, "
    "clean background, studio lighting, high quality, 8K, commercial photography"
)

# Regex for detecting unresolved {{key}} placeholders
import re as _re
_UNRESOLVED_PLACEHOLDER_RE = _re.compile(r'\{\{\s*\w+\s*\}\}')

# Model fallback chain: try these models in order until one succeeds
# gpt-image-2 first (most reliable), then VIP, then cross-provider fallbacks
MODEL_FALLBACK_CHAIN = ["gpt-image-2", "gpt-image-2-vip", "gpt-image-1-mini", "gpt-image-2-all"]


async def _try_generate(provider, prompt, ref_image_url, ratio, resolution, model_id, **kwargs) -> ProviderResult:
    """Try generating with a specific provider+model. Returns result (may be failed)."""
    from .providers.base import ProviderResult as PR
    try:
        return await provider.generate(
            prompt=prompt, ref_image_url=ref_image_url,
            ratio=ratio, resolution=resolution,
            model_id=model_id, **kwargs,
        )
    except Exception as e:
        return PR(success=False, error=str(e)[:200])


def _looks_like_placeholder(val: str | None) -> bool:
    """Check if a string looks like an unresolved {{key}} placeholder."""
    if not val or not isinstance(val, str):
        return False
    return bool(_UNRESOLVED_PLACEHOLDER_RE.search(val))


async def execute_generator_node(node: dict, ctx: PipelineContext) -> NodeOutput:
    """
    Execute a generator-type node (generator / msgen).

    DAG execution with model-aware routing + fallback:
      1. Extract prompt + ref_image from upstream DAG connections
      2. Build attempt list: user model → full fallback chain
         Each attempt resolves provider from get_provider_for_model()
         (or uses user-specified provider if not "auto")
      3. Try each attempt until one succeeds
      4. Return first successful result or the last error
    """
    from .providers import get_provider, get_provider_for_model

    logger = __import__('logging').getLogger(__name__)

    # ── Step 1: Extract inputs from upstream DAG connections ──
    prompt = ""
    ref_image = None
    connections = ctx.runtime_template.get("connections") or ctx.runtime_template.get("canvas_connections") or []
    for conn in connections:
        if conn.get("to") == node["id"]:
            upstream_output = ctx.node_outputs.get(conn["from"])
            if upstream_output:
                if upstream_output.node_type == "prompt":
                    raw = upstream_output.result or ""
                    # Filter out unresolved placeholders
                    prompt = raw if not _looks_like_placeholder(raw) else ""
                elif upstream_output.node_type == "image":
                    raw = upstream_output.result
                    # Only use as ref_image if it's a real URL, not a placeholder
                    if raw and not _looks_like_placeholder(raw):
                        ref_image = raw
                elif upstream_output.node_type == "llm":
                    if not prompt:
                        raw = upstream_output.result or ""
                        prompt = raw if not _looks_like_placeholder(raw) else ""

    if not prompt:
        prompt = node.get("prompt", "") or node.get("text", "") or DEFAULT_PROMPT
        # Also filter the fallback
        if _looks_like_placeholder(prompt):
            prompt = DEFAULT_PROMPT

    # ── Step 2: Extract generation params from node properties ──
    ratio = node.get("ratio", "square")
    resolution = node.get("resolution", "2k")
    node_model = node.get("model", "") or node.get("modelId", "")
    width = node.get("width")
    height = node.get("height")

    user_provider = node.get("apiProvider", "auto")

    # ── Step 3: Build attempt list with model-aware routing ──
    attempts: list[tuple[str, str]] = []  # (provider_name, model_id)
    tried_models: set[str] = set()

    if node_model:
        # Resolve provider: if user chose "auto", use model-specific mapping
        if user_provider == "auto":
            prov = get_provider_for_model(node_model)
        else:
            prov = user_provider
        attempts.append((prov, node_model))
        tried_models.add(node_model)

    # Add fallback chain entries (skip already-tried models)
    for m in MODEL_FALLBACK_CHAIN:
        if m in tried_models:
            continue
        attempts.append((get_provider_for_model(m), m))
        tried_models.add(m)

    last_error = ""
    for i, (prov_name, model_id) in enumerate(attempts):
        provider = get_provider(prov_name)
        logger.info(
            f"[DAG] Node '{node['id']}' attempt {i+1}/{len(attempts)}: "
            f"provider={prov_name}, model={model_id}, prompt_len={len(prompt)}, "
            f"ref_image={'yes' if ref_image else 'no'}"
        )
        result = await _try_generate(
            provider, prompt, ref_image, ratio, resolution, model_id,
            width=width if width else None, height=height if height else None,
        )
        if result.success:
            logger.info(f"[DAG] Node '{node['id']}' SUCCESS: {len(result.urls)} urls")
            return NodeOutput(
                node_id=node["id"], node_type=node.get("type", "generator"),
                result=result.urls, error="",
            )
        last_error = result.error or "unknown"
        logger.warning(f"[DAG] Node '{node['id']}' attempt {i+1} failed: {last_error[:120]}")

    # All attempts failed
    logger.error(f"[DAG] Node '{node['id']}' ALL {len(attempts)} ATTEMPTS FAILED. Last error: {last_error[:200]}")
    return NodeOutput(
        node_id=node["id"], node_type=node.get("type", "generator"),
        result=None, error=f"[{len(attempts)} attempts exhausted] {last_error[:300]}",
    )


def _get_upstream(node_id: str, ctx: PipelineContext) -> Any:
    """Get the first upstream output for a node."""
    connections = ctx.runtime_template.get("connections") or ctx.runtime_template.get("canvas_connections") or []
    for conn in connections:
        if conn.get("to") == node_id:
            upstream = ctx.node_outputs.get(conn["from"])
            if upstream and upstream.result is not None:
                return upstream.result
    return None


# ============================================================================
# Node Type Map
# ============================================================================

NODE_TYPE_MAP: dict[str, dict[str, Any]] = {
    "image": {
        "label": "图片输入",
        "icon": "🖼",
        "stage": "prepare",
        "description": "输入图片（商品图/模特图/参考图）",
        "handler": execute_image_node,
    },
    "prompt": {
        "label": "提示词",
        "icon": "📝",
        "stage": "analyze",
        "description": "文本提示词输入",
        "handler": execute_prompt_node,
    },
    "llm": {
        "label": "LLM分析",
        "icon": "🧠",
        "stage": "analyze",
        "description": "MiMo 多模态视觉分析",
        "handler": execute_llm_node,
    },
    "generator": {
        "label": "生图引擎",
        "icon": "🎨",
        "stage": "generate",
        "description": "API 生图节点 — 调用 Yunwu/Grsai 引擎",
        "handler": execute_generator_node,
    },
    "msgen": {
        "label": "MS生图",
        "icon": "☁️",
        "stage": "generate",
        "description": "ModelScope 生图节点 — 调用 Yunwu/Grsai 引擎",
        "handler": execute_generator_node,
    },
    "output": {
        "label": "输出",
        "icon": "📤",
        "stage": "finalize",
        "description": "汇总所有生成结果",
        "handler": None,
    },
    "loop": {
        "label": "循环",
        "icon": "🔄",
        "stage": "generate",
        "description": "循环执行节点",
        "handler": None,
    },
    "group": {
        "label": "分组",
        "icon": "📁",
        "stage": "generate",
        "description": "节点分组",
        "handler": None,
    },
}


# ============================================================================
# Query Functions
# ============================================================================

def get_node_label(node_type: str) -> str:
    """获取节点类型的显示标签"""
    return NODE_TYPE_MAP.get(node_type, {}).get("label", node_type)


def get_node_stage(node_type: str) -> str:
    """获取节点类型对应的执行阶段"""
    return NODE_TYPE_MAP.get(node_type, {}).get("stage", "unknown")


def get_node_handler(node_type: str) -> Optional[NodeHandler]:
    """获取节点类型对应的处理函数"""
    entry = NODE_TYPE_MAP.get(node_type)
    return entry["handler"] if entry else None


def list_node_types() -> list[dict]:
    """列出所有可用节点类型（供前端画布使用）"""
    return [
        {
            "type": ntype,
            "label": info["label"],
            "icon": info["icon"],
            "stage": info["stage"],
            "description": info["description"],
        }
        for ntype, info in NODE_TYPE_MAP.items()
    ]
