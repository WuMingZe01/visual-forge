"""
Stage 1: Injector standalone tests with real ComfyUI API-format JSON.

Tests that inject_parameters correctly modifies deep-nested
ComfyUI workflow JSON given dynamic_inputs from the frontend.
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from workflow_engine.injector import (
    inject_parameters,
    get_exposed_fields,
    InjectionError,
    _normalize_path,
    _resolve_node_container,
    _build_node_index,
    _set_by_path,
)


# ═══════════════════════════════════════════════════════════════
# REAL ComfyUI workflow JSON (simplified "text-to-image")
# ═══════════════════════════════════════════════════════════════

REAL_COMFY_WORKFLOW = {
    "6": {
        "inputs": {"text": "", "clip": ["14", 1]},
        "class_type": "CLIPTextEncode",
    },
    "7": {
        "inputs": {"text": "", "clip": ["14", 1]},
        "class_type": "CLIPTextEncode",
    },
    "8": {
        "inputs": {"samples": ["13", 0], "vae": ["10", 0]},
        "class_type": "VAEDecode",
    },
    "9": {
        "inputs": {"filename_prefix": "ComfyUI", "images": ["8", 0]},
        "class_type": "SaveImage",
    },
    "10": {
        "inputs": {"vae_name": "ae.safetensors"},
        "class_type": "VAELoader",
    },
    "13": {
        "inputs": {
            "seed": 424242,
            "steps": 20,
            "cfg": 7.0,
            "sampler_name": "euler",
            "scheduler": "normal",
            "denoise": 1.0,
            "model": ["16", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["17", 0],
        },
        "class_type": "KSampler",
    },
    "14": {
        "inputs": {"clip_name1": "t5xxl_fp16.safetensors", "clip_name2": "clip_l.safetensors", "type": "flux"},
        "class_type": "DualCLIPLoader",
    },
    "16": {
        "inputs": {"unet_name": "flux1-dev.safetensors", "weight_dtype": "default"},
        "class_type": "UNETLoader",
    },
    "17": {
        "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
        "class_type": "EmptyLatentImage",
    },
    "exposed_mapping": {
        "positive_prompt": {
            "node_id": "6",
            "path": "inputs.text",
            "label": "正向提示词",
            "type": "text",
            "required": True,
        },
        "negative_prompt": {
            "node_id": "7",
            "path": "inputs.text",
            "label": "反向提示词",
            "type": "text",
            "default": "ugly, blurry, low quality",
        },
        "seed": {
            "node_id": "13",
            "path": "inputs.seed",
            "label": "随机种子",
            "type": "number",
        },
        "width": {
            "node_id": "17",
            "path": ["inputs", "width"],
            "label": "图片宽度",
            "type": "number",
        },
        "height": {
            "node_id": "17",
            "path": ["inputs", "height"],
            "label": "图片高度",
            "type": "number",
        },
        "steps": {
            "node_id": "13",
            "path": "inputs.steps",
            "label": "采样步数",
            "type": "number",
            "default": "20",
        },
    },
}


# ── Tests ──

def test_inject_positive_prompt():
    """正向提示词注入到 CLIPTextEncode 节点 #6"""
    runtime = inject_parameters(
        REAL_COMFY_WORKFLOW,
        {"positive_prompt": "cinematic photo of a cat wearing a spacesuit, 8K, (masterpiece:1.3)"},
    )
    actual = runtime["6"]["inputs"]["text"]
    assert "cat" in actual and "spacesuit" in actual, f"Wrong injection: {actual[:80]}"
    print("  [PASS] test_inject_positive_prompt")


def test_inject_seed_number():
    """种子注入到 KSampler 节点 #13"""
    runtime = inject_parameters(REAL_COMFY_WORKFLOW, {
        "positive_prompt": "dummy prompt for test",
        "seed": "999888777",
    })
    assert runtime["13"]["inputs"]["seed"] == "999888777", \
        f"Seed mismatch: {runtime['13']['inputs']['seed']}"
    print("  [PASS] test_inject_seed_number")


def test_inject_width_height():
    """宽高同时注入到 EmptyLatentImage 节点 #17"""
    runtime = inject_parameters(REAL_COMFY_WORKFLOW, {
        "positive_prompt": "dummy",
        "width": "768",
        "height": "1280",
    })
    assert runtime["17"]["inputs"]["width"] == "768"
    assert runtime["17"]["inputs"]["height"] == "1280"
    print("  [PASS] test_inject_width_height")


def test_default_value_fallback():
    """未提供值时使用 default"""
    runtime = inject_parameters(REAL_COMFY_WORKFLOW, {
        "positive_prompt": "a beautiful sunset",
        # negative_prompt NOT provided → should use default "ugly, blurry, low quality"
    })
    assert runtime["7"]["inputs"]["text"] == "ugly, blurry, low quality", \
        f"Default not applied: {runtime['7']['inputs']['text'][:50]}"
    print("  [PASS] test_default_value_fallback")


def test_required_missing_raises():
    """必填字段缺失 → InjectionError"""
    # Remove required:true to test the error path properly
    import copy
    tmpl = copy.deepcopy(REAL_COMFY_WORKFLOW)
    tmpl["exposed_mapping"]["positive_prompt"]["required"] = True
    tmpl["exposed_mapping"]["positive_prompt"]["default"] = None
    try:
        inject_parameters(tmpl, {})
        assert False, "Should have raised"
    except InjectionError as e:
        assert "positive_prompt" in str(e)
    print("  [PASS] test_required_missing_raises")


def test_node_not_found_warns():
    """引用不存在的节点 → 跳过并记录警告"""
    import copy
    tmpl = copy.deepcopy(REAL_COMFY_WORKFLOW)
    tmpl["exposed_mapping"]["ghost_node"] = {
        "node_id": "999",
        "path": "inputs.text",
        "label": "幽灵节点",
    }
    tmpl["exposed_mapping"]["positive_prompt"]["required"] = False
    runtime = inject_parameters(tmpl, {"positive_prompt": "dummy", "ghost_node": "should not crash"})
    assert "999" not in runtime, "Ghost node 999 should not appear"
    print("  [PASS] test_node_not_found_warns")


def test_preserve_unrelated_fields():
    """注入不应影响不相关节点"""
    runtime = inject_parameters(REAL_COMFY_WORKFLOW, {
        "positive_prompt": "test prompt",
        "seed": "111",
    })
    # VAELoader 节点 #10 应当完全不变
    assert runtime["10"]["inputs"]["vae_name"] == "ae.safetensors"
    # SaveImage 节点 #9 prefix 不变
    assert runtime["9"]["inputs"]["filename_prefix"] == "ComfyUI"
    # UNETLoader 节点 #16 不变
    assert runtime["16"]["inputs"]["unet_name"] == "flux1-dev.safetensors"
    print("  [PASS] test_preserve_unrelated_fields")


def test_exposed_mapping_preserved():
    """注入后 exposed_mapping 仍保留以供下游使用"""
    runtime = inject_parameters(REAL_COMFY_WORKFLOW, {"positive_prompt": "test"})
    assert "exposed_mapping" in runtime
    assert runtime["exposed_mapping"]["positive_prompt"]["label"] == "正向提示词"
    print("  [PASS] test_exposed_mapping_preserved")


def test_normalize_path_dot_notation():
    """路径字符串 'inputs.text' → 数组 ['inputs', 'text']"""
    assert _normalize_path("inputs.text") == ["inputs", "text"]
    assert _normalize_path("a.b.c.d.e") == ["a", "b", "c", "d", "e"]
    assert _normalize_path(["inputs", "text"]) == ["inputs", "text"]
    print("  [PASS] test_normalize_path_dot_notation")


def test_resolve_comfy_dict_style():
    """自动识别 ComfyUI dict 格式"""
    container, style = _resolve_node_container(REAL_COMFY_WORKFLOW)
    assert style == "comfy_dict", f"Expected comfy_dict, got {style}"
    print("  [PASS] test_resolve_comfy_dict_style")


def test_resolve_vf_list_style():
    """自动识别 VF list 格式"""
    vf_template = {
        "canvas_nodes": [
            {"id": "img1", "type": "image", "url": ""},
            {"id": "p1", "type": "prompt", "text": ""},
        ],
        "exposed_mapping": {
            "img": {"node_id": "img1", "path": ["url"], "label": "图片"},
        },
    }
    container, style = _resolve_node_container(vf_template)
    assert style == "vf_list", f"Expected vf_list, got {style}"
    print("  [PASS] test_resolve_vf_list_style")


def test_get_exposed_fields_all_types():
    """get_exposed_fields 覆盖所有字段类型"""
    fields = get_exposed_fields(REAL_COMFY_WORKFLOW)
    types = {f["type"] for f in fields}
    assert "text" in types
    assert "number" in types
    assert len(fields) == 6
    # 验证每个字段都有必填 key
    for f in fields:
        for k in ("name", "label", "type", "required", "default", "options", "placeholder"):
            assert k in f, f"Field {f.get('name')} missing key: {k}"
    print("  [PASS] test_get_exposed_fields_all_types")


def test_set_by_path_deep():
    """深层路径写入"""
    target = {}
    _set_by_path(target, ["a", "b", "c", "d"], "deep_value")
    assert target["a"]["b"]["c"]["d"] == "deep_value"
    print("  [PASS] test_set_by_path_deep")


# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import traceback

    tests = [
        test_inject_positive_prompt,
        test_inject_seed_number,
        test_inject_width_height,
        test_default_value_fallback,
        test_required_missing_raises,
        test_node_not_found_warns,
        test_preserve_unrelated_fields,
        test_exposed_mapping_preserved,
        test_normalize_path_dot_notation,
        test_resolve_comfy_dict_style,
        test_resolve_vf_list_style,
        test_get_exposed_fields_all_types,
        test_set_by_path_deep,
    ]

    print("=" * 60)
    print("Stage 1: Injector Unit Tests")
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

    print(f"\n{'=' * 60}")
    print(f"Results: {passed} passed, {failed} failed, {len(tests)} total")
    if failed == 0:
        print("Stage 1 PASS — Injector is ready.")
    else:
        print("Stage 1 FAILED.")
        sys.exit(1)
