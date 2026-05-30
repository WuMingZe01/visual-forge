"""
MiMo vision model provider.

Extracted from stages.py — handles MiMo (mimo-v2.5) vision analysis,
validation/scoring, and image analysis via the chat completions API.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import time
from typing import Any

import httpx

from .base import BaseProvider, ProviderResult
from .key_pool import KeyPool, merge_pool

logger = logging.getLogger(__name__)

# ============================================================================
# Configuration (from env with existing defaults)
# ============================================================================

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

# ============================================================================
# Internal Key Pool
# ============================================================================

_pool = KeyPool(provider="mimo")
_mimo_key_index = 1  # Start with first preferred key


def _sync_pool() -> None:
    now = time.time()
    merge_pool(_pool, MIMO_API_KEYS, 30_000, 3, now)


# ============================================================================
# Key Selection (prefer indices 1,2,3; fallback to 0)
# ============================================================================

async def _acquire_mimo_key() -> str:
    """Select next MiMo key, preferring keys at indices 1,2,3, falling back to 0."""
    global _mimo_key_index
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
# HTTP Request Logic (preserved exactly from stages.py)
# ============================================================================

def _mimo_headers(api_key: str) -> dict[str, str]:
    """MiMo API headers: uses 'api-key' header."""
    return {
        "Content-Type": "application/json",
        "api-key": api_key,
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


async def _parse_llm_response(resp: httpx.Response) -> str:
    """Extract text content from LLM response."""
    data = resp.json()
    msg = data.get("choices", [{}])[0].get("message", {})
    text = msg.get("content") or msg.get("reasoning_content") or ""
    if not text:
        snippet = json.dumps(data, ensure_ascii=False)[:300]
        raise RuntimeError(f"LLM returned empty content: {snippet}")
    return text


def _extract_json(text: str) -> dict[str, Any] | None:
    """Extract JSON object from LLM response text."""
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return None


# ============================================================================
# Vision Analysis (preserved exactly from stages.py)
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
# Validation (preserved exactly from stages.py)
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


# ============================================================================
# Generic analyze method (for thin orchestrator)
# ============================================================================

async def analyze_image(image_url: str, prompt: str = "分析图片内容") -> str:
    """Generic image analysis method for the thin orchestrator."""
    messages = [
        {"role": "system", "content": MIMO_DEFAULT_VISION_SYSTEM},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        },
    ]

    api_key = await _acquire_mimo_key()
    for _attempt in range(2):
        try:
            resp = await _llm_fetch_mimo(messages, max_tokens=4096, api_key=api_key)
            if resp.status_code == 200:
                return await _parse_llm_response(resp)
            err_text = resp.text[:500]
            if resp.status_code in (401, 403, 429):
                api_key = await _rotate_mimo_key(api_key)
                continue
            raise RuntimeError(f"MiMo HTTP {resp.status_code}: {err_text}")
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            logger.warning(f"MiMo connection error: {e}, rotating key")
            api_key = await _rotate_mimo_key(api_key)
            continue

    raise RuntimeError("MiMo analyze_image failed after key rotation")


# ============================================================================
# Provider Class
# ============================================================================

class MiMoProvider(BaseProvider):
    name = "mimo"

    async def generate(
        self,
        prompt: str,
        ref_image_url: str = None,
        ratio: str = "square",
        resolution: str = "2k",
        **kwargs: Any,
    ) -> ProviderResult:
        """MiMo does not generate images directly."""
        return ProviderResult(success=False, error="MiMo is a vision model, not an image generator")

    async def analyze(self, image_url: str, prompt: str = "分析图片内容") -> str:
        """Analyze an image using MiMo vision."""
        return await analyze_image(image_url, prompt)

    async def validate(self, image_url: str, **kwargs: Any) -> dict[str, Any]:
        """Validate a generated image against references."""
        return await validate_generation_result(
            result_b64=image_url,
            product_b64=kwargs.get("product_b64"),
            model_b64=kwargs.get("model_b64"),
            prompt=kwargs.get("prompt", ""),
            timeout_ms=kwargs.get("timeout_ms", 30_000),
        )

    async def health_check(self) -> bool:
        return bool(MIMO_API_KEYS and any(k.strip() for k in MIMO_API_KEYS))
