"""
Parameter injection engine for template-driven workflows.

Two mechanisms, applied in order:
  1. Node-based injection (exposed_mapping): maps variable → node_id + path
  2. Placeholder substitution ({{key}}): recursively walks entire template JSON,
     replacing any string containing {{key}} with the corresponding dynamic_inputs value.

This dual approach means:
  - Presets can use exposed_mapping for precise field control + form generation
  - Canvas workflows can simply set a prompt node's text to {{prompt}} and it just works
  - No dependency on matching node IDs for placeholder-based params
"""

from __future__ import annotations

import copy
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

# Matches {{key}} — supports optional spaces inside braces: {{ prompt }}, {{image_url}}
_PLACEHOLDER_RE = re.compile(r'\{\{\s*(\w+)\s*\}\}')


class InjectionError(Exception):
    """Raised when required variables are missing."""
    pass


# ============================================================================
# Placeholder Substitution (NEW — the core fix)
# ============================================================================

def _substitute_placeholders(obj: Any, dynamic_inputs: dict[str, Any]) -> Any:
    """
    Recursively walk obj and replace any string containing {{key}}
    with the corresponding value from dynamic_inputs.

    If a key is not found in dynamic_inputs, the placeholder is left unchanged.
    """

    if isinstance(obj, str):
        def _replacer(m: re.Match) -> str:
            key = m.group(1)
            val = dynamic_inputs.get(key)
            if val is not None:
                return str(val)
            return m.group(0)  # keep original placeholder
        return _PLACEHOLDER_RE.sub(_replacer, obj)

    if isinstance(obj, dict):
        return {k: _substitute_placeholders(v, dynamic_inputs) for k, v in obj.items()}

    if isinstance(obj, list):
        return [_substitute_placeholders(item, dynamic_inputs) for item in obj]

    return obj


def _scan_placeholders(obj: Any, found: set[str] | None = None) -> set[str]:
    """
    Recursively scan obj for {{key}} patterns.
    Returns the set of unique keys found.
    Used to auto-detect exposed fields when exposed_mapping is absent.
    """
    if found is None:
        found = set()

    if isinstance(obj, str):
        for m in _PLACEHOLDER_RE.finditer(obj):
            found.add(m.group(1))

    elif isinstance(obj, dict):
        for v in obj.values():
            _scan_placeholders(v, found)

    elif isinstance(obj, list):
        for item in obj:
            _scan_placeholders(item, found)

    return found


# ============================================================================
# Path utilities (for node-based injection — kept for backward compat)
# ============================================================================

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
      (nodes_dict, "comfy_dict")   → ComfyUI-style:  {"23": {"inputs": {...}}, ...}
      (nodes_list, "vf_list")      → VF-style:        [{"id": "n1", ...}, ...]
      ({}, "none")                 → no nodes found
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


# ============================================================================
# Main Injection Function
# ============================================================================

def _check_restart_flag() -> None:
    """If a restart.flag file exists in the server directory, kill and restart the backend."""
    import subprocess, time as _time
    flag_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "restart.flag")
    if os.path.exists(flag_path):
        logger.info("Restart flag detected — restarting backend...")
        try:
            os.remove(flag_path)
        except Exception:
            pass
        server_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        python_exe = os.path.join(server_dir, "python", "python.exe")
        main_py = os.path.join(server_dir, "main.py")
        # Spawn a detached process that waits, kills, and restarts
        if os.path.exists(python_exe) and os.path.exists(main_py):
            subprocess.Popen(
                [
                    python_exe, "-c",
                    f"import subprocess, time, os, sys;"
                    f"time.sleep(2);"
                    f"os.chdir(r'{server_dir}');"
                    f"subprocess.run('for /f \"tokens=5\" %a in (\\'netstat -ano ^| findstr \":3000\" ^| findstr LISTENING\\') do taskkill /f /pid %a', shell=True);"
                    f"time.sleep(1);"
                    f"subprocess.Popen([r'{python_exe}', r'{main_py}'], creationflags=subprocess.CREATE_NEW_CONSOLE);"
                ],
                creationflags=subprocess.CREATE_NEW_CONSOLE if hasattr(subprocess, "CREATE_NEW_CONSOLE") else 0,
            )
    # Also check for frontend restart flag
    flag_path_fe = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "web", "restart_fe.flag")
    if os.path.exists(flag_path_fe):
        logger.info("Frontend restart flag detected — restarting frontend...")
        try:
            os.remove(flag_path_fe)
        except Exception:
            pass
        web_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "web")
        if os.path.exists(web_dir):
            subprocess.Popen(
                [
                    "cmd", "/c",
                    f"cd /d {web_dir} && "
                    f"for /f \"tokens=5\" %a in ('netstat -ano ^| findstr \":5174\" ^| findstr LISTENING') do taskkill /f /pid %a && "
                    f"timeout /t 2 /nobreak >nul && "
                    f"start /MIN npx vite --host 0.0.0.0 --port 5174"
                ],
                creationflags=subprocess.CREATE_NEW_CONSOLE if hasattr(subprocess, "CREATE_NEW_CONSOLE") else 0,
            )


def inject_parameters(template: dict, dynamic_inputs: dict[str, Any]) -> dict:
    """
    Deep-copy template, inject dynamic_inputs in two passes:

    Pass 1 — Node-based injection (exposed_mapping):
      Uses exposed_mapping to target specific node_id + path combinations.
      Handles structured fields (select options, etc.) precisely.

    Pass 2 — Placeholder substitution ({{key}}):
      Recursively walks the entire template and replaces any {{key}} string
      with the corresponding dynamic_inputs value.
      Works regardless of node IDs — ideal for canvas workflows.

    Returns: runtime dict with injected values.
    Raises: InjectionError if required keys are missing (only from node-based injection).
    """
    # Check for restart flag on each invocation
    _check_restart_flag()

    runtime = copy.deepcopy(template)

    # ── Pass 1: Node-based injection (existing logic) ──
    mapping = runtime.pop("exposed_mapping", {}) or {}
    if mapping:
        container, style = _resolve_node_container(runtime)
        if style != "none":
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
                        # Re-attach mapping before raising
                        runtime["exposed_mapping"] = mapping
                        raise InjectionError(f"Required variable '{var_name}' is missing")
                    continue

                if node_id not in node_index:
                    logger.warning(
                        f"Node '{node_id}' not found for variable '{var_name}' "
                        f"(available: {list(node_index.keys())[:10]})"
                    )
                    continue

                _set_by_path(node_index[node_id], path, value)
                injected_count += 1
                logger.debug(f"Injected '{var_name}' → node '{node_id}' path {path} = {str(value)[:80]}")

            logger.info(f"Node-based injection: {injected_count}/{len(mapping)} variables injected")

        # Re-attach mapping for downstream consumers
        runtime["exposed_mapping"] = mapping

    # ── Pass 2: Placeholder substitution (new — {{key}} → value) ──
    if dynamic_inputs:
        runtime = _substitute_placeholders(runtime, dynamic_inputs)
        # Also substitute in the exposed_mapping itself (for defaults etc.)
        if runtime.get("exposed_mapping"):
            runtime["exposed_mapping"] = _substitute_placeholders(runtime["exposed_mapping"], dynamic_inputs)

    return runtime


# ============================================================================
# Exposed Fields for Frontend Form Generation
# ============================================================================

def get_exposed_fields(template: dict) -> list[dict]:
    """
    Return the list of exposed fields for frontend form generation.

    Priority:
      1. explicit exposed_mapping (if defined)
      2. auto-scanned {{key}} placeholders from the template JSON
    """
    mapping = template.get("exposed_mapping", {})
    fields: list[dict] = []
    seen_names: set[str] = set()

    # ── Source 1: explicit exposed_mapping ──
    if mapping:
        for var_name, var_def in mapping.items():
            if not isinstance(var_def, dict):
                continue
            seen_names.add(var_name)
            fields.append({
                "name": var_name,
                "label": var_def.get("label", var_name),
                "type": var_def.get("type", "text"),
                "required": var_def.get("required", False),
                "default": var_def.get("default"),
                "options": var_def.get("options", []),
                "placeholder": var_def.get("placeholder", ""),
            })

    # ── Source 2: auto-scan {{key}} placeholders ──
    try:
        scanned = _scan_placeholders(template)
        for key in sorted(scanned):
            if key not in seen_names:
                seen_names.add(key)
                # Guess type based on key name
                field_type = "text"
                if "image" in key.lower() or "img" in key.lower() or "url" in key.lower():
                    field_type = "image"
                elif "ratio" in key.lower() or "aspect" in key.lower():
                    field_type = "select"
                elif "resolution" in key.lower() or "quality" in key.lower():
                    field_type = "select"
                elif "provider" in key.lower():
                    field_type = "select"

                fields.append({
                    "name": key,
                    "label": key.replace("_", " ").title(),
                    "type": field_type,
                    "required": False,
                    "default": "",
                    "options": [],
                    "placeholder": f"输入 {key}",
                })
    except Exception:
        logger.warning("Auto-scan for placeholders failed, using only explicit fields", exc_info=True)

    return fields
