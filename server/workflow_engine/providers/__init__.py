"""
Provider registry and exports.

All API keys come from os.getenv() with defaults from existing hardcoded values.
"""

from __future__ import annotations

from typing import Any

from .base import BaseProvider, ProviderResult
from .yunwu import YunwuProvider
from .grsai import GrsAIProvider
from .mimo import MiMoProvider
from .llm import LLMProvider
from .comfyui import ComfyUIProvider
from .runninghub import RunningHubProvider
from .key_pool import (
    KeyPool,
    KeyState,
    KeyStats,
    merge_pool,
    sync_key_pools,
    get_pool_capacity,
    get_total_capacity,
    available_key_count,
)

# ============================================================================
# Provider Registry
# ============================================================================

# Singleton instances
_yunwu: YunwuProvider | None = None
_grsai: GrsAIProvider | None = None
_mimo: MiMoProvider | None = None
_llm: LLMProvider | None = None
_comfyui: ComfyUIProvider | None = None
_runninghub: RunningHubProvider | None = None


def get_provider(name: str) -> BaseProvider:
    """Get a provider instance by name.

    ``"auto"`` defaults to YunwuProvider (the most stable provider).
    Use ``get_provider_for_model(model_id)`` to pick the best provider
    for a specific model, and pass that result here.
    """
    global _yunwu, _grsai, _mimo, _llm, _comfyui, _runninghub

    name_lower = name.lower().strip()

    if name_lower == "yunwu":
        if _yunwu is None:
            _yunwu = YunwuProvider()
        return _yunwu

    if name_lower == "grsai":
        if _grsai is None:
            _grsai = GrsAIProvider()
        return _grsai

    # "auto" — default to Yunwu (most stable, supports all models)
    if name_lower == "auto":
        if _yunwu is None:
            _yunwu = YunwuProvider()
        return _yunwu

    if name_lower == "mimo":
        if _mimo is None:
            _mimo = MiMoProvider()
        return _mimo

    if name_lower in ("llm", "deepseek"):
        if _llm is None:
            _llm = LLMProvider()
        return _llm

    if name_lower in ("comfyui", "comfy"):
        if _comfyui is None:
            _comfyui = ComfyUIProvider()
        return _comfyui

    if name_lower in ("runninghub", "rh"):
        if _runninghub is None:
            _runninghub = RunningHubProvider()
        return _runninghub

    # Default to Yunwu
    if _yunwu is None:
        _yunwu = YunwuProvider()
    return _yunwu


# Provider name → class mapping
PROVIDER_CLASSES: dict[str, type[BaseProvider]] = {
    "yunwu": YunwuProvider,
    "grsai": GrsAIProvider,
    "mimo": MiMoProvider,
    "llm": LLMProvider,
    "comfyui": ComfyUIProvider,
    "comfy": ComfyUIProvider,
    "runninghub": RunningHubProvider,
    "rh": RunningHubProvider,
    "auto": YunwuProvider,
}

# Preset name → provider name mapping
PROVIDER_PRESETS: dict[str, str] = {
    "nano-banana": "grsai",
    "gpt-image-2-vip": "grsai",
    "gpt-image-2": "grsai",
    "gpt-image-2-all": "yunwu",
    "gpt-image-1-mini": "yunwu",
}


def get_provider_for_model(model_id: str) -> str:
    """Determine provider name from model_id."""
    for prefix, provider in PROVIDER_PRESETS.items():
        if model_id.startswith(prefix):
            return provider
    return "yunwu"


__all__ = [
    "BaseProvider",
    "ProviderResult",
    "YunwuProvider",
    "GrsAIProvider",
    "MiMoProvider",
    "LLMProvider",
    "ComfyUIProvider",
    "RunningHubProvider",
    "KeyPool",
    "KeyState",
    "KeyStats",
    "get_provider",
    "get_provider_for_model",
    "PROVIDER_CLASSES",
    "PROVIDER_PRESETS",
    "merge_pool",
    "sync_key_pools",
    "get_pool_capacity",
    "get_total_capacity",
    "available_key_count",
]
