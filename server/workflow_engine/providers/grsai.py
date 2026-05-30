"""
GrsAI image generation provider.

Extracted from stages.py — handles the GrsAI /v1/api/generate endpoint
with SSE/JSON response parsing and retry logic.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import os
import time
from typing import Any

import httpx

from .base import BaseProvider, ProviderResult
from .key_pool import KeyPool, merge_pool, acquire_key, release_key, _pool_for, _grsai_pool

logger = logging.getLogger(__name__)

# ============================================================================
# Configuration (from env with existing defaults)
# ============================================================================

# API base: use Vite proxy in dev (http://localhost:5174/grsai), override for production
GRSAI_BASE_URL = os.getenv("GRSAI_BASE_URL", "http://localhost:5174/grsai")
GRSAI_API_KEYS: list[str] = [
    os.getenv("GRSAI_KEY_1", "sk-ffb3791c8358419c931c85ba179abe8c"),
]
GRSAI_MAX_CONCURRENT_PER_KEY = 1
GRSAI_TIMEOUT = 180.0

# Default generation settings (shared)
DEFAULT_WIDTH = 2448
DEFAULT_HEIGHT = 3264

# ============================================================================#
# Internal Key Pool — USE SHARED POOL FROM key_pool.py
# ============================================================================#

# Use the global _grsai_pool from key_pool.py (not a local copy!)
_pool = _grsai_pool


def _sync_pool() -> None:
    now = time.time()
    keys = [k for k in GRSAI_API_KEYS if k.strip()]
    merge_pool(_pool, keys, 2_000, GRSAI_MAX_CONCURRENT_PER_KEY, now)


# ============================================================================
# Utility
# ============================================================================

def _bare_base64(data_url: str) -> str:
    if data_url.startswith("data:"):
        idx = data_url.find(",")
        return data_url[idx + 1:] if idx >= 0 else data_url
    return data_url


def _derive_aspect_ratio(w: int, h: int) -> str:
    if not w or not h:
        return "4:3"
    g = math.gcd(w, h)
    return f"{w // g}:{h // g}"


def _dig_url(obj: Any) -> str | None:
    """Recursively search an object for image URLs."""
    if not isinstance(obj, dict):
        return None

    for key in ("url", "image_url", "imageUrl", "imageurl", "src"):
        val = obj.get(key)
        if isinstance(val, str) and (val.startswith("http") or val.startswith("data:")):
            return val

    b64 = obj.get("b64_json") or obj.get("b64")
    if isinstance(b64, str) and len(b64) > 100:
        return f"data:image/png;base64,{b64}"

    for key in ("data", "result", "results", "output", "image", "images"):
        child = obj.get(key)
        if isinstance(child, list):
            for item in child:
                found = _dig_url(item)
                if found:
                    return found
        elif isinstance(child, dict):
            found = _dig_url(child)
            if found:
                return found

    for val in obj.values():
        if isinstance(val, str) and val.startswith("https://"):
            if any(ext in val for ext in (".png", ".jpg", "/file", "/output", "/result")):
                return val

    return None


# ============================================================================
# Response Parsing (preserved exactly from stages.py)
# ============================================================================

def _parse_grsai_response(raw: str) -> str:
    """Parse Grsai response (JSON or SSE)."""
    data: dict[str, Any] | None = None

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        if "data:" in raw:
            chunks = [line[6:] for line in raw.split("\n") if line.startswith("data: ")]
            for chunk in reversed(chunks):
                try:
                    data = json.loads(chunk)
                    break
                except json.JSONDecodeError:
                    continue

    if data is None:
        raise RuntimeError(f"Grsai response invalid: {raw[:300]}")

    if data.get("status") == "violation":
        raise RuntimeError("Grsai policy violation")
    if data.get("status") == "failed":
        err_detail = str(data.get("error", ""))[:300]
        raise RuntimeError(f"Grsai generation failed: {err_detail}")

    results = data.get("results", [])
    if isinstance(results, list) and results:
        url = results[0].get("url") if isinstance(results[0], dict) else None
        if url:
            return url

    if isinstance(data.get("url"), str):
        return data["url"]
    if isinstance(data.get("image_url"), str):
        return data["image_url"]

    found = _dig_url(data)
    if found:
        return found

    raise RuntimeError(f"Grsai no image URL in response: {raw[:300]}")


# ============================================================================
# HTTP Request Logic (preserved exactly from stages.py)
# ============================================================================

async def _grsai_generate(api_key: str, input_data: dict[str, Any]) -> str:
    """Generate image via Grsai."""
    w = input_data.get("width", DEFAULT_WIDTH) or DEFAULT_WIDTH
    h = input_data.get("height", DEFAULT_HEIGHT) or DEFAULT_HEIGHT
    prompt = input_data.get("prompt", "")
    model_image_b64 = input_data.get("modelImageBase64", "")
    product_image_b64 = input_data.get("productImageBase64", "")
    style_ref_b64 = input_data.get("styleRefBase64", "")
    detail_b64 = input_data.get("detailImageBase64", "")
    model_id = input_data.get("modelId", "gpt-image-2-vip")

    images: list[str] = []
    if model_image_b64:
        images.append(_bare_base64(model_image_b64))
    if product_image_b64:
        images.append(_bare_base64(product_image_b64))
    if style_ref_b64:
        images.append(_bare_base64(style_ref_b64))
    if detail_b64:
        images.append(_bare_base64(detail_b64))

    use_vip = model_id == "gpt-image-2-vip"
    aspect_ratio = f"{w}x{h}" if use_vip else _derive_aspect_ratio(w, h)
    model = "gpt-image-2-vip" if use_vip else "gpt-image-2"

    body: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "aspectRatio": aspect_ratio,
        "replyType": "json",
        "images": images,
    }

    endpoint = f"{GRSAI_BASE_URL}/v1/api/generate"
    for attempt in range(4):
        try:
            async with httpx.AsyncClient(timeout=GRSAI_TIMEOUT) as client:
                resp = await client.post(
                    endpoint,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}",
                    },
                    json=body,
                )
                if resp.status_code == 200:
                    return _parse_grsai_response(resp.text)
                raw = resp.text[:300]
                if resp.status_code == 429:
                    wait = [5, 10, 20][attempt] if attempt < 3 else 20
                    logger.warning(f"Grsai 429 rate limited, retry {attempt + 1}/3 after {wait}s")
                    await asyncio.sleep(wait)
                    continue
                if resp.status_code >= 500 and attempt < 1:
                    await asyncio.sleep(2)
                    continue
                raise RuntimeError(f"Grsai HTTP {resp.status_code}: {raw}")
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            if attempt < 3:
                await asyncio.sleep(1.5)
                continue
            raise RuntimeError(f"Grsai network error: {e}") from e

    raise RuntimeError("Grsai request failed after all retries")


# ============================================================================
# Dimension Resolution (FIX #8)
# ============================================================================

def _resolve_dimensions(ratio: str, resolution: str) -> tuple[int, int]:
    """Convert ratio+resolution to concrete width/height."""
    base = {"1k": 1024, "2k": 2048, "4k": 4096}.get(resolution, 2048)
    ratios = {
        "square": (base, base),
        "portrait": (int(base * 0.75), base),
        "landscape": (base, int(base * 0.75)),
    }
    return ratios.get(ratio, (base, base))


# ============================================================================
# Provider Class
# ============================================================================

class GrsAIProvider(BaseProvider):
    name = "grsai"

    async def generate(
        self,
        prompt: str,
        ref_image_url: str = None,
        ratio: str = "square",
        resolution: str = "2k",
        **kwargs: Any,
    ) -> ProviderResult:
        """Generate an image using GrsAI."""
        _sync_pool()
        pool = _pool_for("grsai")

        # Convert ratio/resolution to width/height if not explicitly provided
        w, h = _resolve_dimensions(ratio, resolution)

        model_id = kwargs.get("model_id", "gpt-image-2-vip")
        input_data = {
            "prompt": prompt,
            "modelId": model_id,
            "width": kwargs.get("width") or w,
            "height": kwargs.get("height") or h,
            "modelImageBase64": kwargs.get("model_image_b64", ""),
            "productImageBase64": kwargs.get("product_image_b64", ""),
            "styleRefBase64": kwargs.get("style_ref_b64", ""),
            "detailImageBase64": kwargs.get("detail_b64", ""),
        }

        key = acquire_key(pool)
        try:
            url = await _grsai_generate(key, input_data)
            release_key(pool, key, success=True)
            return ProviderResult(success=True, urls=[url])
        except Exception as e:
            release_key(pool, key, success=False)
            return ProviderResult(success=False, error=str(e))

    async def health_check(self) -> bool:
        return bool(GRSAI_API_KEYS and any(k.strip() for k in GRSAI_API_KEYS))
