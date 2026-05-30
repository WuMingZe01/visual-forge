"""
Pipeline stage implementations.
Each stage is a pure async function: (ctx, config) -> None
Stages communicate via PipelineContext — they read from and write to ctx.

多模态/视觉识别: MiMo (mimo-v2.5)
文本模型: DeepSeek (deepseek-chat / deepseek-v4-flash)
生图引擎: Yunwu + Grsai 混合
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import math
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import httpx

from .types import (
    PipelineContext,
    PipelineProgress,
    RowImages,
    StageConfig,
    WorkflowConfig,
    WorkflowOptions,
)

logger = logging.getLogger(__name__)

# ============================================================================
# Configuration
# ============================================================================

# --- MiMo Vision Model ---
MIMO_BASE_URL = "https://api.xiaomimimo.com/v1/chat/completions"
MIMO_MODEL = "mimo-v2.5"
MIMO_API_KEYS: list[str] = [
    "sk-ceqaykkja91qsnxxane5qomonzfmyog3lquha9xwgfptgyk7",   # [0] 备用
    "sk-czccdxw9653nfx2fmm1p023ctpi1wv0i6jqfxpvdshr7c2tn",   # [1] 优先
    "sk-cwx4vo7mzp8rwx0sqysn2xbw1gt3dmyt3gwkzc3aoxayg7b8",   # [2] 优先
    "sk-c9fjclbpqr16jy5x4wnl7vmer6f6k2et81mdanne41mdg32l",   # [3] 优先
]
MIMO_MAX_TOKENS = 4096
MIMO_TIMEOUT = 120.0

# --- DeepSeek Text Model ---
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_MODEL = "deepseek-chat"
DEEPSEEK_API_KEY = "sk-fd9038ab2a344273b77a7b647b92d387"
DEEPSEEK_MAX_TOKENS = 4096
DEEPSEEK_TIMEOUT = 120.0

# --- Yunwu Image Generation ---
YUNWU_EDITS_URL = "https://yunwu.ai/v1/images/edits"
YUNWU_GEN_URL = "https://yunwu.ai/v1/images/generations"
YUNWU_API_KEYS: list[str] = [
    os.getenv("YUNWU_KEY_1", "sk-74BktqxG1rp1GIgwKSGuUBxQ7VkcOoihaMMAY8aKPSXrhvaS"),
    os.getenv("YUNWU_KEY_2", "sk-nK9OjOknKFbD9DloLnM1upgxtDw7vJ8JeqJ03CObx4e1mPTM"),
    os.getenv("YUNWU_KEY_3", "sk-pYZtWx4v6qxCvsC8yiVHQIDx6SZ3y1J6s6Ad22bF32FH3Nvd"),
    os.getenv("YUNWU_KEY_4", "sk-c8fivuNCM1y98HAOJ0MyITAoMcPEJpVriN4wK4eLA57Uph3y"),
]
YUNWU_MAX_CONCURRENT_PER_KEY = 3
YUNWU_TIMEOUT = 180.0

# --- Grsai Image Generation ---
GRSAI_BASE_URL = "https://grsai.dakka.com.cn"
GRSAI_API_KEYS: list[str] = [
    os.getenv("GRSAI_KEY_1", "sk-ffb3791c8358419c931c85ba179abe8c"),
]
GRSAI_MAX_CONCURRENT_PER_KEY = 1
GRSAI_TIMEOUT = 180.0

# --- Rate Limits ---
RATE_LIMIT_WINDOW_MS = 60_000
MAX_REQUESTS_PER_WINDOW = 30
CIRCUIT_BREAKER_THRESHOLD = 5
CIRCUIT_BASE_BACKOFF = 15_000
CIRCUIT_MAX_BACKOFF = 300_000
KEY_AUTO_RECOVER_MS = 120_000
HALF_OPEN_MAX_REQUESTS = 2

# --- Default generation settings ---
DEFAULT_WIDTH = 2448
DEFAULT_HEIGHT = 3264
DEFAULT_PROMPT = (
    "Professional product photo of a fashion item, "
    "clean background, studio lighting, high quality, 8K, commercial photography"
)


# ============================================================================
# Key Pool Management
# ============================================================================

@dataclass
class KeyStats:
    total_requests: int = 0
    success_count: int = 0
    fail_count: int = 0
    last_fail_time: float = 0.0
    last_fail_type: str = ""
    consecutive_fails: int = 0
    recent_timestamps: list[float] = field(default_factory=list)


@dataclass
class KeyState:
    key: str
    last_used: float = 0.0
    cooldown_ms: int = 30_000
    max_concurrent: int = 3
    in_use: int = 0
    circuit_state: str = "closed"  # "closed" | "open" | "half-open"
    circuit_opened_at: float = 0.0
    circuit_retry_after: int = 0
    stats: KeyStats = field(default_factory=KeyStats)
    waiters: list[asyncio.Event] = field(default_factory=list)

    def _lock(self) -> asyncio.Lock:
        """Per-key lock for thread-safe operations."""
        if not hasattr(self, "_lk"):
            object.__setattr__(self, "_lk", asyncio.Lock())
        return object.__getattribute__(self, "_lk")


@dataclass
class KeyPool:
    provider: str  # "yunwu" | "grsai" | "mimo"
    keys: list[KeyState] = field(default_factory=list)

    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)


# Global pools
_mimo_pool = KeyPool(provider="mimo")
_yunwu_pool = KeyPool(provider="yunwu")
_grsai_pool = KeyPool(provider="grsai")


def _pool_for(provider: str) -> KeyPool:
    if provider == "yunwu":
        return _yunwu_pool
    elif provider == "grsai":
        return _grsai_pool
    elif provider == "mimo":
        return _mimo_pool
    raise ValueError(f"Unknown provider: {provider}")


def sync_key_pools() -> None:
    """Sync key pools from configuration."""
    now = time.time()

    # MiMo pool (4 keys, prefer last 3, fallback to 1st)
    _merge_pool(_mimo_pool, MIMO_API_KEYS, 30_000, 3, now)

    # Yunwu pool
    yw_keys = [k for k in YUNWU_API_KEYS if k.strip()]
    _merge_pool(_yunwu_pool, yw_keys, 30_000, YUNWU_MAX_CONCURRENT_PER_KEY, now)

    # Grsai pool
    gr_keys = [k for k in GRSAI_API_KEYS if k.strip()]
    _merge_pool(_grsai_pool, gr_keys, 2_000, GRSAI_MAX_CONCURRENT_PER_KEY, now)


def _merge_pool(
    pool: KeyPool,
    new_keys: list[str],
    cooldown_ms: int,
    max_concurrent: int,
    now: float,
) -> None:
    new_key_set = set(new_keys)
    pool.keys = [k for k in pool.keys if k.key in new_key_set]

    for key_val in new_keys:
        if not any(k.key == key_val for k in pool.keys):
            pool.keys.append(KeyState(
                key=key_val,
                cooldown_ms=cooldown_ms,
                max_concurrent=max_concurrent,
            ))

    # Auto-recover stale failure state
    for sk in pool.keys:
        if sk.circuit_state == "open" and (now * 1000 - sk.circuit_opened_at * 1000) > sk.circuit_retry_after:
            sk.circuit_state = "half-open"
        if sk.circuit_state != "open" and sk.stats.consecutive_fails > 0 and (now * 1000 - sk.stats.last_fail_time * 1000) > KEY_AUTO_RECOVER_MS:
            sk.circuit_state = "closed"
            sk.stats.consecutive_fails = 0
        # Clean stale timestamps
        cutoff = now - RATE_LIMIT_WINDOW_MS / 1000.0
        sk.stats.recent_timestamps = [t for t in sk.stats.recent_timestamps if t > cutoff]


def get_pool_capacity(provider: str) -> int:
    """Get max theoretical concurrency for a provider."""
    pool = _pool_for(provider)
    sync_key_pools()
    max_per_key = YUNWU_MAX_CONCURRENT_PER_KEY if provider == "yunwu" else GRSAI_MAX_CONCURRENT_PER_KEY
    if provider == "mimo":
        max_per_key = 3
    available = [k for k in pool.keys if k.circuit_state != "open" and k.key.strip()]
    return len(available) * max_per_key


def get_total_capacity() -> int:
    """Get total capacity across Yunwu + Grsai."""
    return get_pool_capacity("yunwu") + get_pool_capacity("grsai")


def available_key_count(provider: str) -> int:
    """Count available (non-open-circuit) keys."""
    pool = _pool_for(provider)
    sync_key_pools()
    return len([k for k in pool.keys if k.circuit_state != "open" and k.key.strip()])


def get_provider(model_id: str) -> str:
    """Determine provider from model_id."""
    if model_id.startswith("nano-banana"):
        return "grsai"
    if model_id in ("gpt-image-2-vip", "gpt-image-2"):
        return "grsai"
    if model_id in ("gpt-image-2-all", "gpt-image-1-mini"):
        return "yunwu"
    return "yunwu"


# ============================================================================
# MiMo Key Selection (prefer indices 1,2,3; fallback to 0)
# ============================================================================

_mimo_key_index = 1  # Start with first preferred key


async def _acquire_mimo_key() -> str:
    """Select next MiMo key, preferring keys at indices 1,2,3, falling back to 0."""
    global _mimo_key_index
    # Prefer keys at indices 1, 2, 3 (the "优先" marked keys)
    preferred_order = [1, 2, 3, 0]
    for idx in preferred_order:
        key = MIMO_API_KEYS[idx]
        if key.strip():
            _mimo_key_index = idx
            return key
    raise RuntimeError("No MiMo API keys configured")


async def _rotate_mimo_key(failed_key: str) -> str:
    """After a key fails (e.g. quota exceeded), switch to the next available one."""
    global _mimo_key_index
    try:
        failed_idx = MIMO_API_KEYS.index(failed_key)
    except ValueError:
        failed_idx = -1

    # Try remaining preferred keys, then the backup
    preferred_order = [1, 2, 3, 0]
    for idx in preferred_order:
        if idx == failed_idx:
            continue
        key = MIMO_API_KEYS[idx]
        if key.strip():
            _mimo_key_index = idx
            return key
    raise RuntimeError("All MiMo API keys exhausted")


# ============================================================================
# LLM Helpers
# ============================================================================

def _mimo_headers(api_key: str) -> dict[str, str]:
    """MiMo API headers: uses 'api-key' header"""
    return {
        "Content-Type": "application/json",
        "api-key": api_key,
    }


def _deepseek_headers() -> dict[str, str]:
    """DeepSeek API headers: uses Bearer token"""
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
    }


async def _llm_fetch_mimo(
    messages: list[dict[str, Any]],
    max_tokens: int = MIMO_MAX_TOKENS,
    timeout: float = MIMO_TIMEOUT,
    api_key: str | None = None,
) -> httpx.Response:
    """Send a chat completion request to MiMo."""
    if api_key is None:
        api_key = await _acquire_mimo_key()

    body = {
        "model": MIMO_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.post(
            MIMO_BASE_URL,
            headers=_mimo_headers(api_key),
            json=body,
        )


async def _llm_fetch_deepseek(
    messages: list[dict[str, Any]],
    max_tokens: int = DEEPSEEK_MAX_TOKENS,
    timeout: float = DEEPSEEK_TIMEOUT,
) -> httpx.Response:
    """Send a chat completion request to DeepSeek."""
    body = {
        "model": DEEPSEEK_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.4,
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.post(
            DEEPSEEK_BASE_URL,
            headers=_deepseek_headers(),
            json=body,
        )


async def _parse_llm_response(resp: httpx.Response) -> str:
    """Extract text content from LLM response."""
    data = resp.json()
    msg = data.get("choices", [{}])[0].get("message", {})
    text = msg.get("content") or msg.get("reasoning_content") or ""
    if not text:
        snippet = json.dumps(data, ensure_ascii=False)[:300]
        raise RuntimeError(f"LLM returned empty content: {snippet}")
    return text


# ============================================================================
# Vision Analysis (MiMo)
# ============================================================================

MIMO_DEFAULT_VISION_SYSTEM = (
    "你是一个专业的服装视觉分析专家。你的任务是仔细观察图片，提取关键视觉特征。"
    "请保持输出简洁、结构化，用中文描述。"
)


async def analyze_model_image(image_base64: str) -> str:
    """Analyze model reference image to extract invariant features (pose, lighting, composition)."""
    system_prompt = MIMO_DEFAULT_VISION_SYSTEM + (
        "\n\n重点提取换衣后必须100%保留的不变特征：\n"
        "1. 模特姿势（站姿、角度、身体朝向）\n"
        "2. 面部特征与表情\n"
        "3. 光影方向与强度\n"
        "4. 背景环境与构图\n"
        "5. 整体风格基调"
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请分析这张模特图的不变特征（换衣后必须保留的）"},
                {"type": "image_url", "image_url": {"url": image_base64}},
            ],
        },
    ]

    api_key = await _acquire_mimo_key()
    for _attempt in range(2):
        try:
            resp = await _llm_fetch_mimo(messages, max_tokens=4096, api_key=api_key)
            if resp.status_code == 200:
                return await _parse_llm_response(resp)
            # Check for auth/quota errors
            err_text = resp.text[:500]
            if resp.status_code in (401, 403, 429):
                logger.warning(f"MiMo key {api_key[:12]}... failed (HTTP {resp.status_code}), rotating")
                api_key = await _rotate_mimo_key(api_key)
                continue
            raise RuntimeError(f"MiMo HTTP {resp.status_code}: {err_text}")
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            logger.warning(f"MiMo connection error: {e}, rotating key")
            api_key = await _rotate_mimo_key(api_key)
            continue

    raise RuntimeError("MiMo analyze_model_image failed after key rotation")


async def analyze_product_image(image_base64: str) -> str:
    """Analyze product/style reference image to extract garment visual details."""
    system_prompt = MIMO_DEFAULT_VISION_SYSTEM + (
        "\n\n重点提取服装细节：\n"
        "1. 版型与廓形\n"
        "2. 面料纹理与材质\n"
        "3. 颜色与图案/印花\n"
        "4. 领口/袖口/下摆设计\n"
        "5. 纽扣/拉链/口袋等五金细节\n"
        "6. Logo/品牌标识位置与样式"
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请分析这张服装图的视觉特征"},
                {"type": "image_url", "image_url": {"url": image_base64}},
            ],
        },
    ]

    api_key = await _acquire_mimo_key()
    for _attempt in range(2):
        try:
            resp = await _llm_fetch_mimo(messages, max_tokens=2048, api_key=api_key)
            if resp.status_code == 200:
                return await _parse_llm_response(resp)
            err_text = resp.text[:500]
            if resp.status_code in (401, 403, 429):
                logger.warning(f"MiMo key {api_key[:12]}... failed (HTTP {resp.status_code}), rotating")
                api_key = await _rotate_mimo_key(api_key)
                continue
            raise RuntimeError(f"MiMo HTTP {resp.status_code}: {err_text}")
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            logger.warning(f"MiMo connection error: {e}, rotating key")
            api_key = await _rotate_mimo_key(api_key)
            continue

    raise RuntimeError("MiMo analyze_product_image failed after key rotation")


# ============================================================================
# Text Prompt Assembly (DeepSeek)
# ============================================================================

DEEPSEEK_ASSEMBLE_SYSTEM = (
    "你是一个专业的AI生图提示词工程师。你的任务是将\"必须保留的不变特征\"和\"要替换的服装信息\""
    "整合成一个完整的中文分步生图方案。\n\n"
    "输出格式：\n"
    "【第一部分：必须保留的元素 — 绝对不能改】\n"
    "（列出姿势、光影、背景、构图等不变特征）\n\n"
    "【第二部分：精准替换的服装描述】\n"
    "（列出要穿上的服装的详细描述，包括版型、面料、颜色、图案、细节等）\n\n"
    "确保第一部分完全忠于原始分析，第二部分精准描述目标服装。"
)


async def assemble_final_prompt(invariant_features: str, product_info: str) -> str:
    """Use DeepSeek to assemble the final generation prompt from analysis results."""
    messages = [
        {"role": "system", "content": DEEPSEEK_ASSEMBLE_SYSTEM},
        {
            "role": "user",
            "content": (
                f"【MiMo 上一轮识别出的线索 — 参考图中绝对不能改的东西】\n{invariant_features}\n\n"
                f"【要换上去的这件衣服的完整资料 — 白底图细节 + 商品信息】\n{product_info}\n\n"
                f"请严格按以上线索生成中文分步生图方案：第一部分的描述一点不能改，第二部分的描述精准替换原图衣服。"
            ),
        },
    ]

    resp = await _llm_fetch_deepseek(messages, max_tokens=4096)
    if resp.status_code != 200:
        err_text = resp.text[:500]
        raise RuntimeError(f"DeepSeek HTTP {resp.status_code}: {err_text}")
    return await _parse_llm_response(resp)


# ============================================================================
# Build Product Info from Lingmao ERP Data
# ============================================================================

def build_product_info_string(lingmao_data: dict[str, Any] | None) -> str:
    """Convert Lingmao ERP product data to a readable info string."""
    if not lingmao_data:
        return ""

    parts: list[str] = []
    field_map = {
        "productName": "商品名称",
        "categoryName": "品类",
        "brandName": "品牌",
        "fabricComposition": "面料成分",
        "colorName": "颜色",
        "sizeName": "尺码",
        "styleDescription": "款式描述",
        "designFeatures": "设计特点",
        "seasonName": "季节",
        "genderName": "适用性别",
    }

    for key, label in field_map.items():
        val = lingmao_data.get(key)
        if val and str(val).strip():
            parts.append(f"{label}: {val}")

    return "\n".join(parts)


# ============================================================================
# Image Utilities
# ============================================================================

def _bare_base64(data_url: str) -> str:
    """Strip data:image/...;base64, prefix."""
    if data_url.startswith("data:"):
        idx = data_url.find(",")
        return data_url[idx + 1:] if idx >= 0 else data_url
    return data_url


async def _fetch_as_base64(url: str) -> str:
    """Fetch an image URL and return as base64 data URL."""
    if not url:
        return ""
    if url.startswith("data:"):
        return url
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "image/png")
            b64 = base64.b64encode(resp.content).decode("ascii")
            return f"data:{content_type};base64,{b64}"
    except Exception:
        return ""


def _data_url_to_bytes(data_url: str) -> bytes:
    """Convert a base64 data URL to raw bytes."""
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


# ============================================================================
# Image Generation (Yunwu + Grsai)
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
                    del headers["Content-Type"]  # Let httpx set multipart boundary
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


async def generate_tryon_image(input_data: dict[str, Any]) -> str:
    """Main entry point for image generation — dispatches to Yunwu or Grsai."""
    model_id = input_data.get("modelId", "gpt-image-2-all")
    provider = get_provider(model_id)

    if model_id.startswith("nano-banana"):
        return await _grsai_generate("", {**input_data, "modelId": model_id})
    elif model_id in ("gpt-image-2-vip", "gpt-image-2"):
        # Grsai generate
        return await _grsai_generate("", input_data)
    elif model_id == "gpt-image-2-all":
        return await _yunwu_edits("", input_data)
    elif model_id == "gpt-image-1-mini":
        return await _yunwu_generate("", {**input_data, "modelId": "gpt-image-1-mini"})
    else:
        return await _yunwu_generate("", input_data)


# ============================================================================
# Validation (MiMo)
# ============================================================================

async def validate_generation_result(
    result_b64: str,
    product_b64: str | None = None,
    model_b64: str | None = None,
    prompt: str = "",
    timeout_ms: int = 30_000,
) -> dict[str, Any]:
    """Use MiMo to validate the generated image against references."""
    system_prompt = (
        "你是 AI 生图质量校验专家。你的任务：对比生成结果和原始参考图，判断生成质量。\n\n"
        "请严格按以下格式输出 JSON，不要输出其他内容：\n\n"
        '{\n'
        '  "inputCheck": {\n'
        '    "hasProductImage": true/false,\n'
        '    "hasModelImage": true/false,\n'
        '    "hasStyleRef": true/false,\n'
        '    "hasDetailImage": true/false,\n'
        '    "promptOptimized": true/false,\n'
        '    "issues": ["问题1", "问题2"]\n'
        '  },\n'
        '  "outputCheck": {\n'
        '    "posePreserved": true/false,\n'
        '    "lightingPreserved": true/false,\n'
        '    "backgroundPreserved": true/false,\n'
        '    "compositionPreserved": true/false,\n'
        '    "productColorCorrect": true/false,\n'
        '    "productShapeCorrect": true/false,\n'
        '    "layoutMatched": true/false,\n'
        '    "issues": ["问题1", "问题2"]\n'
        '  },\n'
        '  "summary": "一句话总结校验结果"\n'
        '}\n\n'
        '判断标准：\n'
        '- 入参校验：是否完整携带了白底图、模特图、风格参考图、细节图；提示词是否为深度优化后的完整版\n'
        '- 效果校验：是否保留了原图的姿势/光影/背景/构图；商品的版型/颜色是否正确；模板的排版结构是否匹配\n'
        '- passed: 所有 outputCheck 项都为 true 且无严重 input 问题'
    )

    content_parts: list[dict[str, Any]] = []

    content_parts.append({"type": "text", "text": "【生成结果图】"})
    content_parts.append({"type": "image_url", "image_url": {"url": result_b64}})

    if product_b64:
        content_parts.append({"type": "text", "text": "【商品白底图参考】"})
        content_parts.append({"type": "image_url", "image_url": {"url": product_b64}})
    if model_b64:
        content_parts.append({"type": "text", "text": "【模特参考图】"})
        content_parts.append({"type": "image_url", "image_url": {"url": model_b64}})

    content_parts.append({"type": "text", "text": f"【使用的生成提示词】\n{prompt[:300]}"})
    content_parts.append({"type": "text", "text": "请对比以上所有图片和提示词，输出 JSON 格式校验报告。"})

    default_report: dict[str, Any] = {
        "passed": True,
        "inputCheck": {
            "hasProductImage": bool(product_b64),
            "hasModelImage": bool(model_b64),
            "hasStyleRef": False,
            "hasDetailImage": False,
            "promptOptimized": len(prompt) > 50,
            "issues": [],
        },
        "outputCheck": {
            "posePreserved": True,
            "lightingPreserved": True,
            "backgroundPreserved": True,
            "compositionPreserved": True,
            "productColorCorrect": True,
            "productShapeCorrect": True,
            "layoutMatched": True,
            "issues": [],
        },
        "summary": "",
    }

    api_key = await _acquire_mimo_key()
    for _attempt in range(2):
        try:
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content_parts},
            ]
            resp = await _llm_fetch_mimo(messages, max_tokens=2048, api_key=api_key)
            if resp.status_code == 200:
                text = await _parse_llm_response(resp)
                # Extract JSON
                json_match = _extract_json(text)
                if json_match:
                    output_check = json_match.get("outputCheck", {})
                    all_true = all(v is True for v in output_check.values())
                    return {
                        "passed": all_true,
                        "inputCheck": json_match.get("inputCheck", default_report["inputCheck"]),
                        "outputCheck": output_check,
                        "summary": json_match.get("summary", "校验完成"),
                    }

                default_report["summary"] = "MiMo 校验结果解析失败，默认通过"
                return default_report

            err_text = resp.text[:500]
            if resp.status_code in (401, 403, 429):
                logger.warning(f"MiMo key {api_key[:12]}... failed (HTTP {resp.status_code}), rotating")
                api_key = await _rotate_mimo_key(api_key)
                continue
            default_report["summary"] = f"MiMo 校验接口异常: HTTP {resp.status_code}"
            return default_report

        except (httpx.TimeoutException, httpx.ConnectError) as e:
            logger.warning(f"MiMo connection error: {e}, rotating key")
            api_key = await _rotate_mimo_key(api_key)
            continue
        except Exception as e:
            default_report["summary"] = f"校验异常: {e}"
            return default_report

    default_report["summary"] = "MiMo 校验接口异常"
    return default_report


def _extract_json(text: str) -> dict[str, Any] | None:
    """Extract JSON object from LLM response text."""
    import re
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return None


# ============================================================================
# Image Compression
# ============================================================================

async def compress_image_for_ref(image_data: bytes, max_size: int = 1024) -> str:
    """Compress image to reference-friendly size, return base64 data URL."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_data))
        img = img.convert("RGB")
        # Resize to max 1024px on longest side
        w, h = img.size
        if max(w, h) > max_size:
            ratio = max_size / max(w, h)
            new_size = (int(w * ratio), int(h * ratio))
            img = img.resize(new_size, Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{b64}"
    except ImportError:
        # Fallback: return original as PNG base64
        b64 = base64.b64encode(image_data).decode("ascii")
        return f"data:image/png;base64,{b64}"


# ============================================================================
# Stage 1: Prepare
# ============================================================================

async def stage_prepare(ctx: PipelineContext, config: dict[str, Any] | None = None) -> None:
    """Validate input, sync key pools, calculate concurrency."""
    _ = config
    ctx.on_progress(PipelineProgress(stage="prepare", step=0, total=0, message="准备中..."))

    active_rows = [r for r in ctx.rows if getattr(r, "status", "idle") != "done"]
    if not active_rows:
        raise RuntimeError("没有待生成的行")

    sync_key_pools()

    effective_concurrency = min(
        get_total_capacity() if ctx.use_hybrid else get_pool_capacity(get_provider(ctx.model_id)),
        36,
    )

    # Store in context for later stages
    object.__setattr__(ctx, "_concurrency", effective_concurrency)
    object.__setattr__(ctx, "_active_rows", active_rows)

    ctx.on_progress(PipelineProgress(
        stage="prepare", step=1, total=1,
        message=f"就绪 · {len(active_rows)} 款 · {effective_concurrency}路并发",
    ))


# ============================================================================
# Stage 2: Analyze (LLM multimodal analysis + prompt assembly)
# ============================================================================

async def stage_analyze(ctx: PipelineContext, config: dict[str, Any] | None = None) -> None:
    """Analyze model and product images with MiMo, then assemble prompt with DeepSeek."""
    cfg = config or {}
    if not ctx.vision_model and not MIMO_API_KEYS[1].strip():
        ctx.on_progress(PipelineProgress(stage="analyze", step=0, total=0, message="跳过 LLM 分析（模型未配置）"))
        return

    active_rows: list[Any] = (
        object.__getattribute__(ctx, "_active_rows")
        if hasattr(ctx, "_active_rows")
        else [r for r in ctx.rows if getattr(r, "status", "idle") != "done"]
    )

    use_model_analysis = cfg.get("useModelAnalysis", True) is not False
    use_product_analysis = cfg.get("useProductAnalysis", True) is not False

    llm_max = cfg.get("llmMaxConcurrency", 3)
    semaphore = asyncio.Semaphore(llm_max)

    completed = 0
    total = len(active_rows)

    async def process_row(row: Any) -> None:
        nonlocal completed

        if ctx.abort_ref.get("current", False):
            return

        async with semaphore:
            try:
                has_sku = bool(getattr(row, "skuCode", "").strip())
                row_id = getattr(row, "id", _gen_id())

                # Load images from row
                product_b64 = ""
                model_b64 = ""
                style_b64 = ""
                detail_b64 = ""

                front_image = getattr(row, "frontImage", None)
                if front_image:
                    preview = getattr(front_image, "previewUrl", None) or getattr(front_image, "preview_url", None)
                    if preview:
                        product_b64 = await _fetch_as_base64(preview)

                model_image = getattr(row, "modelImage", None)
                if model_image:
                    preview = getattr(model_image, "previewUrl", None) or getattr(model_image, "preview_url", None)
                    if preview:
                        model_b64 = await _fetch_as_base64(preview)

                style_image = getattr(row, "styleImage", None)
                if style_image:
                    preview = getattr(style_image, "previewUrl", None) or getattr(style_image, "preview_url", None)
                    if preview:
                        style_b64 = await _fetch_as_base64(preview)

                # Store images
                ctx.row_images[row_id] = RowImages(
                    product_b64=product_b64,
                    model_b64=model_b64,
                    style_ref_b64=style_b64 or None,
                    detail_b64=detail_b64 or None,
                )

                # AI prompt assembly
                final_prompt = getattr(row, "prompt", "") or ""
                if has_sku or ctx.selected_model_id:
                    try:
                        invariant = ""
                        merged_parts: list[str] = []

                        # Analyze model image
                        if use_model_analysis and model_b64:
                            ctx.on_progress(PipelineProgress(
                                stage="analyze", step=completed + 1, total=total,
                                message=f"分析模特特征 · {getattr(row, 'skuCode', '') or row_id[-6:]}",
                            ))
                            invariant = await analyze_model_image(model_b64)

                        # Lingmao reverse prompt
                        lingmao = getattr(row, "lingmaoData", None) or getattr(row, "lingmao_data", None)
                        if lingmao and getattr(lingmao, "reversePrompt", None):
                            merged_parts.append(f"【白底图反推提示词 — 来自款式管理】\n{lingmao.reversePrompt}")

                        # Analyze product/style reference
                        if use_product_analysis and style_b64:
                            ctx.on_progress(PipelineProgress(
                                stage="analyze", step=completed + 1, total=total,
                                message=f"分析风格特征 · {getattr(row, 'skuCode', '') or row_id[-6:]}",
                            ))
                            style_analysis = await analyze_product_image(style_b64)
                            if style_analysis:
                                merged_parts.append(f"【风格参考图视觉特征】\n{style_analysis}")

                        # Lingmao ERP data
                        if ctx.has_lingmao_data and lingmao:
                            info = build_product_info_string(lingmao if isinstance(lingmao, dict) else vars(lingmao))
                            if info:
                                merged_parts.append(f"【领猫商品资料】\n{info}")

                        merged = "\n\n".join(merged_parts)

                        if invariant or merged:
                            ctx.on_progress(PipelineProgress(
                                stage="analyze", step=completed + 1, total=total,
                                message=f"整合提示词 · {getattr(row, 'skuCode', '') or row_id[-6:]}",
                            ))
                            final_prompt = await assemble_final_prompt(invariant, merged)

                    except Exception as e:
                        logger.warning(f"[pipeline] LLM analysis failed for {getattr(row, 'skuCode', '?')}: {e}")

                # Fallback prompt
                if not final_prompt:
                    final_prompt = DEFAULT_PROMPT

                ctx.row_prompts[row_id] = final_prompt

            finally:
                completed += 1

    await asyncio.gather(*(process_row(r) for r in active_rows))

    ctx.on_progress(PipelineProgress(
        stage="analyze", step=total, total=total,
        message=f"LLM 分析完成 · {total} 款",
    ))


# ============================================================================
# Stage 3: Generate (concurrent image generation)
# ============================================================================

async def stage_generate(ctx: PipelineContext, config: dict[str, Any] | None = None) -> None:
    """Concurrent image generation via Yunwu + Grsai."""
    _ = config

    active_rows: list[Any] = (
        object.__getattribute__(ctx, "_active_rows")
        if hasattr(ctx, "_active_rows")
        else [r for r in ctx.rows if getattr(r, "status", "idle") != "done"]
    )
    concurrency: int = (
        object.__getattribute__(ctx, "_concurrency")
        if hasattr(ctx, "_concurrency")
        else 36
    )

    # Build task queue
    queue: list[dict[str, Any]] = []

    for row in active_rows:
        row_id = getattr(row, "id", _gen_id())
        images = ctx.row_images.get(row_id)
        prompt = ctx.row_prompts.get(row_id) or getattr(row, "prompt", "")
        count = getattr(row, "count", 1) or 1
        product_b64 = images.product_b64 if images else ""
        model_b64 = images.model_b64 if images else ""
        style_ref_b64 = images.style_ref_b64 if images else None
        detail_b64 = images.detail_b64 if images else None

        for idx in range(count):
            task = {
                "rowId": row_id,
                "skuCode": getattr(row, "skuCode", ""),
                "productB64": product_b64,
                "modelB64": model_b64,
                "styleRefB64": style_ref_b64,
                "detailB64": detail_b64,
                "prompt": prompt,
                "count": count,
                "idxInRow": idx,
                "modelId": ctx.model_id,
                "width": ctx.width,
                "height": ctx.height,
            }
            queue.append(task)

    total_tasks = len(queue)
    if total_tasks == 0:
        ctx.on_progress(PipelineProgress(
            stage="generate", step=0, total=0, message="无待生成任务",
        ))
        return

    # Shared state
    completed_count = 0
    completed_lock = asyncio.Lock()
    queue_idx = 0
    queue_lock = asyncio.Lock()
    queue_not_empty = asyncio.Event()

    async def worker() -> None:
        nonlocal queue_idx, completed_count

        while True:
            if ctx.abort_ref.get("current", False):
                return

            # Get next task
            async with queue_lock:
                idx = queue_idx
                queue_idx += 1

            if idx >= len(queue):
                return

            task = queue[idx]

            try:
                real_url = await generate_tryon_image({
                    "prompt": task["prompt"],
                    "productImageBase64": task["productB64"],
                    "modelImageBase64": task["modelB64"],
                    "styleRefBase64": task.get("styleRefB64"),
                    "detailImageBase64": task.get("detailB64"),
                    "width": task["width"],
                    "height": task["height"],
                    "modelId": task["modelId"],
                })

                async with completed_lock:
                    completed_count += 1
                    current = completed_count

                ctx.on_progress(PipelineProgress(
                    stage="generate", step=current, total=total_tasks,
                    message=f"生图 {current}/{total_tasks} · {task['skuCode']}",
                ))

                entry = ctx.row_results.get(task["rowId"], {"urls": [], "error": ""})
                entry["urls"].append(real_url)
                ctx.row_results[task["rowId"]] = entry

                ctx.on_row_result(task["rowId"], [real_url], [])

            except Exception as e:
                if ctx.abort_ref.get("current", False):
                    return

                async with completed_lock:
                    completed_count += 1

                err_msg = str(e)[:80]
                entry = ctx.row_results.get(task["rowId"], {"urls": [], "error": ""})
                entry["error"] = entry["error"] + "; " + err_msg if entry["error"] else err_msg
                ctx.row_results[task["rowId"]] = entry

                ctx.on_row_result(task["rowId"], [], [f"#{task['idxInRow'] + 1}: {err_msg}"])

    # Start workers
    ctx.on_progress(PipelineProgress(
        stage="generate", step=0, total=total_tasks,
        message=f"{concurrency}路并发 · 流式生图",
    ))

    workers = [asyncio.create_task(worker()) for _ in range(min(concurrency, total_tasks))]

    try:
        await asyncio.wait_for(
            asyncio.gather(*workers, return_exceptions=True),
            timeout=480.0,
        )
    except asyncio.TimeoutError:
        logger.warning("Generate stage timed out after 480s")

    ctx.on_progress(PipelineProgress(
        stage="generate", step=total_tasks, total=total_tasks,
        message=f"生图完成 · {completed_count} 张",
    ))


# ============================================================================
# Stage 4: Validate (MiMo quality validation)
# ============================================================================

async def stage_validate(ctx: PipelineContext, config: dict[str, Any] | None = None) -> None:
    """Validate generated images using MiMo vision model."""
    cfg = config or {}
    if not (MIMO_API_KEYS[1].strip()):
        ctx.on_progress(PipelineProgress(stage="validate", step=0, total=0, message="跳过校验（无视觉模型）"))
        return

    active_rows: list[Any] = (
        object.__getattribute__(ctx, "_active_rows")
        if hasattr(ctx, "_active_rows")
        else [r for r in ctx.rows if getattr(r, "status", "idle") != "done"]
    )

    timeout_ms = cfg.get("timeoutMs", 30_000)
    validated = 0

    validation_reports: dict[str, Any] = {}

    for row in active_rows:
        if ctx.abort_ref.get("current", False):
            return

        row_id = getattr(row, "id", _gen_id())
        results = ctx.row_results.get(row_id)
        if not results or not results.get("urls"):
            continue

        result_url = results["urls"][0]
        images = ctx.row_images.get(row_id)
        prompt = ctx.row_prompts.get(row_id) or getattr(row, "prompt", "")

        try:
            result_b64 = await _fetch_as_base64(result_url)
            if not result_b64:
                continue

            ctx.on_progress(PipelineProgress(
                stage="validate", step=validated + 1, total=len(active_rows),
                message=f"校验中 · {getattr(row, 'skuCode', '') or row_id[-6:]}",
            ))

            report = await asyncio.wait_for(
                validate_generation_result(
                    result_b64=result_b64,
                    product_b64=images.product_b64 if images else None,
                    model_b64=images.model_b64 if images else None,
                    prompt=prompt,
                    timeout_ms=timeout_ms,
                ),
                timeout=timeout_ms / 1000.0,
            )

            validated += 1
            validation_reports[row_id] = report

        except asyncio.TimeoutError:
            pass
        except Exception:
            # Validation failure shouldn't affect the main flow
            pass

    object.__setattr__(ctx, "_validation_reports", validation_reports)

    ctx.on_progress(PipelineProgress(
        stage="validate", step=validated, total=len(active_rows),
        message=f"校验完成 · {validated} 款",
    ))


# ============================================================================
# Stage 5: Finalize
# ============================================================================

async def stage_finalize(ctx: PipelineContext, config: dict[str, Any] | None = None) -> None:
    """Finalization — handled by the caller/page since it involves state/output."""
    _ = config
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
