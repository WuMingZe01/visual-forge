"""
Integration test for the workflow engine: injector + stages + executor.

Tests:
  1. Injector — VF list format           (canvas_nodes + exposed_mapping → injected values)
  2. Injector — ComfyUI dict format      (numeric-key dict + dot-notation paths)
  3. Injector — Required variable missing → InjectionError
  4. Injector — Deep nested path injection
  5. Stages — stage_prepare registers image + prompt nodes
  6. Executor — full pipeline runs and returns results (mock providers)
"""

import sys
import os
import json
import asyncio

# Ensure server/ is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ── Test 1: Injector — VF list format ──

def test_injector_vf_list():
    """VF canvas list format with simple paths."""
    from workflow_engine.injector import inject_parameters, get_exposed_fields

    template = {
        "canvas_nodes": [
            {"id": "img1", "type": "image", "url": ""},
            {"id": "prompt1", "type": "prompt", "text": ""},
        ],
        "canvas_connections": [],
        "exposed_mapping": {
            "product_img": {"node_id": "img1", "path": ["url"], "label": "产品图", "type": "image"},
            "user_prompt": {"node_id": "prompt1", "path": ["text"], "label": "提示词", "type": "text"},
        },
    }

    dynamic_inputs = {
        "product_img": "https://cdn.example.com/shirt.jpg",
        "user_prompt": "一个穿白衬衫的超模在巴黎",
    }

    runtime = inject_parameters(template, dynamic_inputs)
    nodes = runtime["canvas_nodes"]

    # Assertions
    assert nodes[0]["url"] == "https://cdn.example.com/shirt.jpg", \
        f"Image URL not injected: {nodes[0]['url']}"
    assert nodes[1]["text"] == "一个穿白衬衫的超模在巴黎", \
        f"Prompt text not injected: {nodes[1]['text']}"
    assert runtime["exposed_mapping"] == template["exposed_mapping"], \
        "exposed_mapping should be preserved"

    # get_exposed_fields
    fields = get_exposed_fields(runtime)
    assert len(fields) == 2
    assert fields[0]["name"] == "product_img"
    assert fields[1]["label"] == "提示词"

    print("  PASS test_injector_vf_list")


# ── Test 2: Injector — ComfyUI dict format ──

def test_injector_comfy_dict():
    """ComfyUI dict format with dot-notation paths."""
    from workflow_engine.injector import inject_parameters

    template = {
        "23": {"inputs": {"text": "", "clip": ["14", 1]}, "class_type": "CLIPTextEncode"},
        "144": {"inputs": {"width": 512, "height": 512, "batch_size": 1}, "class_type": "EmptyLatentImage"},
        "22": {"inputs": {"seed": 0, "steps": 20, "cfg": 7.0, "sampler_name": "euler"}, "class_type": "KSampler"},
        "158": {"inputs": {"filename_prefix": "ComfyUI", "images": ["146", 0]}, "class_type": "SaveImage"},
        "exposed_mapping": {
            "user_prompt": {"node_id": "23", "path": "inputs.text", "label": "正向提示词", "type": "text"},
            "img_width": {"node_id": "144", "path": ["inputs", "width"], "label": "宽度", "type": "number"},
            "img_height": {"node_id": "144", "path": ["inputs", "height"], "label": "高度", "type": "number"},
            "random_seed": {"node_id": "22", "path": "inputs.seed", "label": "随机种子", "type": "number"},
        },
    }

    dynamic_inputs = {
        "user_prompt": "cinematic photo of a fashion model, 8K, studio lighting, (masterpiece:1.2)",
        "img_width": "1024",
        "img_height": "1536",
        "random_seed": "4242424242",
    }

    runtime = inject_parameters(template, dynamic_inputs)

    # Assertions
    assert runtime["23"]["inputs"]["text"] == dynamic_inputs["user_prompt"], \
        f"CLIPTextEncode text not injected: {runtime['23']['inputs']['text'][:50]}"
    assert runtime["144"]["inputs"]["width"] == "1024", \
        f"Width not injected: {runtime['144']['inputs']['width']}"
    assert runtime["144"]["inputs"]["height"] == "1536", \
        f"Height not injected: {runtime['144']['inputs']['height']}"
    assert runtime["22"]["inputs"]["seed"] == "4242424242", \
        f"Seed not injected: {runtime['22']['inputs']['seed']}"
    assert runtime["158"]["inputs"]["filename_prefix"] == "ComfyUI", \
        "Unrelated fields should be preserved"
    assert runtime.get("exposed_mapping") is not None, \
        "exposed_mapping should be preserved"

    print("  PASS test_injector_comfy_dict")


# ── Test 3: Required variable missing → error ──

def test_injector_required_missing():
    """Required field missing should raise InjectionError."""
    from workflow_engine.injector import inject_parameters, InjectionError

    template = {
        "canvas_nodes": [{"id": "p1", "type": "prompt", "text": ""}],
        "exposed_mapping": {
            "must_have": {"node_id": "p1", "path": ["text"], "required": True, "label": "必填"},
        },
    }

    try:
        inject_parameters(template, {})
        assert False, "Should have raised InjectionError"
    except InjectionError as e:
        assert "must_have" in str(e), f"Error should mention variable name: {e}"

    print("  PASS test_injector_required_missing")


# ── Test 4: Deep nested path ──

def test_injector_deep_nested():
    """Deeply nested path injection."""
    from workflow_engine.injector import inject_parameters

    template = {
        "canvas_nodes": [
            {
                "id": "comfy_node",
                "type": "comfy",
                "workflow_config": {
                    "nodes": {
                        "ks": {"inputs": {"sampler": {"params": {"seed": 0, "steps": 20}}}}
                    }
                },
            },
        ],
        "exposed_mapping": {
            "ks_seed": {
                "node_id": "comfy_node",
                "path": ["workflow_config", "nodes", "ks", "inputs", "sampler", "params", "seed"],
                "label": "KS种子",
            },
        },
    }

    runtime = inject_parameters(template, {"ks_seed": "999888777"})
    seed = runtime["canvas_nodes"][0]["workflow_config"]["nodes"]["ks"]["inputs"]["sampler"]["params"]["seed"]
    assert seed == "999888777", f"Deep nested seed not injected: {seed}"

    print("  PASS test_injector_deep_nested")


# ── Test 5: get_exposed_fields ──

def test_get_exposed_fields():
    from workflow_engine.injector import get_exposed_fields

    template = {
        "exposed_mapping": {
            "prompt": {"node_id": "23", "path": "inputs.text", "label": "提示词", "type": "text", "required": True},
            "image": {"node_id": "img1", "path": ["url"], "label": "图片", "type": "image"},
            "lora": {"node_id": "l1", "path": ["weight"], "label": "Lora权重", "type": "number", "default": "0.8"},
            "style": {"node_id": "s1", "path": ["style"], "label": "风格", "type": "select", "options": ["写实", "动漫", "油画"]},
        },
    }

    fields = get_exposed_fields(template)
    assert len(fields) == 4

    # prompt
    assert fields[0]["name"] == "prompt"
    assert fields[0]["required"] is True
    # image
    assert fields[1]["type"] == "image"
    # number with default
    assert fields[2]["type"] == "number"
    assert fields[2]["default"] == "0.8"
    # select with options
    assert fields[3]["type"] == "select"
    assert len(fields[3]["options"]) == 3

    print("  PASS test_get_exposed_fields")


# ── Test 6: Stages — prepare registers prompt nodes ──

def test_stage_prepare_prompts():
    """stage_prepare should register prompt nodes with their text as output."""
    from workflow_engine.types import PipelineContext, PipelineProgress
    from workflow_engine.stages import stage_prepare

    ctx = PipelineContext(
        runtime_template={
            "canvas_nodes": [
                {"id": "img1", "type": "image", "url": "https://example.com/ref.jpg"},
                {"id": "p1", "type": "prompt", "text": "A beautiful sunset"},
                {"id": "p2", "type": "prompt", "text": ""},  # empty → not registered
            ],
        },
    )

    asyncio.run(stage_prepare(ctx))

    assert "img1" in ctx.node_outputs, "Image node should be registered"
    assert ctx.node_outputs["img1"].result == "https://example.com/ref.jpg"
    assert "p1" in ctx.node_outputs, "Prompt node should be registered"
    assert ctx.node_outputs["p1"].result == "A beautiful sunset"
    assert ctx.node_outputs["p1"].node_type == "prompt"
    assert "p2" not in ctx.node_outputs, "Empty prompt should NOT be registered"

    print("  PASS test_stage_prepare_prompts")


# ── Test 7: Stages — generate handles all generator types ──

def test_stage_generate_types():
    """stage_generate should find all generator-type nodes (generator, msgen, comfy, rh, video, ltxDirector)."""
    from workflow_engine.stages import GENERATOR_TYPES, stage_generate

    assert "generator" in GENERATOR_TYPES
    assert "msgen" in GENERATOR_TYPES
    assert "comfy" in GENERATOR_TYPES
    assert "rh" in GENERATOR_TYPES
    assert "video" in GENERATOR_TYPES
    assert "ltxDirector" in GENERATOR_TYPES

    print("  PASS test_stage_generate_types")


# ── Test 8: End-to-end executor with mock ──

def test_executor_e2e():
    """Full pipeline: inject + prepare + generate (mock) via executor."""
    from workflow_engine.injector import inject_parameters
    from workflow_engine.types import PipelineContext, WorkflowConfig, StageConfig
    from workflow_engine.stages import stage_prepare, stage_generate
    from workflow_engine.providers.base import BaseProvider, ProviderResult

    # ── Mock provider that returns success without real API calls ──
    class MockProvider(BaseProvider):
        async def generate(self, prompt="", ref_image_url=None, **kwargs):
            return ProviderResult(success=True, urls=[f"https://mock.cdn/output_{hash(prompt) & 0xFFFFFF:06x}.jpg"])
        async def analyze(self, image_url="", prompt=""):
            return f"Mock analysis of {image_url[:30]}"
        async def validate(self, image_url=""):
            return {"score": 0.95}

    # Replace real providers with mock
    import workflow_engine.providers as prov
    prov._yunwu = MockProvider()
    prov._grsai = MockProvider()
    prov._mimo = MockProvider()
    prov._llm = MockProvider()

    # ── Template with complex topology ──
    template = {
        "canvas_nodes": [
            {"id": "img_input", "type": "image", "url": ""},
            {"id": "prompt_node", "type": "prompt", "text": ""},
            {"id": "gen_main", "type": "generator", "apiProvider": "yunwu", "ratio": "portrait", "resolution": "2k"},
            {"id": "gen_comfy", "type": "comfy", "apiProvider": "auto", "ratio": "square"},
            {"id": "output_node", "type": "output"},
        ],
        "canvas_connections": [
            {"from": "img_input", "to": "gen_main"},
            {"from": "prompt_node", "to": "gen_main"},
            {"from": "img_input", "to": "gen_comfy"},
            {"from": "prompt_node", "to": "gen_comfy"},
            {"from": "gen_main", "to": "output_node"},
            {"from": "gen_comfy", "to": "output_node"},
        ],
        "exposed_mapping": {
            "product_image": {"node_id": "img_input", "path": ["url"], "label": "产品图", "type": "image", "required": True},
            "user_prompt": {"node_id": "prompt_node", "path": ["text"], "label": "提示词", "type": "text", "required": True},
        },
        "stages": [
            {"id": "prepare", "enabled": True},
            {"id": "generate", "enabled": True},
            {"id": "finalize", "enabled": True},
        ],
    }

    dynamic_inputs = {
        "product_image": "https://cdn.example.com/white_shirt.jpg",
        "user_prompt": "一件质感极佳的白衬衫，专业摄影棚灯光，高清商业摄影",
    }

    # ── Step 1: Inject ──
    runtime = inject_parameters(template, dynamic_inputs)
    assert runtime["canvas_nodes"][0]["url"] == dynamic_inputs["product_image"], \
        "Image URL not injected before execution"
    assert runtime["canvas_nodes"][1]["text"] == dynamic_inputs["user_prompt"], \
        "Prompt text not injected before execution"

    # ── Step 2: Build config & context ──
    config = WorkflowConfig(
        name="integration_test",
        description="E2E test workflow",
        stages=[
            StageConfig(id="prepare", enabled=True),
            StageConfig(id="generate", enabled=True),
            StageConfig(id="finalize", enabled=True),
        ],
        exposed_mapping=runtime.get("exposed_mapping", {}),
    )
    ctx = PipelineContext(
        runtime_template=runtime,
        dynamic_inputs=dynamic_inputs,
        generate_concurrency=2,
    )

    # ── Step 3: Run stages ──
    async def run_pipeline():
        await stage_prepare(ctx)
        await stage_generate(ctx)
        # Manually finalize (simpler than full stage_finalize)
        from workflow_engine.types import NodeOutput
        gen_results = []
        for nid, out in ctx.node_outputs.items():
            if out.node_type == "generator" and out.result:
                gen_results.extend(out.result if isinstance(out.result, list) else [out.result])
        ctx.node_outputs["__final__"] = NodeOutput(node_id="__final__", node_type="output", result=gen_results)

    asyncio.run(run_pipeline())

    # ── Step 4: Assertions ──
    # Image input registered
    assert "img_input" in ctx.node_outputs, "Image node should be registered"
    assert ctx.node_outputs["img_input"].result == dynamic_inputs["product_image"]

    # Prompt registered
    assert "prompt_node" in ctx.node_outputs, "Prompt node should be registered"
    assert ctx.node_outputs["prompt_node"].result == dynamic_inputs["user_prompt"]

    # Generator nodes should have outputs (mock provider returns success)
    assert "gen_main" in ctx.node_outputs, "Generator node should have output"
    assert ctx.node_outputs["gen_main"].result is not None, "Generator should produce results"
    assert len(ctx.node_outputs["gen_main"].result) > 0, "Generator should produce at least 1 URL"

    assert "gen_comfy" in ctx.node_outputs, "Comfy generator node should have output"
    assert ctx.node_outputs["gen_comfy"].result is not None, "Comfy generator should produce results"

    # Final results
    final = ctx.node_outputs.get("__final__")
    assert final is not None, "Should have final output"
    assert len(final.result) >= 2, f"Should have 2+ final results, got {len(final.result)}"

    print("  PASS test_executor_e2e")
    print(f"  → Generated {len(final.result)} images")
    for url in final.result:
        print(f"    {url}")


# ── Test 9: Injector — empty mapping is a no-op ──

def test_injector_empty_mapping():
    from workflow_engine.injector import inject_parameters

    template = {"canvas_nodes": [{"id": "n1", "type": "image", "url": "old.jpg"}]}
    runtime = inject_parameters(template, {"whatever": "ignored"})
    assert runtime["canvas_nodes"][0]["url"] == "old.jpg", "Should be unchanged"

    print("  PASS test_injector_empty_mapping")


# ── Runner ──

if __name__ == "__main__":
    print("=" * 60)
    print("Visual Forge — Engine Integration Tests")
    print("=" * 60)

    tests = [
        test_injector_vf_list,
        test_injector_comfy_dict,
        test_injector_required_missing,
        test_injector_deep_nested,
        test_get_exposed_fields,
        test_stage_prepare_prompts,
        test_stage_generate_types,
        test_executor_e2e,
        test_injector_empty_mapping,
    ]

    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"  FAIL {test.__name__}: {e}")
            import traceback
            traceback.print_exc()
            failed += 1

    print()
    print(f"Results: {passed} passed, {failed} failed, {len(tests)} total")
    if failed == 0:
        print("Integration Test Passed!")
    else:
        print("Some tests FAILED.")
        sys.exit(1)
