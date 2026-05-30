"""
Yunwu image generation provider.

Extracted from stages.py — handles /v1/images/edits and /v1/images/generations
with multi-key rotation and retry logic.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import math
import os
import time
import uuid
from typing import Any

import httpx

from .base import BaseProvider, ProviderResult
from .key_pool import KeyPool, KeyState, merge_pool, acquire_key, release_key, _pool_for, _yunwu_pool, is_transient_error

logger = logging.getLogger(__name__)

# ============================================================================
# Configuration (from env with existing defaults)
# ============================================================================

# API base: use Vite proxy in dev (http://localhost:5174/yunwu), override for production
_YUNWU_BASE = os.getenv("YUNWU_BASE_URL", "http://localhost:5174/yunwu")
YUNWU_EDITS_URL = f"{_YUNWU_BASE}/v1/images/edits"
YUNWU_GEN_URL = f"{_YUNWU_BASE}/v1/images/generations"
YUNWU_API_KEYS: list[str] = [
    os.getenv("YUNWU_KEY_1", "sk-74BktqxG1rp1GIgwKSGuUBxQ7VkcOoihaMMAY8aKPSXrhvaS"),
    os.getenv("YUNWU_KEY_2", "sk-nK9OjOknKFbD9DloLnM1upgxtDw7vJ8JeqJ03CObx4e1mPTM"),
    os.getenv("YUNWU_KEY_3", "sk-pYZtWx4v6qxCvsC8yiVHQIDx6SZ3y1J6s6Ad22bF32FH3Nvd"),
    os.getenv("YUNWU_KEY_4", "sk-c8fivuNCM1y98HAOJ0MyITAoMcPEJpVriN4wK4eLA57Uph3y"),
]
YUNWU_MAX_CONCURRENT_PER_KEY = 3
YUNWU_TIMEOUT = 180.0

# Default generation settings
DEFAULT_WIDTH = 2448
DEFAULT_HEIGHT = 3264

# ============================================================================#
# Internal Key Pool — USE SHARED POOL FROM key_pool.py
# ============================================================================#

# Use the global _yunwu_pool from key_pool.py (not a local copy!)
_pool = _yunwu_pool


def _sync_pool() -> None:
    now = time.time()
    keys = [k for k in YUNWU_API_KEYS if k.strip()]
    merge_pool(_pool, keys, 30_000, YUNWU_MAX_CONCURRENT_PER_KEY, now)


# ============================================================================
# Utility
# ============================================================================

def _bare_base64(data_url: str) -> str:
    if data_url.startswith("data:"):
        idx = data_url.find(",")
        return data_url[idx + 1:] if idx >= 0 else data_url
    return data_url


def _data_url_to_bytes(data_url: str) -> bytes:
    if data_url.startswith("data:"):
        idx = data_url.find(",")
        b64 = data_url[idx + 1:] if idx >= 0 else data_url
    else:
        b64 = data_url
    return base64.b64decode(b64)


def _derive_image_size_label(w: int, h: int) -> str:
    mp = w * h
    if mp >= 8_000_000:
        return "4K"
    if mp >= 3_000_000:
        return "2K"
    return "1K"


def _derive_aspect_ratio(w: int, h: int) -> str:
    if not w or not h:
        return "4:3"
    g = math.gcd(w, h)
    return f"{w // g}:{h // g}"


def _gen_id() -> str:
    return f"{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}"


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
# HTTP Request Logic (preserved exactly from stages.py)
# ============================================================================

async def _yunwu_gen_request(
    api_key: str,
    endpoint: str,
    payload: dict[str, Any],
    signal: asyncio.Event | None = None,
    timeout: float = YUNWU_TIMEOUT,
) -> httpx.Response:
    """Send a request to Yunwu with retry logic for 429 rate limits."""
    headers = {
        "Authorization": f"Bearer {api_key}",
    }

    for attempt in range(4):  # up to 3 retries
        if signal and signal.is_set():
            raise asyncio.CancelledError("Aborted")

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                if "files" in payload:
                    # FormData request (edits endpoint)
                    headers.pop("Content-Type", None)  # Let httpx set multipart boundary
                    resp = await client.post(endpoint, headers=headers, files=payload["files"])
                else:
                    headers["Content-Type"] = "application/json"
                    resp = await client.post(endpoint, headers=headers, json=payload)

                if resp.status_code == 200:
                    return resp

                raw = resp.text[:300]
                if resp.status_code == 429:
                    wait = [5, 10, 20][attempt] if attempt < 3 else 20
                    logger.warning(f"Yunwu 429 rate limited, retry {attempt + 1}/3 after {wait}s")
                    await asyncio.sleep(wait)
                    continue
                if resp.status_code >= 500 and attempt < 1:
                    await asyncio.sleep(2)
                    continue

                raise RuntimeError(f"Yunwu HTTP {resp.status_code}: {raw}")

        except (httpx.TimeoutException, httpx.ConnectError) as e:
            if attempt < 3:
                await asyncio.sleep(1.5)
                continue
            raise RuntimeError(f"Yunwu network error: {e}") from e

    raise RuntimeError("Yunwu request failed after all retries")


async def _yunwu_generate(api_key: str, input_data: dict[str, Any]) -> str:
    """Generate image via Yunwu /v1/images/generations."""
    w = input_data.get("width", DEFAULT_WIDTH) or DEFAULT_WIDTH
    h = input_data.get("height", DEFAULT_HEIGHT) or DEFAULT_HEIGHT
    prompt = input_data.get("prompt", "")
    model_image_b64 = input_data.get("modelImageBase64", "")
    product_image_b64 = input_data.get("productImageBase64", "")
    model_id = input_data.get("modelId", "gpt-image-2-all")

    if model_image_b64:
        prompt = prompt + ". Maintain identical model pose, facial expression, and composition from reference."

    size = f"{w}x{h}"
    img_size_label = _derive_image_size_label(w, h)
    quality = "hd" if img_size_label in ("4K", "2K") else "standard"

    payload: dict[str, Any] = {
        "model": model_id,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "n": 1,
    }

    if model_image_b64:
        payload["image"] = _bare_base64(model_image_b64)
    elif product_image_b64:
        payload["image"] = _bare_base64(product_image_b64)

    resp = await _yunwu_gen_request(api_key, YUNWU_GEN_URL, payload)
    data = resp.json()
    arr = data.get("data", [])
    for item in arr:
        if isinstance(item, dict):
            if "url" in item and isinstance(item["url"], str):
                return item["url"]
            if "b64_json" in item and isinstance(item["b64_json"], str):
                return f"data:image/png;base64,{item['b64_json']}"

    # Fallback: dig for URL
    found = _dig_url(data)
    if found:
        return found
    raise RuntimeError(f"Yunwu no image: {resp.text[:200]}")


async def _yunwu_edits(api_key: str, input_data: dict[str, Any]) -> str:
    """Generate image via Yunwu /v1/images/edits (multi-reference, FormData)."""
    w = input_data.get("width", DEFAULT_WIDTH) or DEFAULT_WIDTH
    h = input_data.get("height", DEFAULT_HEIGHT) or DEFAULT_HEIGHT
    prompt = input_data.get("prompt", "")
    model_image_b64 = input_data.get("modelImageBase64", "")
    product_image_b64 = input_data.get("productImageBase64", "")
    style_ref_b64 = input_data.get("styleRefBase64", "")
    detail_b64 = input_data.get("detailImageBase64", "")

    files: list[tuple[str, bytes, str]] = []

    if model_image_b64:
        files.append(("image", _data_url_to_bytes(model_image_b64), "model_reference.jpg"))
    if product_image_b64:
        files.append(("image", _data_url_to_bytes(product_image_b64), "product_reference.jpg"))
    if style_ref_b64:
        files.append(("image", _data_url_to_bytes(style_ref_b64), "style_reference.jpg"))
    if detail_b64:
        files.append(("image", _data_url_to_bytes(detail_b64), "detail_reference.jpg"))

    # Build form fields alongside files
    payload: dict[str, Any] = {"files": files}
    # Use httpx's data parameter for form fields
    payload["data"] = {
        "model": "gpt-image-2",
        "prompt": prompt,
        "n": "1",
        "size": f"{w}x{h}",
        "quality": "hd",
        "format": "png",
        "background": "auto",
        "moderation": "auto",
        "provider.sort": "success_rate",
    }

    # Merge files + data into single multipart request
    resp = await _yunwu_gen_request(api_key, YUNWU_EDITS_URL, payload)
    data = resp.json()
    arr = data.get("data", [])
    for item in arr:
        if isinstance(item, dict):
            if "url" in item and isinstance(item["url"], str):
                return item["url"]
            if "b64_json" in item and isinstance(item["b64_json"], str):
                return f"data:image/png;base64,{item['b64_json']}"

    found = _dig_url(data)
    if found:
        return found
    raise RuntimeError(f"Yunwu Edits no image: {resp.text[:200]}")


# ============================================================================
# Dimension Resolution (FIX #8)
# ============================================================================

def _resolve_dimensions(ratio: str, resolution: str) -> tuple[int, int]:
    """Convert ratio+resolution to concrete width/height. Handles labeled values."""
    import re as _re
    res_raw = resolution.split("(")[0].strip().lower().replace(" ", "") if resolution else "2k"
    ratio_raw = ratio.split("(")[0].strip().lower().replace(" ", "") if ratio else "square"

    base_map = {"1k": 1024, "2k": 2048, "4k": 4096}
    base = 2048
    for k, v in base_map.items():
        if res_raw.startswith(k):
            base = v
            break

    if ":" in ratio_raw:
        parts = ratio_raw.split(":")
        w_r = int(parts[0]) if parts[0].isdigit() else 1
        h_r = int(parts[1]) if parts[1].isdigit() else 1
        short = min(base // max(w_r, h_r) * w_r, base // max(w_r, h_r) * h_r)
        return (short * w_r, short * h_r)

    ratios = {
        "square": (base, base),
        "portrait": (int(base * 0.75), base),
        "landscape": (base, int(base * 0.75)),
    }
    return ratios.get(ratio_raw, (base, base))


# ============================================================================
# Provider Class
# ============================================================================

class YunwuProvider(BaseProvider):
    name = "yunwu"

    async def generate(
        self,
        prompt: str,
        ref_image_url: str = None,
        ratio: str = "square",
        resolution: str = "2k",
        **kwargs: Any,
    ) -> ProviderResult:
        """Generate an image using Yunwu."""
        _sync_pool()
        pool = _pool_for("yunwu")

        # Convert ratio/resolution to width/height if not explicitly provided
        w, h = _resolve_dimensions(ratio, resolution)

        model_id = kwargs.get("model_id", "gpt-image-2-all")
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
            # Route: use /edits only when there are actual reference images
            has_refs = any([
                input_data.get("modelImageBase64"),
                input_data.get("productImageBase64"),
                input_data.get("styleRefBase64"),
                input_data.get("detailImageBase64"),
                ref_image_url,
            ])
            if has_refs:
                url = await _yunwu_edits(key, input_data)
            else:
                url = await _yunwu_generate(key, input_data)
            release_key(pool, key, success=True)
            return ProviderResult(success=True, urls=[url])
        except Exception as e:
            release_key(pool, key, success=False, transient=is_transient_error(str(e)))
            return ProviderResult(success=False, error=str(e))

    async def health_check(self) -> bool:
        return bool(YUNWU_API_KEYS and any(k.strip() for k in YUNWU_API_KEYS))
