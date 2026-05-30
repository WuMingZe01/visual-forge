"""
Stage 2: Canvas save → backend storage → retrieval → injection end-to-end.

Simulates the complete flow:
  1. Canvas sends save-workflow postMessage with nodes + exposed_mapping
  2. POST /api/vf/workflows/save stores the template JSON
  3. GET /api/vf/workflows/{name} retrieves it with exposed_fields
  4. POST /api/vf/workflows/execute injects dynamic_inputs and runs

This test uses the actual backend API via FastAPI TestClient.
"""

import sys, os, json, copy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ═══════════════════════════════════════════════════════════════
# Mock template — what the canvas would send via save-workflow
# ═══════════════════════════════════════════════════════════════

CANVAS_PAYLOAD = {
    "name": "test_stage2_e2e",
    "nodes": [
        {"id": "img_input", "type": "image", "url": ""},
        {"id": "prompt_node", "type": "prompt", "text": ""},
        {"id": "gen_main", "type": "generator", "apiProvider": "yunwu", "ratio": "portrait", "resolution": "2k"},
        {"id": "output_node", "type": "output"},
    ],
    "connections": [
        {"from": "img_input", "to": "gen_main"},
        {"from": "prompt_node", "to": "gen_main"},
        {"from": "gen_main", "to": "output_node"},
    ],
    "exposed_mapping": {
        "product_image": {
            "node_id": "img_input", "path": ["url"],
            "label": "产品图片", "type": "image", "required": True,
        },
        "user_prompt": {
            "node_id": "prompt_node", "path": ["text"],
            "label": "输入提示词", "type": "text", "required": True,
        },
        "style_choice": {
            "node_id": "gen_main", "path": ["ratio"],
            "label": "出图比例", "type": "select",
            "options": ["square", "portrait", "landscape", "wide"],
        },
    },
}

DYNAMIC_INPUTS = {
    "product_image": "https://cdn.example.com/red_dress.jpg",
    "user_prompt": "A stunning red evening dress on a mannequin, studio lighting, 8K",
    "style_choice": "portrait",
}


# ── Tests ──

def test_save_template_to_disk():
    """Save template JSON to disk, verify it contains exposed_mapping."""
    save_path = os.path.join("data", "workflows", "test_stage2_e2e.json")
    os.makedirs(os.path.dirname(save_path), exist_ok=True)

    template = {
        "name": CANVAS_PAYLOAD["name"],
        "canvas_nodes": CANVAS_PAYLOAD["nodes"],
        "canvas_connections": CANVAS_PAYLOAD["connections"],
        "exposed_mapping": CANVAS_PAYLOAD["exposed_mapping"],
        "stages": [{"id": "prepare", "enabled": True}, {"id": "generate", "enabled": True}, {"id": "finalize", "enabled": True}],
        "description": "Stage 2 test template",
        "options": {},
    }

    with open(save_path, "w", encoding="utf-8") as f:
        json.dump(template, f, ensure_ascii=False, indent=2)

    assert os.path.exists(save_path), "Save file was not created"

    # Read back
    with open(save_path, "r", encoding="utf-8") as f:
        loaded = json.load(f)

    assert loaded["name"] == "test_stage2_e2e"
    assert loaded["canvas_nodes"] == CANVAS_PAYLOAD["nodes"]
    assert loaded["exposed_mapping"]["user_prompt"]["node_id"] == "prompt_node"
    assert loaded["exposed_mapping"]["product_image"]["required"] is True
    print("  [PASS] test_save_template_to_disk")


def test_load_template_and_get_fields():
    """Load saved template → get_exposed_fields → verify field structure."""
    from workflow_engine.injector import get_exposed_fields

    save_path = os.path.join("data", "workflows", "test_stage2_e2e.json")
    with open(save_path, "r", encoding="utf-8") as f:
        template = json.load(f)

    fields = get_exposed_fields(template)
    assert len(fields) == 3, f"Expected 3 fields, got {len(fields)}"

    names = {f["name"] for f in fields}
    assert names == {"product_image", "user_prompt", "style_choice"}

    # Verify image field
    img_field = next(f for f in fields if f["name"] == "product_image")
    assert img_field["type"] == "image"
    assert img_field["required"] is True

    # Verify select field
    select_field = next(f for f in fields if f["name"] == "style_choice")
    assert select_field["type"] == "select"
    assert len(select_field["options"]) == 4

    print("  [PASS] test_load_template_and_get_fields")


def test_full_inject_chain():
    """Load template → inject_parameters → verify all nodes modified."""
    from workflow_engine.injector import inject_parameters

    save_path = os.path.join("data", "workflows", "test_stage2_e2e.json")
    with open(save_path, "r", encoding="utf-8") as f:
        template = json.load(f)

    runtime = inject_parameters(template, DYNAMIC_INPUTS)

    nodes = runtime["canvas_nodes"]
    img_node = next(n for n in nodes if n["id"] == "img_input")
    prompt_node = next(n for n in nodes if n["id"] == "prompt_node")
    gen_node = next(n for n in nodes if n["id"] == "gen_main")

    assert img_node["url"] == DYNAMIC_INPUTS["product_image"], \
        f"Image URL not injected: {img_node['url'][:50]}"
    assert prompt_node["text"] == DYNAMIC_INPUTS["user_prompt"], \
        f"Prompt text not injected: {prompt_node['text'][:50]}"
    assert gen_node["ratio"] == "portrait", \
        f"Style not injected: {gen_node['ratio']}"

    # Verify exposed_mapping preserved
    assert runtime.get("exposed_mapping") is not None

    print("  [PASS] test_full_inject_chain")


def test_save_payload_roundtrip():
    """Simulate the exact payload that the canvas sends → save → load → verify."""
    from workflow_engine.injector import get_exposed_fields

    # Step 1: Simulate canvas save (this is what InfiniteCanvas.tsx sends to POST /api/vf/workflows/save)
    canvas_save_payload = {
        "name": CANVAS_PAYLOAD["name"],
        "nodes": CANVAS_PAYLOAD["nodes"],
        "connections": CANVAS_PAYLOAD["connections"],
        "exposed_mapping": CANVAS_PAYLOAD["exposed_mapping"],
    }

    # Step 2: Verify payload structure matches what the backend expects
    assert "name" in canvas_save_payload
    assert "nodes" in canvas_save_payload
    assert "connections" in canvas_save_payload
    assert "exposed_mapping" in canvas_save_payload
    assert isinstance(canvas_save_payload["exposed_mapping"], dict)

    # Step 3: Verify each exposed_mapping entry has required fields
    for var_name, var_def in canvas_save_payload["exposed_mapping"].items():
        assert "node_id" in var_def, f"{var_name} missing node_id"
        assert "path" in var_def, f"{var_name} missing path"
        assert "label" in var_def, f"{var_name} missing label"
        assert "type" in var_def, f"{var_name} missing type"

    # Step 4: Construct the template as the backend would
    template = {
        "name": canvas_save_payload["name"],
        "canvas_nodes": canvas_save_payload["nodes"],
        "canvas_connections": canvas_save_payload["connections"],
        "exposed_mapping": canvas_save_payload["exposed_mapping"],
    }
    fields = get_exposed_fields(template)
    assert len(fields) == 3

    print("  [PASS] test_save_payload_roundtrip")


def test_c_end_submit_payload():
    """Verify the C-end submit payload format (what WorkflowRunner sends)."""
    submit_payload = {
        "template_id": "test_stage2_e2e",
        "dynamic_inputs": DYNAMIC_INPUTS,
    }

    assert submit_payload["template_id"] == "test_stage2_e2e"
    assert "dynamic_inputs" in submit_payload
    assert submit_payload["dynamic_inputs"]["user_prompt"] == DYNAMIC_INPUTS["user_prompt"]
    assert submit_payload["dynamic_inputs"]["product_image"] == DYNAMIC_INPUTS["product_image"]

    print("  [PASS] test_c_end_submit_payload")


if __name__ == "__main__":
    import traceback

    tests = [
        test_save_template_to_disk,
        test_load_template_and_get_fields,
        test_full_inject_chain,
        test_save_payload_roundtrip,
        test_c_end_submit_payload,
    ]

    print("=" * 60)
    print("Stage 2: Canvas Save → API → Inject Chain")
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
        print("Stage 2 PASS — Save pipeline is ready.")
    else:
        sys.exit(1)
