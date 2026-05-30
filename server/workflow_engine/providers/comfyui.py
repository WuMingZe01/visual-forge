"""
ComfyUI provider — sends full workflow JSON to ComfyUI backend, polls for results.

Default ComfyUI address: http://127.0.0.1:8188
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import urllib.request
import urllib.error
from typing import Any

from .base import BaseProvider, ProviderResult

logger = logging.getLogger(__name__)

COMFYUI_ADDRESS = os.getenv("COMFYUI_ADDRESS", "127.0.0.1:8188")
COMFYUI_HISTORY_TIMEOUT = int(os.getenv("COMFYUI_HISTORY_TIMEOUT", "120"))


def _get_comfy_history(comfy_address: str, prompt_id: str) -> dict:
    """Fetch ComfyUI history for a given prompt_id."""
    url = f"http://{comfy_address}/history/{prompt_id}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _extract_images_from_history(history_data: dict, prompt_id: str) -> list[str]:
    """Extract image filenames from ComfyUI history output."""
    outputs = history_data.get(prompt_id, {}).get("outputs", {})
    images = []
    for node_id, node_output in outputs.items():
        for item in node_output.get("images", []):
            filename = item.get("filename", "")
            subfolder = item.get("subfolder", "")
            img_type = item.get("type", "output")
            if filename:
                url = f"http://{COMFYUI_ADDRESS}/view?filename={filename}&subfolder={subfolder}&type={img_type}"
                images.append(url)
    return images


class ComfyUIProvider(BaseProvider):
    """Provider that sends a full ComfyUI workflow JSON to the ComfyUI backend."""

    name = "comfyui"

    def __init__(self, address: str = None):
        self.address = address or COMFYUI_ADDRESS

    async def generate(
        self,
        prompt: str = "",
        ref_image_url: str = None,
        ratio: str = "square",
        resolution: str = "2k",
        **kwargs: Any,
    ) -> ProviderResult:
        """
        Send a full ComfyUI workflow JSON and wait for results.

        kwargs must include:
          - workflow_json: dict — the complete ComfyUI workflow JSON
          OR
          - workflow: dict — same as above
          - client_id: str — optional client identifier
        """
        workflow = kwargs.get("workflow_json") or kwargs.get("workflow") or {}
        client_id = kwargs.get("client_id", "vf-engine")

        if not workflow:
            return ProviderResult(success=False, error="No ComfyUI workflow JSON provided")

        # Inject parameters from kwargs into workflow nodes
        params = kwargs.get("params", {})
        for node_id, node_inputs in params.items():
            if node_id in workflow:
                workflow[node_id].setdefault("inputs", {})
                for k, v in node_inputs.items():
                    workflow[node_id]["inputs"][k] = v

        prompt_payload = {"prompt": workflow, "client_id": client_id}
        data = json.dumps(prompt_payload).encode("utf-8")

        try:
            # Step 1: Submit workflow
            req = urllib.request.Request(
                f"http://{self.address}/prompt", data=data
            )
            resp = json.loads(urllib.request.urlopen(req, timeout=10).read())
            prompt_id = resp.get("prompt_id")
            if not prompt_id:
                # Some ComfyUI versions return different keys
                prompt_id = resp.get("job_id") or resp.get("task_id")
            if not prompt_id:
                return ProviderResult(success=False, error=f"No prompt_id in response: {resp}")

            logger.info(f"[ComfyUI] Submitted workflow, prompt_id={prompt_id}")

            # Step 2: Poll for completion
            for i in range(COMFYUI_HISTORY_TIMEOUT):
                try:
                    history = _get_comfy_history(self.address, prompt_id)
                    if prompt_id in history:
                        images = _extract_images_from_history(history, prompt_id)
                        if images:
                            logger.info(f"[ComfyUI] Got {len(images)} images for prompt_id={prompt_id}")
                            return ProviderResult(success=True, urls=images)
                        # History entry exists but no images yet — might still be processing
                except Exception:
                    pass
                await asyncio.sleep(1)

            return ProviderResult(
                success=False,
                error=f"ComfyUI timeout after {COMFYUI_HISTORY_TIMEOUT}s (prompt_id={prompt_id})",
            )

        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:500]
            return ProviderResult(success=False, error=f"ComfyUI HTTP {e.code}: {body}")
        except Exception as e:
            return ProviderResult(success=False, error=f"ComfyUI error: {e}")

    async def health_check(self) -> bool:
        """Check if ComfyUI backend is reachable."""
        try:
            req = urllib.request.Request(f"http://{self.address}/system_stats")
            urllib.request.urlopen(req, timeout=5)
            return True
        except Exception:
            return False
