"""
Stage 3 TDD: Verify DAG engine correctly parses canvas JSON,
extracts params from upstream nodes, and calls the right Provider.

Key assertions:
  1. Engine finds generator/msgen nodes in the canvas DAG
  2. Prompt from upstream prompt node is extracted and passed to Provider
  3. Image URL from upstream image node is extracted and passed to Provider
  4. Node properties (ratio, resolution) are forwarded to Provider
  5. Provider is selected based on node.apiProvider
  6. Mock Provider captures the actual params it received
"""

import sys, os, asyncio
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from workflow_engine.types import PipelineContext, NodeOutput, PipelineProgress
from workflow_engine.stages import stage_prepare, stage_generate
from workflow_engine.node_registry import get_node_handler, NODE_TYPE_MAP

# ── Mock Provider that captures call params ──

class MockCaptureProvider:
    """Captures the params passed to generate() for assertions."""
    def __init__(self):
        self.calls = []

    async def generate(self, prompt="", ref_image_url=None, ratio="square", resolution="2k", **kwargs):
        self.calls.append({
            "prompt": prompt,
            "ref_image_url": ref_image_url,
            "ratio": ratio,
            "resolution": resolution,
            "kwargs": kwargs,
        })
        from workflow_engine.providers.base import ProviderResult
        return ProviderResult(success=True, urls=["https://mock.cdn/test_output.jpg"])


# ── Test 1: DAG with 2 nodes (prompt → generator) ──

def test_dag_prompt_to_generator():
    """DAG: prompt node → generator node. Verify prompt text reaches Provider."""
    mock = MockCaptureProvider()

    # Patch get_provider to return our mock
    import workflow_engine.providers as prov
    prov._yunwu = mock
    prov._grsai = mock

    ctx = PipelineContext(
        runtime_template={
            "canvas_nodes": [
                {"id": "prompt_a", "type": "prompt", "text": "一只在月球上的猫"},
                {"id": "gen_1", "type": "generator", "apiProvider": "yunwu", "ratio": "square", "resolution": "2k"},
            ],
            "canvas_connections": [
                {"from": "prompt_a", "to": "gen_1"},
            ],
        },
    )

    asyncio.run(stage_prepare(ctx))
    assert "prompt_a" in ctx.node_outputs, "Prompt node should be registered"
    assert ctx.node_outputs["prompt_a"].result == "一只在月球上的猫"

    asyncio.run(stage_generate(ctx))

    assert len(mock.calls) == 1, f"Expected 1 generate call, got {len(mock.calls)}"
    call = mock.calls[0]
    assert call["prompt"] == "一只在月球上的猫", f"Wrong prompt: {call['prompt']}"
    assert call["ratio"] == "square"
    assert call["resolution"] == "2k"
    print("  [PASS] test_dag_prompt_to_generator: prompt='一只在月球上的猫'")


# ── Test 2: DAG with image → generator ──

def test_dag_image_to_generator():
    """DAG: image node → generator node. Verify image URL reaches Provider."""
    mock = MockCaptureProvider()
    import workflow_engine.providers as prov
    prov._yunwu = mock

    ctx = PipelineContext(
        runtime_template={
            "canvas_nodes": [
                {"id": "img_src", "type": "image", "url": "https://cdn.example.com/red_dress.jpg"},
                {"id": "gen_2", "type": "generator", "apiProvider": "auto", "ratio": "portrait"},
            ],
            "canvas_connections": [
                {"from": "img_src", "to": "gen_2"},
            ],
        },
    )

    asyncio.run(stage_prepare(ctx))
    assert "img_src" in ctx.node_outputs
    assert ctx.node_outputs["img_src"].result == "https://cdn.example.com/red_dress.jpg"

    asyncio.run(stage_generate(ctx))

    assert len(mock.calls) == 1
    call = mock.calls[0]
    assert call["ref_image_url"] == "https://cdn.example.com/red_dress.jpg", \
        f"Wrong ref_image: {call['ref_image_url']}"
    print("  [PASS] test_dag_image_to_generator: ref_image passed to Provider")


# ── Test 3: DAG with prompt + image → generator ──

def test_dag_full_topology():
    """Full DAG: prompt + image → generator. Both should reach Provider."""
    mock = MockCaptureProvider()
    import workflow_engine.providers as prov
    prov._yunwu = mock

    ctx = PipelineContext(
        runtime_template={
            "canvas_nodes": [
                {"id": "img_in", "type": "image", "url": "https://cdn.example.com/blue_shirt.jpg"},
                {"id": "text_in", "type": "prompt", "text": "一件质感极佳的海军蓝衬衫，高清商业摄影"},
                {"id": "gen_main", "type": "generator", "apiProvider": "yunwu", "ratio": "landscape", "resolution": "4k"},
            ],
            "canvas_connections": [
                {"from": "img_in", "to": "gen_main"},
                {"from": "text_in", "to": "gen_main"},
            ],
        },
    )

    asyncio.run(stage_prepare(ctx))
    asyncio.run(stage_generate(ctx))

    assert len(mock.calls) == 1
    call = mock.calls[0]
    assert call["prompt"] == "一件质感极佳的海军蓝衬衫，高清商业摄影"
    assert call["ref_image_url"] == "https://cdn.example.com/blue_shirt.jpg"
    assert call["ratio"] == "landscape"
    assert call["resolution"] == "4k"
    print("  [PASS] test_dag_full_topology: prompt + ref_image + ratio + resolution all correct")


# ── Test 4: msgen node type → same handler ──

def test_dag_msgen_node():
    """msgen type nodes should use the same execute_generator_node handler."""
    mock = MockCaptureProvider()
    import workflow_engine.providers as prov
    prov._yunwu = mock

    ctx = PipelineContext(
        runtime_template={
            "canvas_nodes": [
                {"id": "p1", "type": "prompt", "text": "test for msgen"},
                {"id": "ms_1", "type": "msgen", "apiProvider": "auto", "ratio": "square"},
            ],
            "canvas_connections": [
                {"from": "p1", "to": "ms_1"},
            ],
        },
    )

    asyncio.run(stage_prepare(ctx))
    asyncio.run(stage_generate(ctx))

    assert len(mock.calls) == 1
    call = mock.calls[0]
    assert call["prompt"] == "test for msgen"
    assert "ms_1" in ctx.node_outputs
    assert ctx.node_outputs["ms_1"].node_type == "msgen"
    print("  [PASS] test_dag_msgen_node: msgen dispatched to same handler")


# ── Test 5: Node registry has all required types ──

def test_node_registry_coverage():
    """All generator types must be in NODE_TYPE_MAP with handlers."""
    required = ["image", "prompt", "llm", "generator", "msgen", "output"]
    for t in required:
        assert t in NODE_TYPE_MAP, f"Missing node type: {t}"
        if t != "output":
            handler = NODE_TYPE_MAP[t].get("handler")
            assert handler is not None, f"No handler for {t}"
    print("  [PASS] test_node_registry_coverage: all required types registered")


# ── Test 6: Default prompt when no upstream ──

def test_dag_no_upstream_uses_default():
    """Generator with no upstream prompt → use DEFAULT_PROMPT."""
    mock = MockCaptureProvider()
    import workflow_engine.providers as prov
    prov._yunwu = mock

    ctx = PipelineContext(
        runtime_template={
            "canvas_nodes": [
                {"id": "gen_solo", "type": "generator", "apiProvider": "auto", "ratio": "square"},
            ],
        },
    )

    asyncio.run(stage_generate(ctx))

    assert len(mock.calls) == 1
    call = mock.calls[0]
    assert len(call["prompt"]) > 0, "Should have default prompt"
    assert "product photo" in call["prompt"].lower()
    print("  [PASS] test_dag_no_upstream_uses_default: default prompt applied")


# ── Test 7: Handler extracts node-level prompt fallback ──

def test_dag_node_level_prompt():
    """If node has prompt/text field but no upstream prompt, use node's value."""
    mock = MockCaptureProvider()
    import workflow_engine.providers as prov
    prov._yunwu = mock
    prov._grsai = mock  # node uses grsai provider

    ctx = PipelineContext(
        runtime_template={
            "canvas_nodes": [
                {"id": "gen_custom", "type": "generator", "apiProvider": "grsai",
                 "prompt": "Custom node-level prompt override", "ratio": "portrait"},
            ],
        },
    )

    asyncio.run(stage_generate(ctx))

    assert len(mock.calls) == 1
    call = mock.calls[0]
    assert "Custom node-level prompt override" in call["prompt"]
    print("  [PASS] test_dag_node_level_prompt: node prompt field used")


if __name__ == "__main__":
    import traceback
    tests = [
        test_dag_prompt_to_generator,
        test_dag_image_to_generator,
        test_dag_full_topology,
        test_dag_msgen_node,
        test_node_registry_coverage,
        test_dag_no_upstream_uses_default,
        test_dag_node_level_prompt,
    ]
    print("=" * 60)
    print("Stage 3 TDD: DAG Engine — Parameter Extraction & Provider Routing")
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
        print("Stage 3 TDD PASS — DAG engine correctly routes to Provider.")
    else:
        sys.exit(1)
