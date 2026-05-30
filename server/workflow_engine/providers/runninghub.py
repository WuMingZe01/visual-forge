"""
RunningHub provider — submits full workflow JSON to RunningHub API, polls for results.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

import httpx

from .base import BaseProvider, ProviderResult

logger = logging.getLogger(__name__)

RUNNINGHUB_API_BASE = os.getenv("RUNNINGHUB_API_BASE", "https://www.runninghub.cn")
RUNNINGHUB_API_KEY = os.getenv("RUNNINGHUB_API_KEY", "")
RUNNINGHUB_TIMEOUT = int(os.getenv("RUNNINGHUB_TIMEOUT", "600"))


class RunningHubProvider(BaseProvider):
    """Provider that submits a full workflow to RunningHub and polls for results."""

    name = "runninghub"

    def __init__(self, api_base: str = None, api_key: str = None):
        self.api_base = api_base or RUNNINGHUB_API_BASE
        self.api_key = api_key or RUNNINGHUB_API_KEY

    async def generate(
        self,
        prompt: str = "",
        ref_image_url: str = None,
        ratio: str = "square",
        resolution: str = "2k",
        **kwargs: Any,
    ) -> ProviderResult:
        """
        Submit a workflow to RunningHub and wait for results.

        kwargs must include:
          - workflow_id: str — the RunningHub workflow/app ID
          - workflow_json: dict — the complete workflow JSON (node overrides)
          OR
          - node_params: dict — node_id → {input_name: value} overrides
        """
        workflow_id = kwargs.get("workflow_id") or kwargs.get("workflowId") or ""
        workflow_json = kwargs.get("workflow_json") or kwargs.get("workflow") or {}
        node_params = kwargs.get("node_params") or kwargs.get("params") or {}

        if not workflow_id and not workflow_json:
            return ProviderResult(success=False, error="No workflow_id or workflow_json provided")

        if not self.api_key:
            return ProviderResult(success=False, error="RUNNINGHUB_API_KEY not configured")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload: dict[str, Any] = {
            "workflowId": workflow_id,
            "nodeInfoList": [
                {"nodeId": nid, "fieldName": fname, "fieldValue": str(fval)}
                for nid, overrides in node_params.items()
                if isinstance(overrides, dict)
                for fname, fval in overrides.items()
            ],
        }

        # If a full workflow JSON is provided, include it
        if workflow_json:
            payload["workflow"] = workflow_json

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Step 1: Submit task
                submit_url = f"{self.api_base}/task/openapi/create"
                resp = await client.post(submit_url, headers=headers, json=payload)
                if resp.status_code != 200:
                    return ProviderResult(
                        success=False,
                        error=f"RunningHub submit failed: HTTP {resp.status_code} — {resp.text[:300]}",
                    )
                data = resp.json()
                code = data.get("code", -1)
                if code != 0:
                    return ProviderResult(
                        success=False,
                        error=f"RunningHub error: {data.get('msg', 'unknown')} (code={code})",
                    )
                task_id = data.get("data", {}).get("taskId") or data.get("data", {}).get("task_id")
                if not task_id:
                    return ProviderResult(success=False, error=f"No taskId in response: {data}")

                logger.info(f"[RunningHub] Task submitted: {task_id}")

                # Step 2: Poll for results
                poll_url = f"{self.api_base}/task/openapi/status"
                for i in range(RUNNINGHUB_TIMEOUT // 5):
                    await asyncio.sleep(5)
                    try:
                        poll_resp = await client.post(
                            poll_url, headers=headers, json={"taskId": task_id}
                        )
                        if poll_resp.status_code != 200:
                            continue
                        poll_data = poll_resp.json()
                        status_code = poll_data.get("code", -1)
                        if status_code != 0:
                            continue
                        task_status = poll_data.get("data", {}).get("status", "")
                        if task_status == "SUCCESS":
                            result_urls = poll_data.get("data", {}).get("result", [])
                            if isinstance(result_urls, str):
                                result_urls = [result_urls]
                            logger.info(f"[RunningHub] Task {task_id} completed: {len(result_urls)} results")
                            return ProviderResult(success=True, urls=result_urls)
                        elif task_status == "FAILED":
                            return ProviderResult(
                                success=False,
                                error=f"RunningHub task failed: {poll_data.get('data', {}).get('error', 'unknown')}",
                            )
                    except Exception:
                        continue

                return ProviderResult(
                    success=False,
                    error=f"RunningHub task {task_id} timed out after {RUNNINGHUB_TIMEOUT}s",
                )

        except httpx.ConnectError as e:
            return ProviderResult(success=False, error=f"RunningHub connection error: {e}")
        except Exception as e:
            return ProviderResult(success=False, error=f"RunningHub error: {e}")

    async def health_check(self) -> bool:
        return bool(self.api_key)
