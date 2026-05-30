"""
Full diagnostic: simulates user flow end-to-end, prints every intermediate state.

User flow:
  1. Canvas: create image + prompt + generator nodes, connect them
  2. Canvas: expose prompt.text as "user_prompt", image.url as "product_image"
  3. Canvas: click Save → postMessage → InfiniteCanvas → POST /api/vf/workflows/save
  4. C-end: select workflow → form renders with exposed_fields
  5. C-end: user fills form → POST /api/vf/workflows/execute
  6. Backend: load template → inject → prepare → generate → Provider
"""
import sys, os, json, asyncio
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
import main as server_main
app = server_main.app
client = TestClient(app)

# ═══════════════════════════════════════════════════════════
# Step 1: Simulate what canvas.js sends via save-workflow
# ═══════════════════════════════════════════════════════════

CANVAS_SAVE_MSG = {
    "name": "diagnostic_test_flow",
    "nodes": [
        {
            "id": "img_upload",
            "type": "image",
            "url": "",               # user will fill this
            "x": 100, "y": 100,
            "w": 200, "h": 180,
        },
        {
            "id": "prompt_input",
            "type": "prompt",
            "text": "",              # user will fill this
            "x": 400, "y": 100,
            "w": 220, "h": 120,
        },
        {
            "id": "gen_engine",
            "type": "generator",
            "apiProvider": "yunwu",  # static config baked into node
            "ratio": "portrait",     # static config
            "resolution": "2k",      # static config
            "x": 250, "y": 350,
            "w": 260, "h": 300,
        },
    ],
    "connections": [
        {"from": "img_upload", "to": "gen_engine"},
        {"from": "prompt_input", "to": "gen_engine"},
    ],
    "exposed_mapping": {
        "product_image": {
            "node_id": "img_upload",
            "path": ["url"],
            "label": "产品图片",
            "type": "image",
            "required": True,
        },
        "user_prompt": {
            "node_id": "prompt_input",
            "path": ["text"],
            "label": "正向提示词",
            "type": "text",
            "required": True,
        },
    },
}

# ═══════════════════════════════════════════════════════════
# Step 2: C-end user fills in the form
# ═══════════════════════════════════════════════════════════

DYNAMIC_INPUTS = {
    "product_image": "https://example.com/summer_dress.jpg",
    "user_prompt": "一件轻盈的碎花连衣裙，自然光室外拍摄，时尚大片质感",
}


print("=" * 60)
print("DIAGNOSTIC: Full User Flow Trace")
print("=" * 60)

# ── 1. SAVE ──
print("\n[1] Saving workflow...")
resp = client.post("/api/vf/workflows/save", json=CANVAS_SAVE_MSG)
assert resp.status_code == 200, f"SAVE FAILED: {resp.text}"
print(f"    SAVE OK: {resp.json()['name']}")

# ── 2. LIST ──
print("\n[2] Listing workflows...")
resp = client.get("/api/vf/workflows")
wf_list = resp.json()["workflows"]
names = [w["name"] for w in wf_list]
assert "diagnostic_test_flow" in names, f"NOT IN LIST: {names}"
our = next(w for w in wf_list if w["name"] == "diagnostic_test_flow")
print(f"    LIST OK: {our['name']} ({our['node_count']} nodes, source={our['source']})")
em = our.get("exposed_mapping", {})
ef = our.get("exposed_fields", [])
print(f"    exposed_mapping keys: {list(em.keys()) if em else 'EMPTY!'}")
print(f"    exposed_fields: {len(ef)} fields")

# ── 3. DETAIL ──
print("\n[3] Getting workflow detail...")
resp = client.get("/api/vf/workflows/diagnostic_test_flow")
detail = resp.json()
print(f"    DETAIL OK: {len(detail['nodes'])} nodes, {len(detail['connections'])} connections")
print(f"    exposed_fields: {[f['name'] + ':' + f['type'] for f in detail['exposed_fields']]}")

# ── 4. INJECT ──
print("\n[4] Injecting parameters...")
from workflow_engine.injector import inject_parameters
# Simulate what the execute endpoint does: load template, inject
save_path = os.path.join("data", "workflows", "diagnostic_test_flow.json")
with open(save_path, "r", encoding="utf-8") as f:
    template = json.load(f)

runtime = inject_parameters(template, DYNAMIC_INPUTS)
nodes = runtime.get("canvas_nodes", [])
img_node = next((n for n in nodes if n["type"] == "image"), None)
prompt_node = next((n for n in nodes if n["type"] == "prompt"), None)
gen_node = next((n for n in nodes if n["type"] == "generator"), None)

print(f"    Image node url = '{img_node['url'][:50]}...' " if img_node else "    Image node MISSING!")
print(f"    Prompt node text = '{prompt_node['text'][:50]}...'" if prompt_node else "    Prompt node MISSING!")
print(f"    Generator node provider = '{gen_node.get('apiProvider')}' ratio = '{gen_node.get('ratio')}'" if gen_node else "    Generator node MISSING!")

assert img_node["url"] == DYNAMIC_INPUTS["product_image"], "IMAGE URL NOT INJECTED!"
assert prompt_node["text"] == DYNAMIC_INPUTS["user_prompt"], "PROMPT NOT INJECTED!"
print("    INJECT OK: both values injected")

# ── 5. DAG EXECUTION ──
print("\n[5] Running DAG execution (stage_prepare → stage_generate)...")
from workflow_engine.types import PipelineContext, PipelineProgress
from workflow_engine.stages import stage_prepare, stage_generate

# Mock provider to capture calls
class DiagMockProvider:
    def __init__(self, name):
        self.name = name
        self.calls = []
    async def generate(self, prompt="", ref_image_url=None, ratio="square", resolution="2k", **kwargs):
        self.calls.append({
            "provider": self.name,
            "prompt": prompt[:80],
            "ref_image_url": ref_image_url,
            "ratio": ratio,
            "resolution": resolution,
            "kwargs": {k: v for k, v in kwargs.items() if v is not None},
        })
        from workflow_engine.providers.base import ProviderResult
        return ProviderResult(success=True, urls=[f"https://mock.{self.name}/output.jpg"])

import workflow_engine.providers as prov
diag_mock = DiagMockProvider("yunwu")
prov._yunwu = diag_mock
prov._grsai = diag_mock

ctx = PipelineContext(runtime_template=runtime, dynamic_inputs=DYNAMIC_INPUTS)
asyncio.run(stage_prepare(ctx))

print(f"    stage_prepare: {len(ctx.node_outputs)} nodes registered")
for nid, out in ctx.node_outputs.items():
    print(f"      {nid}: type={out.node_type}, result={'...' if out.result and len(str(out.result))>40 else out.result}")

asyncio.run(stage_generate(ctx))

print(f"    stage_generate: {len(diag_mock.calls)} Provider calls")
for i, call in enumerate(diag_mock.calls):
    print(f"      Call {i+1}: provider={call['provider']}")
    print(f"        prompt  = '{call['prompt']}'")
    print(f"        ref_img = '{call['ref_image_url'][:60] if call['ref_image_url'] else 'None'}'")
    print(f"        ratio   = '{call['ratio']}'")
    print(f"        res     = '{call['resolution']}'")

assert len(diag_mock.calls) >= 1, "NO PROVIDER CALLS MADE!"

call = diag_mock.calls[0]
assert call["provider"] == "yunwu", f"Wrong provider: {call['provider']}"
assert DYNAMIC_INPUTS["user_prompt"] in call["prompt"], f"Prompt not passed through! Expected '{DYNAMIC_INPUTS['user_prompt'][:30]}' in '{call['prompt'][:50]}'"
assert call["ref_image_url"] == DYNAMIC_INPUTS["product_image"], f"Image URL not passed through! Got '{call['ref_image_url']}'"
assert call["ratio"] == "portrait", f"Ratio not from node config! Got '{call['ratio']}'"
assert call["resolution"] == "2k", f"Resolution not from node config! Got '{call['resolution']}'"

print("\n    DAG EXECUTION OK: Provider called with correct params")

# ── 6. E2E via API ──
print("\n[6] E2E via POST /api/vf/workflows/execute...")
resp = client.post("/api/vf/workflows/execute", json={
    "template_id": "diagnostic_test_flow",
    "dynamic_inputs": DYNAMIC_INPUTS,
})
print(f"    Status: {resp.status_code}")
data = resp.json()
print(f"    Response: task_id={data.get('task_id')}, status={data.get('status')}")
print(f"    Injected: {data.get('injected_fields')}")

assert resp.status_code == 200, f"EXECUTE FAILED: {resp.text}"
assert "task_id" in data

print("\n" + "=" * 60)
print("ALL CHECKS PASSED — Full flow works end-to-end.")
print("=" * 60)
print()
print("Summary of what the system does:")
print("  1. Canvas saves: image + prompt + generator nodes with connections")
print("  2. Canvas saves: exposed_mapping = {product_image, user_prompt}")
print("  3. Backend stores template to disk")
print("  4. C-end loads template → DynamicTemplateForm renders upload+textarea")
print("  5. User fills form → POST { template_id, dynamic_inputs }")
print("  6. inject_parameters modifies node values in-place")
print("  7. stage_prepare registers image.url + prompt.text in ctx.node_outputs")
print("  8. stage_generate → execute_generator_node:")
print("     - Traverses connections to find upstream image + prompt")
print("     - Reads node.apiProvider → YunwuProvider")
print("     - Reads node.ratio/ node.resolution from canvas config")
print("     - Calls YunwuProvider.generate(prompt=..., ref_image_url=..., ratio=..., resolution=...)")
print("  9. Provider returns real image URLs")
print(" 10. C-end displays results")
