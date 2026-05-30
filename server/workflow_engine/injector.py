"""
Parameter injection engine for template-driven workflows.

Deep-copies a workflow template and injects dynamic_inputs
based on the template's exposed_mapping.
"""

from __future__ import annotations

import copy
import logging
from typing import Any

logger = logging.getLogger(__name__)


class InjectionError(Exception):
    """Raised when required variables are missing."""
    pass


def inject_parameters(template: dict, dynamic_inputs: dict[str, Any]) -> dict:
    """
    Deep-copy template, inject dynamic_inputs based on exposed_mapping.

    Template format:
    {
        "nodes": [{"id": "node1", "type": "image", "url": "", ...}, ...],
        "connections": [...],
        "exposed_mapping": {
            "product_image": {"node_id": "image1", "path": ["url"], "required": true, ...},
            "user_prompt": {"node_id": "prompt1", "path": ["text"], "required": false, ...}
        }
    }

    dynamic_inputs format:
    {
        "product_image": "https://...",
        "user_prompt": "一个超模在巴黎街头街拍"
    }

    Returns: runtime dict with injected values.
    Raises: InjectionError if required keys are missing.
    """
    runtime = copy.deepcopy(template)

    mapping = runtime.get("exposed_mapping", {})
    if not mapping:
        return runtime

    # Build node_id → node index
    # Support both "nodes" and "canvas_nodes" keys
    nodes = runtime.get("nodes") or runtime.get("canvas_nodes") or []
    if isinstance(nodes, list):
        node_map = {n.get("id"): i for i, n in enumerate(nodes) if isinstance(n, dict) and n.get("id")}
    else:
        node_map = {}

    for var_name, var_def in mapping.items():
        if not isinstance(var_def, dict):
            continue

        node_id = var_def.get("node_id")
        path = var_def.get("path", [])
        required = var_def.get("required", False)
        default = var_def.get("default")

        value = dynamic_inputs.get(var_name)

        if value is None:
            value = default

        if value is None:
            if required:
                raise InjectionError(f"Required variable '{var_name}' is missing")
            continue

        if node_id not in node_map:
            logger.warning(f"Node '{node_id}' not found for variable '{var_name}'")
            continue

        # Traverse path and set value
        node = nodes[node_map[node_id]]
        target = node
        for key in path[:-1]:
            if key not in target:
                target[key] = {}
            target = target[key]
        target[path[-1]] = value

        logger.debug(f"Injected '{var_name}' → node '{node_id}' path {path}")

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
