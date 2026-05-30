"""
Parameter injection engine for template-driven workflows.

Deep-copies a workflow template and injects dynamic_inputs
based on the template's exposed_mapping.

Supports two node storage formats:
  - List format:  {"canvas_nodes": [{"id": "n1", ...}, ...]}   (VF canvas)
  - Dict format:  {"23": {"inputs": {"text": ""}}, ...}         (ComfyUI)
"""

from __future__ import annotations

import copy
import logging
from typing import Any

logger = logging.getLogger(__name__)


class InjectionError(Exception):
    """Raised when required variables are missing."""
    pass


def _normalize_path(path: list[str] | str) -> list[str]:
    """Normalize path to list-of-keys. Accepts dot-notation strings."""
    if isinstance(path, str):
        return [p for p in path.split(".") if p]
    if isinstance(path, (list, tuple)):
        return list(path)
    raise InjectionError(f"Invalid path type: {type(path)} — expected list or dot-notation string")


def _resolve_node_container(runtime: dict) -> tuple[dict, str]:
    """
    Detect the node container style and return (container, key_name).

    Returns:
      (nodes_dict, "dict")   → ComfyUI-style:  {"23": {"inputs": {...}}, ...}
      (nodes_list, "list")   → VF-style:       [{"id": "n1", ...}, ...]
      ({}, "none")           → no nodes found
    """
    # ComfyUI-style: top-level keys that look like node IDs (numeric strings)
    numeric_keys = [k for k in runtime if isinstance(k, str) and k.isdigit()]
    if numeric_keys and all(isinstance(runtime[k], dict) for k in numeric_keys[:3]):
        return runtime, "comfy_dict"

    # VF list-style
    for key in ("canvas_nodes", "nodes"):
        val = runtime.get(key)
        if isinstance(val, list) and len(val) > 0:
            return runtime, "vf_list"

    return runtime, "none"


def _build_node_index(container: dict, container_style: str) -> dict[str, Any]:
    """Build a dict mapping node_id → node reference."""
    if container_style == "comfy_dict":
        return {k: container[k] for k in container if isinstance(k, str) and k.isdigit()}

    if container_style == "vf_list":
        for key in ("canvas_nodes", "nodes"):
            val = container.get(key)
            if isinstance(val, list):
                return {n.get("id"): n for n in val if isinstance(n, dict) and n.get("id")}
        return {}

    return {}


def _set_by_path(target: dict, path: list[str], value: Any) -> None:
    """Traverse path, creating intermediate dicts as needed, then set the final key."""
    for key in path[:-1]:
        if key not in target or not isinstance(target[key], dict):
            target[key] = {}
        target = target[key]
    target[path[-1]] = value


def inject_parameters(template: dict, dynamic_inputs: dict[str, Any]) -> dict:
    """
    Deep-copy template, inject dynamic_inputs based on exposed_mapping.

    Template examples:

    VF canvas format:
    {
        "canvas_nodes": [{"id": "img1", "type": "image", "url": "", ...}, ...],
        "exposed_mapping": {
            "user_prompt": {"node_id": "p1", "path": ["text"], "label": "提示词"},
            "product_img": {"node_id": "img1", "path": ["url"], "label": "产品图"}
        }
    }

    ComfyUI format:
    {
        "23": {"inputs": {"text": ""}, "class_type": "CLIPTextEncode"},
        "144": {"inputs": {"width": 1024, "height": 1024}},
        "exposed_mapping": {
            "user_prompt": {"node_id": "23", "path": "inputs.text", "label": "提示词"},
            "image_size": {"node_id": "144", "path": ["inputs", "width"], "label": "宽度"}
        }
    }

    dynamic_inputs format:
    {
        "user_prompt": "一个超模在巴黎街头街拍",
        "product_img": "https://example.com/image.jpg"
    }

    Returns: runtime dict with injected values.
    Raises: InjectionError if required keys are missing.
    """
    runtime = copy.deepcopy(template)

    mapping = runtime.pop("exposed_mapping", {}) or {}
    if not mapping:
        return runtime

    container, style = _resolve_node_container(runtime)
    if style == "none":
        # Re-insert mapping for downstream consumers
        runtime["exposed_mapping"] = mapping
        logger.warning("No recognized node container found in template; injection skipped")
        return runtime

    node_index = _build_node_index(container, style)

    injected_count = 0
    for var_name, var_def in mapping.items():
        if not isinstance(var_def, dict):
            continue

        node_id = var_def.get("node_id")
        raw_path = var_def.get("path", [])
        required = var_def.get("required", False)
        default = var_def.get("default")

        path = _normalize_path(raw_path)

        value = dynamic_inputs.get(var_name)
        if value is None or value == "":
            value = default

        if value is None or value == "":
            if required:
                raise InjectionError(f"Required variable '{var_name}' is missing")
            continue

        if node_id not in node_index:
            logger.warning(
                f"Node '{node_id}' not found for variable '{var_name}' "
                f"(available: {list(node_index.keys())[:10]})"
            )
            continue

        node = node_index[node_id]
        _set_by_path(node, path, value)
        injected_count += 1
        logger.debug(f"Injected '{var_name}' → node '{node_id}' path {path} = {str(value)[:80]}")

    # Re-attach mapping for downstream consumers (get_exposed_fields, etc.)
    runtime["exposed_mapping"] = mapping
    logger.info(f"Parameter injection complete: {injected_count} / {len(mapping)} variables injected")
    return runtime


def get_exposed_fields(template: dict) -> list[dict]:
    """Return the list of exposed fields for frontend form generation."""
    mapping = template.get("exposed_mapping", {})
    fields = []
    for var_name, var_def in mapping.items():
        if not isinstance(var_def, dict):
            continue
        fields.append({
            "name": var_name,
            "label": var_def.get("label", var_name),
            "type": var_def.get("type", "text"),
            "required": var_def.get("required", False),
            "default": var_def.get("default"),
            "options": var_def.get("options", []),
            "placeholder": var_def.get("placeholder", ""),
        })
    return fields
