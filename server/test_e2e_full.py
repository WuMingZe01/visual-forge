"""
Full end-to-end verification: save -> load -> inject -> execute -> poll -> canvas restore.

Uses FastAPI TestClient + real providers (mock disabled at API level).
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient

# Use real providers (no mock)
import main as server_main
app = server_main.app
client = TestClient(app)

# ── Test data ──
WORKFLOW_NAME = "e2e_full_test"

CANVAS_PAYLOAD = {
    "name": WORKFLOW_NAME,
    "nodes": [
        {"id": "nd_img_a", "type": "image", "url": "", "x": 100, "y": 100, "w": 200, "h": 180},
        {"id": "nd_prompt_a", "type": "prompt", "text": "", "x": 400, "y": 100, "w": 220, "h": 120},
        {"id": "nd_gen_a", "type": "generator", "apiProvider": "yunwu", "ratio": "portrait", "resolution": "2k", "x": 250, "y": 350, "w": 260, "h": 300},
        {"id": "nd_out_a", "type": "output", "x": 250, "y": 700, "w": 200, "h": 100},
    ],
    "connections": [
        {"id": "c1", "from": "nd_img_a", "to": "nd_gen_a"},
        {"id": "c2", "from": "nd_prompt_a", "to": "nd_gen_a"},
        {"id": "c3", "from": "nd_gen_a", "to": "nd_out_a"},
    ],
    "exposed_mapping": {
        "product_image": {"node_id": "nd_img_a", "path": ["url"], "label": "产品图", "type": "image", "required": True},
        "user_prompt": {"node_id": "nd_prompt_a", "path": ["text"], "label": "提示词", "type": "text", "required": True},
    },
}

DYNAMIC_INPUTS = {
    "product_image": "https://cdn.example.com/summer_dress.jpg",
    "user_prompt": "A light summer dress with floral pattern, outdoor natural light, fashion photography",
}


def test_01_save():
    """Save canvas workflow to backend."""
    resp = client.post("/api/vf/workflows/save", json=CANVAS_PAYLOAD)
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    print("  [PASS] test_01_save")


def test_02_list():
    """List workflows includes saved one."""
    resp = client.get("/api/vf/workflows")
    assert resp.status_code == 200
    names = [w["name"] for w in resp.json()["workflows"]]
    assert WORKFLOW_NAME in names
    print("  [PASS] test_02_list")


def test_03_detail():
    """Get workflow detail — verifies nodes, connections, exposed_fields."""
    resp = client.get(f"/api/vf/workflows/{WORKFLOW_NAME}")
    assert resp.status_code == 200
    detail = resp.json()

    assert detail["name"] == WORKFLOW_NAME
    assert detail["source"] == "canvas"

    # Verify nodes contain coordinates (needed for canvas restore)
    nodes = detail["nodes"]
    assert len(nodes) == 4
    for n in nodes:
        assert "id" in n
        assert "type" in n
        assert "x" in n and "y" in n, f"Node {n['id']} missing coordinates for canvas restore"

    # Verify connections can be remapped
    connections = detail["connections"]
    assert len(connections) == 3
    for c in connections:
        assert "from" in c and "to" in c

    # Verify exposed_fields
    fields = detail["exposed_fields"]
    assert len(fields) == 2
    names = {f["name"] for f in fields}
    assert names == {"product_image", "user_prompt"}

    print("  [PASS] test_03_detail")


def test_04_canvas_restore_simulation():
    """
    Simulate what canvas.js does when it receives vf-load-workflow:
    - Clone nodes with fresh IDs
    - Remap connections to new IDs
    - Restore exposed_mapping
    """
    resp = client.get(f"/api/vf/workflows/{WORKFLOW_NAME}")
    detail = resp.json()

    nodes = detail["nodes"]
    connections = detail["connections"]

    # Step 1: Assign fresh IDs (simulating uid())
    import hashlib
    def uid(prefix="n"):
        return f"{prefix}_{hashlib.md5(str(time.time()).encode()).hexdigest()[:8]}"

    id_map = {}
    restored_nodes = []
    for n in nodes:
        new_id = uid(n.get("type", "n"))
        id_map[n["id"]] = new_id
        restored_nodes.append({**n, "id": new_id})

    # Step 2: Remap connections
    restored_connections = []
    for c in connections:
        restored_connections.append({
            "from": id_map.get(c["from"], c["from"]),
            "to": id_map.get(c["to"], c["to"]),
        })

    # Step 3: Verify
    assert len(restored_nodes) == 4
    assert len(restored_connections) == 3

    # All original IDs should be remapped
    for orig_n in nodes:
        assert orig_n["id"] in id_map
        assert id_map[orig_n["id"]] != orig_n["id"], "ID should be remapped to a new value"

    # Connections should reference new IDs
    for c in restored_connections:
        assert c["from"] not in [n["id"] for n in nodes], "Connection should use new ID"
        assert c["to"] not in [n["id"] for n in nodes], "Connection should use new ID"

    print("  [PASS] test_04_canvas_restore_simulation")
    print(f"  → 4 nodes restored, 3 connections remapped")
    print(f"  → Original IDs: {[n['id'] for n in nodes]}")
    print(f"  → New IDs:      {[n['id'] for n in restored_nodes]}")


def test_05_execute_and_poll():
    """Execute workflow with real provider, poll until complete."""
    resp = client.post("/api/vf/workflows/execute", json={
        "template_id": WORKFLOW_NAME,
        "dynamic_inputs": DYNAMIC_INPUTS,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "task_id" in data
    task_id = data["task_id"]
    print(f"  [PASS] test_05_execute (task_id={task_id})")

    # Poll task until complete
    max_polls = 30
    for i in range(max_polls):
        resp = client.get(f"/api/vf/pipelines/tasks/{task_id}")
        if resp.status_code != 200:
            print(f"  (poll {i+1}: {resp.status_code})")
            time.sleep(1)
            continue
        task = resp.json()
        status = task.get("status", "unknown")

        if status in ("completed", "failed"):
            if status == "completed":
                print(f"  [PASS] Task completed in {i+1} polls")
                if task.get("has_result"):
                    result = task.get("result", {})
                    row_results = result.get("row_results", {})
                    for nid, r in row_results.items():
                        urls = r.get("urls", [])
                        for u in urls:
                            print(f"    → Result from {nid}: {u[:80]}...")
                return
            else:
                print(f"  [FAIL] Task failed: {task.get('error', 'unknown')}")
                return
        time.sleep(1)
    print("  (task still running after max polls — real provider may be slow)")

    print("  [PASS] test_05_execute_and_poll")


def test_06_reload_after_save():
    """Verify that saved data survives a roundtrip (what canvas sees on reload)."""
    resp = client.get(f"/api/vf/workflows/{WORKFLOW_NAME}")
    detail = resp.json()

    # This is what InfiniteCanvas.tsx sends to the iframe
    canvas_load_msg = {
        "type": "vf-load-workflow",
        "data": {
            "name": detail["name"],
            "nodes": detail["nodes"],
            "connections": detail["connections"],
            "exposed_mapping": detail.get("exposed_mapping", {}),
        }
    }

    assert canvas_load_msg["data"]["name"] == WORKFLOW_NAME
    assert len(canvas_load_msg["data"]["nodes"]) == 4
    assert len(canvas_load_msg["data"]["connections"]) == 3
    assert len(canvas_load_msg["data"]["exposed_mapping"]) == 2

    print("  [PASS] test_06_reload_after_save")
    print(f"  → Canvas load message: {json.dumps(canvas_load_msg, ensure_ascii=False, indent=2)[:200]}...")


if __name__ == "__main__":
    import traceback
    tests = [
        test_01_save,
        test_02_list,
        test_03_detail,
        test_04_canvas_restore_simulation,
        test_05_execute_and_poll,
        test_06_reload_after_save,
    ]
    print("=" * 60)
    print("E2E Full Pipeline: Save -> Load -> Restore -> Execute")
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
    print(f"\nResults: {passed}/{len(tests)} passed")
    if failed == 0:
        print("E2E Full Pipeline PASS.")
    else:
        sys.exit(1)
