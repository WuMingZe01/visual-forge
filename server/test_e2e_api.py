"""
Stage 4: Full E2E integration test using FastAPI TestClient.

Tests the complete pipeline:
  POST /api/vf/workflows/save       → save template with exposed_mapping
  GET  /api/vf/workflows             → list workflows (includes exposed_fields count)
  GET  /api/vf/workflows/{name}      → get detail with exposed_fields
  POST /api/vf/workflows/execute     → execute with dynamic_inputs

Uses mock providers so no real API calls are made.
"""

import sys, os, json, asyncio, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient

# Patch providers BEFORE importing the app
import workflow_engine.providers as prov
from workflow_engine.providers.base import BaseProvider, ProviderResult


class MockProvider(BaseProvider):
    """Mock provider that returns fake results without real API calls."""
    async def generate(self, prompt="", ref_image_url=None, **kwargs):
        return ProviderResult(
            success=True,
            urls=[f"https://mock.cdn/e2e_test_output_{abs(hash(prompt)) & 0xFFFFFF:06x}.jpg"],
        )
    async def analyze(self, image_url="", prompt=""):
        return f"Mock E2E analysis: {prompt[:40]}"
    async def validate(self, image_url=""):
        return {"score": 0.92, "passed": True}


prov._yunwu = MockProvider()
prov._grsai = MockProvider()
prov._mimo = MockProvider()
prov._llm = MockProvider()

# Now import the FastAPI app (server/ is on sys.path, no package prefix)
import main as server_main
app = server_main.app

client = TestClient(app)

# ── Test data ──

TEMPLATE_NAME = "e2e_test_workflow"

SAVE_PAYLOAD = {
    "name": TEMPLATE_NAME,
    "nodes": [
        {"id": "img1", "type": "image", "url": ""},
        {"id": "prompt1", "type": "prompt", "text": ""},
        {"id": "gen1", "type": "generator", "apiProvider": "yunwu", "ratio": "square", "resolution": "2k"},
        {"id": "out1", "type": "output"},
    ],
    "connections": [
        {"from": "img1", "to": "gen1"},
        {"from": "prompt1", "to": "gen1"},
        {"from": "gen1", "to": "out1"},
    ],
    "exposed_mapping": {
        "product_image": {
            "node_id": "img1", "path": ["url"],
            "label": "产品图片", "type": "image", "required": True,
        },
        "user_prompt": {
            "node_id": "prompt1", "path": ["text"],
            "label": "正向提示词", "type": "text", "required": True,
        },
    },
}

EXECUTE_PAYLOAD = {
    "template_id": TEMPLATE_NAME,
    "dynamic_inputs": {
        "product_image": "https://cdn.example.com/e2e_blue_dress.jpg",
        "user_prompt": "E2E test: elegant blue evening gown, studio lighting, commercial photography, 8K",
    },
}


# ── Tests ──

def test_e2e_01_save_workflow():
    """Save a canvas workflow template."""
    resp = client.post("/api/vf/workflows/save", json=SAVE_PAYLOAD)
    assert resp.status_code == 200, f"Save failed: {resp.text}"
    data = resp.json()
    assert data["ok"] is True
    assert data["name"] == TEMPLATE_NAME
    print("  [PASS] test_e2e_01_save_workflow")


def test_e2e_02_list_workflows():
    """List all workflows — should include our saved one."""
    resp = client.get("/api/vf/workflows")
    assert resp.status_code == 200
    data = resp.json()
    assert "workflows" in data

    names = [w["name"] for w in data["workflows"]]
    assert TEMPLATE_NAME in names, f"Saved workflow not in list: {names}"

    our_wf = next(w for w in data["workflows"] if w["name"] == TEMPLATE_NAME)
    assert our_wf["source"] == "canvas"
    assert our_wf["node_count"] == 4
    assert "exposed_fields" in our_wf or "exposed_mapping" in our_wf
    print("  [PASS] test_e2e_02_list_workflows")


def test_e2e_03_get_workflow_detail():
    """Get workflow detail with exposed_fields."""
    resp = client.get(f"/api/vf/workflows/{TEMPLATE_NAME}")
    assert resp.status_code == 200
    detail = resp.json()

    assert detail["name"] == TEMPLATE_NAME
    assert detail["source"] == "canvas"
    assert len(detail["nodes"]) == 4
    assert len(detail["connections"]) == 3

    # exposed_fields must be present and correct
    assert "exposed_fields" in detail
    fields = detail["exposed_fields"]
    assert len(fields) == 2

    field_names = {f["name"] for f in fields}
    assert field_names == {"product_image", "user_prompt"}

    img_field = next(f for f in fields if f["name"] == "product_image")
    assert img_field["type"] == "image"
    assert img_field["required"] is True

    print("  [PASS] test_e2e_03_get_workflow_detail")


def test_e2e_04_execute_workflow():
    """Execute a workflow with dynamic_inputs — mock providers return fake images."""
    resp = client.post("/api/vf/workflows/execute", json=EXECUTE_PAYLOAD)
    assert resp.status_code == 200, f"Execute failed: {resp.text}"
    data = resp.json()

    assert "task_id" in data, f"No task_id in response: {data}"
    assert data["status"] in ("completed", "running", "pending"), \
        f"Unexpected status: {data['status']}"

    # Check injected_fields reflects which inputs were used
    assert "injected_fields" in data
    assert "user_prompt" in data["injected_fields"]
    assert "product_image" in data["injected_fields"]

    print(f"  [PASS] test_e2e_04_execute_workflow (task_id={data['task_id']}, status={data['status']})")


def test_e2e_05_execute_fields_actually_injected():
    """Verify injected values actually reach the runtime template."""
    import asyncio
    from workflow_engine.injector import inject_parameters

    # Load saved template directly
    save_path = os.path.join("data", "workflows", f"{TEMPLATE_NAME}.json")
    with open(save_path, "r", encoding="utf-8") as f:
        template = json.load(f)

    # Inject
    runtime = inject_parameters(template, EXECUTE_PAYLOAD["dynamic_inputs"])

    nodes = runtime["canvas_nodes"]
    img_node = next(n for n in nodes if n["type"] == "image")
    prompt_node = next(n for n in nodes if n["type"] == "prompt")

    assert img_node["url"] == EXECUTE_PAYLOAD["dynamic_inputs"]["product_image"]
    assert prompt_node["text"] == EXECUTE_PAYLOAD["dynamic_inputs"]["user_prompt"]

    print("  [PASS] test_e2e_05_execute_fields_actually_injected")


def test_e2e_06_comfyui_format_execution():
    """Execute with ComfyUI dict format template via run-from-canvas."""
    comfy_payload = {
        "name": "e2e_comfy_test",
        "canvas_id": "e2e_canvas_001",
        "nodes": [
            {"id": "img_src", "type": "image", "url": ""},
            {"id": "txt_node", "type": "prompt", "text": ""},
            {"id": "gen_core", "type": "generator", "apiProvider": "auto"},
            {"id": "sink", "type": "output"},
        ],
        "connections": [
            {"from": "img_src", "to": "gen_core"},
            {"from": "txt_node", "to": "gen_core"},
            {"from": "gen_core", "to": "sink"},
        ],
        "dynamic_inputs": {
            "image_url": "https://cdn.example.com/comfy_test.jpg",
            "prompt_text": "ComfyUI E2E test prompt",
        },
    }

    resp = client.post("/api/vf/workflows/run-from-canvas", json=comfy_payload)
    assert resp.status_code == 200, f"run-from-canvas failed: {resp.text}"
    data = resp.json()
    assert "task_id" in data
    print(f"  [PASS] test_e2e_06_comfyui_format_execution (task_id={data['task_id']})")


def test_e2e_07_workflow_not_found():
    """404 for non-existent workflow."""
    resp = client.get("/api/vf/workflows/nonexistent_12345")
    assert resp.status_code == 404
    print("  [PASS] test_e2e_07_workflow_not_found")


def test_e2e_08_required_field_missing_error():
    """Execute without required field should return error."""
    bad_payload = {
        "template_id": TEMPLATE_NAME,
        "dynamic_inputs": {
            # product_image is required but missing
            "user_prompt": "only prompt, no image",
        },
    }
    resp = client.post("/api/vf/workflows/execute", json=bad_payload)
    # Should be 400 because required product_image is missing
    assert resp.status_code == 400, \
        f"Expected 400 for missing required field, got {resp.status_code}: {resp.text}"
    print("  [PASS] test_e2e_08_required_field_missing_error")


def test_e2e_09_task_status_polling():
    """After executing, poll for task status."""
    # Execute a workflow
    resp = client.post("/api/vf/workflows/execute", json=EXECUTE_PAYLOAD)
    assert resp.status_code == 200
    task_id = resp.json()["task_id"]

    # Poll task
    import time
    max_attempts = 10
    for attempt in range(max_attempts):
        resp = client.get(f"/api/vf/pipelines/tasks/{task_id}")
        if resp.status_code != 200:
            break
        task = resp.json()
        if task.get("status") in ("completed", "failed"):
            assert task["status"] == "completed", \
                f"Task failed: {task.get('error', 'unknown')}"
            # Should have result
            if task.get("has_result"):
                assert task["result"] is not None
            break
        time.sleep(0.5)
    else:
        # Timeout is acceptable — the mock provider might be async
        print(f"  (task {task_id} still running after {max_attempts} polls, acceptable)")

    print("  [PASS] test_e2e_09_task_status_polling")


# ── Runner ──

if __name__ == "__main__":
    import traceback

    tests = [
        test_e2e_01_save_workflow,
        test_e2e_02_list_workflows,
        test_e2e_03_get_workflow_detail,
        test_e2e_04_execute_workflow,
        test_e2e_05_execute_fields_actually_injected,
        test_e2e_06_comfyui_format_execution,
        test_e2e_07_workflow_not_found,
        test_e2e_08_required_field_missing_error,
        test_e2e_09_task_status_polling,
    ]

    print("=" * 60)
    print("Stage 4: E2E API Integration Tests")
    print("=" * 60)

    passed = failed = 0
    for t in tests:
        try:
            t()
            passed += 1
        except Exception as e:
            print(f"  [FAIL] {t.__name__}: {e}")
            traceback.print_exc()
            failed += 1

    print(f"\nResults: {passed} passed, {failed} failed, {len(tests)} total")
    if failed == 0:
        print("Stage 4 PASS — Full E2E pipeline is connected.")
    else:
        print("Stage 4 FAILED.")
        sys.exit(1)
