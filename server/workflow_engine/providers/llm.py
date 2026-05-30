"""
DeepSeek text completion provider.

Extracted from stages.py — handles the DeepSeek chat completions API
for text prompt assembly and generation.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

from .base import BaseProvider, ProviderResult

logger = logging.getLogger(__name__)

# ============================================================================
# Configuration (from env with existing defaults)
# ============================================================================

DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_MODEL = "deepseek-chat"
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-fd9038ab2a344273b77a7b647b92d387")
DEEPSEEK_MAX_TOKENS = 4096
DEEPSEEK_TIMEOUT = 120.0


# ============================================================================
# HTTP Request Logic (preserved exactly from stages.py)
# ============================================================================

def _deepseek_headers() -> dict[str, str]:
    """DeepSeek API headers: uses Bearer token."""
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
    }


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
# Prompt Assembly (preserved exactly from stages.py)
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
# Generic completion method
# ============================================================================

async def complete(messages: list[dict[str, Any]], max_tokens: int = DEEPSEEK_MAX_TOKENS) -> str:
    """Generic text completion method."""
    resp = await _llm_fetch_deepseek(messages, max_tokens=max_tokens)
    if resp.status_code != 200:
        err_text = resp.text[:500]
        raise RuntimeError(f"DeepSeek HTTP {resp.status_code}: {err_text}")
    return await _parse_llm_response(resp)


# ============================================================================
# Provider Class
# ============================================================================

class LLMProvider(BaseProvider):
    name = "llm"

    async def generate(
        self,
        prompt: str,
        ref_image_url: str = None,
        ratio: str = "square",
        resolution: str = "2k",
        **kwargs: Any,
    ) -> ProviderResult:
        """LLM does not generate images directly."""
        return ProviderResult(success=False, error="LLM is a text model, not an image generator")

    async def complete(self, messages: list[dict[str, Any]], max_tokens: int = DEEPSEEK_MAX_TOKENS) -> str:
        """Complete a text prompt."""
        return await complete(messages, max_tokens)

    async def assemble_prompt(self, invariant_features: str, product_info: str) -> str:
        """Assemble a final generation prompt from analysis results."""
        return await assemble_final_prompt(invariant_features, product_info)

    async def health_check(self) -> bool:
        return bool(DEEPSEEK_API_KEY and DEEPSEEK_API_KEY.strip())
