"""
============================================
生图工作流配置文件
============================================

可用的阶段 ID
--------------
- prepare   : 图片/数据准备、密钥池同步、并发计算
- analyze   : LLM 多模态反推（模特特征 + 风格特征）→ 提示词整合
- generate  : 并发生图（Grsai + Yunwu 混合引擎负载均衡）
- validate  : Mimo 多模态生成结果校验
- finalize  : 任务状态输出

配置示例:

    # 如果不想用 LLM 反推，直接生图：
    stages=[
        {"id": "prepare",  "enabled": True},
        {"id": "analyze",  "enabled": False},   # 关掉
        {"id": "generate", "enabled": True},
        {"id": "validate", "enabled": False},   # 关掉
        {"id": "finalize", "enabled": True},
    ]

自定义参数
----------
config 字段可以给阶段传递参数，各阶段支持的参数：
- analyze:  {"useModelAnalysis": bool, "useProductAnalysis": bool}
- validate: {"timeoutMs": int}
- generate: (使用 WorkflowOptions 中的全局配置)

暴露参数 (exposed_mapping)
--------------------------
每个工作流可通过 exposed_mapping 暴露可注入的参数，
前端根据此字段自动生成表单，后端通过 injector.py 注入。
"""


# ===== 主图批量生成工作流 =====

MAIN_BATCH_WORKFLOW: dict = {
    "name": "主图批量生成",
    "description": "完整批量生图流程：准备 → LLM多模态反推 → 提示词整合 → 混合引擎并发生图 → Mimo校验 → 任务输出",
    "stages": [
        {"id": "prepare",  "enabled": True},
        {"id": "analyze",  "enabled": True,  "config": {"useModelAnalysis": True, "useProductAnalysis": True}},
        {"id": "generate", "enabled": True},
        {"id": "validate", "enabled": True},
        {"id": "finalize", "enabled": True},
    ],
    "options": {
        "generateConcurrency": 36,
        "generateTimeoutMs": 480_000,
        "validateTimeoutMs": 30_000,
        "llmMaxConcurrency": 3,
    },
    "canvas_nodes": [
        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "商品图输入", "url": "{{product_image}}"},
        {"id": "llm1",     "type": "llm",       "x": 400,  "y": 200, "prompt": "分析商品特征和风格", "model": "default", "w": 200, "h": 100},
        {"id": "prompt1",  "type": "prompt",    "x": 700,  "y": 200, "text": "{{user_prompt}}"},
        {"id": "gen1",     "type": "generator", "x": 1000, "y": 200, "apiProvider": "{{api_provider}}", "model": "{{model_id}}", "ratio": "{{aspect_ratio}}", "resolution": "{{resolution}}", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "output1",  "type": "output",    "x": 1300, "y": 200},
    ],
    "canvas_connections": [
        {"id": "c1", "from": "image1",  "to": "llm1"},
        {"id": "c2", "from": "llm1",    "to": "prompt1"},
        {"id": "c3", "from": "prompt1", "to": "gen1"},
        {"id": "c4", "from": "image1",  "to": "gen1"},
        {"id": "c5", "from": "gen1",    "to": "output1"},
    ],
    "exposed_mapping": {
        "product_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "商品图",
            "type": "image",
            "required": True,
        },
        "user_prompt": {
            "node_id": "prompt1",
            "path": ["text"],
            "label": "提示词",
            "type": "text",
            "required": False,
            "default": "专业商品摄影，白色背景，工作室灯光，高清8K",
        },
        "api_provider": {
            "node_id": "gen1",
            "path": ["apiProvider"],
            "label": "生图引擎",
            "type": "select",
            "options": ["auto", "grsai", "yunwu"],
            "required": False,
            "default": "auto",
        },
        "model_id": {
            "node_id": "gen1",
            "path": ["model"],
            "label": "AI模型",
            "type": "select",
            "options": ["gpt-image-2", "gpt-image-2-vip", "gpt-image-1-mini", "gpt-image-2-all"],
            "required": False,
            "default": "gpt-image-2",
        },
        "aspect_ratio": {
            "node_id": "gen1",
            "path": ["ratio"],
            "label": "出图比例",
            "type": "select",
            "options": ["1:1 (淘宝主图)", "3:4 (小红书)", "9:16 (手机)", "4:3 (PC端)", "16:9 (宽屏)"],
            "required": False,
            "default": "1:1 (淘宝主图)",
        },
        "resolution": {
            "node_id": "gen1",
            "path": ["resolution"],
            "label": "画质/尺寸",
            "type": "select",
            "options": ["1K (1024px·快速)", "2K (2048px·推荐)", "4K (4096px·高清)"],
            "required": False,
            "default": "2K (2048px·推荐)",
        },
    },
}


# ===== 姿势裂变批量生成工作流 =====

POSE_BATCH_WORKFLOW: dict = {
    "name": "姿势裂变批量生成",
    "description": "姿势裂变：跳过LLM分析，直接用模板参考图和预定义姿势提示词批量生图",
    "stages": [
        {"id": "prepare",  "enabled": True},
        {"id": "analyze",  "enabled": False},
        {"id": "generate", "enabled": True},
        {"id": "validate", "enabled": False},
        {"id": "finalize", "enabled": True},
    ],
    "options": {
        "generateConcurrency": 36,
        "generateTimeoutMs": 480_000,
        "validateTimeoutMs": 30_000,
        "llmMaxConcurrency": 3,
    },
    "canvas_nodes": [
        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "姿势模板图", "url": "{{template_image}}"},
        {"id": "prompt1",  "type": "prompt",    "x": 400,  "y": 200, "text": "{{pose_prompt}}"},
        {"id": "gen1",     "type": "generator", "x": 700,  "y": 200, "apiProvider": "{{api_provider}}", "model": "{{model_id}}", "ratio": "{{aspect_ratio}}", "resolution": "{{resolution}}", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "output1",  "type": "output",    "x": 1000, "y": 200},
    ],
    "canvas_connections": [
        {"id": "c1", "from": "image1",  "to": "prompt1"},
        {"id": "c2", "from": "prompt1", "to": "gen1"},
        {"id": "c3", "from": "image1",  "to": "gen1"},
        {"id": "c4", "from": "gen1",    "to": "output1"},
    ],
    "exposed_mapping": {
        "template_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "姿势模板图",
            "type": "image",
            "required": True,
        },
        "pose_prompt": {
            "node_id": "prompt1",
            "path": ["text"],
            "label": "姿势提示词",
            "type": "text",
            "required": False,
            "default": "模特姿势描述",
        },
        "api_provider": {
            "node_id": "gen1",
            "path": ["apiProvider"],
            "label": "生图引擎",
            "type": "select",
            "options": ["auto", "grsai", "yunwu"],
            "required": False,
            "default": "auto",
        },
        "model_id": {
            "node_id": "gen1",
            "path": ["model"],
            "label": "AI模型",
            "type": "select",
            "options": ["gpt-image-2", "gpt-image-2-vip", "gpt-image-1-mini", "gpt-image-2-all"],
            "required": False,
            "default": "gpt-image-2",
        },
        "aspect_ratio": {
            "node_id": "gen1",
            "path": ["ratio"],
            "label": "出图比例",
            "type": "select",
            "options": ["1:1 (淘宝主图)", "3:4 (小红书)", "9:16 (手机)", "4:3 (PC端)", "16:9 (宽屏)"],
            "required": False,
            "default": "3:4 (小红书)",
        },
        "resolution": {
            "node_id": "gen1",
            "path": ["resolution"],
            "label": "画质/尺寸",
            "type": "select",
            "options": ["1K (1024px·快速)", "2K (2048px·推荐)", "4K (4096px·高清)"],
            "required": False,
            "default": "2K (2048px·推荐)",
        },
    },
}


# ===== 详情页批量生成工作流 =====

DETAIL_BATCH_WORKFLOW: dict = {
    "name": "详情页批量生成",
    "description": "详情页模块生图：跳过LLM分析，按详情模板参考图1:1生成详情模块",
    "stages": [
        {"id": "prepare",  "enabled": True},
        {"id": "analyze",  "enabled": False},
        {"id": "generate", "enabled": True},
        {"id": "validate", "enabled": False},
        {"id": "finalize", "enabled": True},
    ],
    "options": {
        "generateConcurrency": 36,
        "generateTimeoutMs": 480_000,
        "validateTimeoutMs": 30_000,
        "llmMaxConcurrency": 3,
    },
    "canvas_nodes": [
        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "详情模板参考图", "url": "{{detail_image}}"},
        {"id": "prompt1",  "type": "prompt",    "x": 300,  "y": 200, "text": "{{user_prompt}}"},
        {"id": "gen1",     "type": "generator", "x": 500,  "y": 200, "apiProvider": "{{api_provider}}", "model": "{{model_id}}", "ratio": "{{aspect_ratio}}", "resolution": "{{resolution}}", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "output1",  "type": "output",    "x": 800,  "y": 200},
    ],
    "canvas_connections": [
        {"id": "c1", "from": "image1", "to": "prompt1"},
        {"id": "c2", "from": "prompt1", "to": "gen1"},
        {"id": "c3", "from": "image1", "to": "gen1"},
        {"id": "c4", "from": "gen1",   "to": "output1"},
    ],
    "exposed_mapping": {
        "detail_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "详情模板图",
            "type": "image",
            "required": True,
        },
        "user_prompt": {
            "node_id": "prompt1",
            "path": ["text"],
            "label": "提示词",
            "type": "text",
            "required": False,
            "default": "详情页模块图，高清",
        },
        "api_provider": {
            "node_id": "gen1",
            "path": ["apiProvider"],
            "label": "生图引擎",
            "type": "select",
            "options": ["auto", "grsai", "yunwu"],
            "required": False,
            "default": "auto",
        },
        "model_id": {
            "node_id": "gen1",
            "path": ["model"],
            "label": "AI模型",
            "type": "select",
            "options": ["gpt-image-2", "gpt-image-2-vip", "gpt-image-1-mini", "gpt-image-2-all"],
            "required": False,
            "default": "gpt-image-2",
        },
        "aspect_ratio": {
            "node_id": "gen1",
            "path": ["ratio"],
            "label": "出图比例",
            "type": "select",
            "options": ["1:1 (淘宝主图)", "3:4 (小红书)", "9:16 (手机)", "4:3 (PC端)", "16:9 (宽屏)"],
            "required": False,
            "default": "3:4 (小红书)",
        },
        "resolution": {
            "node_id": "gen1",
            "path": ["resolution"],
            "label": "画质/尺寸",
            "type": "select",
            "options": ["1K (1024px·快速)", "2K (2048px·推荐)", "4K (4096px·高清)"],
            "required": False,
            "default": "2K (2048px·推荐)",
        },
    },
}


# ===== 快速生图工作流（单张） =====

QUICK_GENERATE_WORKFLOW: dict = {
    "name": "快速生图",
    "description": "单张快速生图：跳过反推和校验，直接生成",
    "stages": [
        {"id": "prepare",  "enabled": True},
        {"id": "analyze",  "enabled": False},
        {"id": "generate", "enabled": True},
        {"id": "validate", "enabled": False},
        {"id": "finalize", "enabled": True},
    ],
    "options": {
        "generateConcurrency": 1,
        "generateTimeoutMs": 120_000,
        "validateTimeoutMs": 30_000,
        "llmMaxConcurrency": 1,
    },
    "canvas_nodes": [
        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "参考图", "url": "{{ref_image}}"},
        {"id": "prompt1",  "type": "prompt",    "x": 400,  "y": 200, "text": "{{user_prompt}}"},
        {"id": "gen1",     "type": "generator", "x": 700,  "y": 200, "apiProvider": "{{api_provider}}", "model": "{{model_id}}", "ratio": "{{aspect_ratio}}", "resolution": "{{resolution}}", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "output1",  "type": "output",    "x": 1000, "y": 200},
    ],
    "canvas_connections": [
        {"id": "c1", "from": "image1",  "to": "prompt1"},
        {"id": "c2", "from": "prompt1", "to": "gen1"},
        {"id": "c3", "from": "image1",  "to": "gen1"},
        {"id": "c4", "from": "gen1",    "to": "output1"},
    ],
    "exposed_mapping": {
        "ref_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "参考图",
            "type": "image",
            "required": False,
            "default": "",
        },
        "user_prompt": {
            "node_id": "prompt1",
            "path": ["text"],
            "label": "提示词",
            "type": "text",
            "required": True,
            "default": "专业商品摄影，高清8K",
        },
        "api_provider": {
            "node_id": "gen1",
            "path": ["apiProvider"],
            "label": "生图引擎",
            "type": "select",
            "options": ["auto", "grsai", "yunwu"],
            "required": False,
            "default": "auto",
        },
        "model_id": {
            "node_id": "gen1",
            "path": ["model"],
            "label": "AI模型",
            "type": "select",
            "options": ["gpt-image-2", "gpt-image-2-vip", "gpt-image-1-mini", "gpt-image-2-all"],
            "required": False,
            "default": "gpt-image-2",
        },
        "aspect_ratio": {
            "node_id": "gen1",
            "path": ["ratio"],
            "label": "出图比例",
            "type": "select",
            "options": ["1:1 (淘宝主图)", "3:4 (小红书)", "9:16 (手机)", "4:3 (PC端)", "16:9 (宽屏)"],
            "required": False,
            "default": "1:1 (淘宝主图)",
        },
        "resolution": {
            "node_id": "gen1",
            "path": ["resolution"],
            "label": "画质/尺寸",
            "type": "select",
            "options": ["1K (1024px·快速)", "2K (2048px·推荐)", "4K (4096px·高清)"],
            "required": False,
            "default": "2K (2048px·推荐)",
        },
    },
}


# ===== 贯穿管道工作流 =====

PIPELINE_FULL_WORKFLOW: dict = {
    "name": "贯穿管道（主图→姿势→详情）",
    "description": "全自动串联：先跑主图批量 → 再跑姿势裂变 → 最后详情页生成",
    "stages": [
        {"id": "prepare",  "enabled": True},
        {"id": "analyze",  "enabled": True,  "config": {"useModelAnalysis": True, "useProductAnalysis": True}},
        {"id": "generate", "enabled": True},
        {"id": "validate", "enabled": True},
        {"id": "finalize", "enabled": True},
    ],
    "options": {
        "generateConcurrency": 36,
        "generateTimeoutMs": 480_000,
        "validateTimeoutMs": 30_000,
        "llmMaxConcurrency": 3,
    },
    "canvas_nodes": [
        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "商品图输入", "url": "{{product_image}}"},
        {"id": "llm1",     "type": "llm",       "x": 400,  "y": 200, "prompt": "分析商品特征", "model": "default", "w": 200, "h": 100},
        {"id": "prompt1",  "type": "prompt",    "x": 700,  "y": 200, "text": "{{user_prompt}}"},
        {"id": "gen1",     "type": "generator", "x": 1000, "y": 100, "apiProvider": "{{api_provider}}", "model": "{{model_id}}", "ratio": "{{aspect_ratio}}",   "resolution": "{{resolution}}", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "gen2",     "type": "generator", "x": 1000, "y": 300, "apiProvider": "{{api_provider}}", "model": "{{model_id}}", "ratio": "3:4 (小红书)", "resolution": "{{resolution}}", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "gen3",     "type": "generator", "x": 1300, "y": 200, "apiProvider": "{{api_provider}}", "model": "{{model_id}}", "ratio": "3:4 (小红书)", "resolution": "{{resolution}}", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "output1",  "type": "output",    "x": 1600, "y": 200},
    ],
    "canvas_connections": [
        {"id": "c1", "from": "image1",  "to": "llm1"},
        {"id": "c2", "from": "llm1",    "to": "prompt1"},
        {"id": "c5", "from": "image1",  "to": "gen1"},
        {"id": "c6", "from": "image1",  "to": "gen2"},
        {"id": "c7", "from": "gen1",    "to": "gen3"},
        {"id": "c8", "from": "gen2",    "to": "gen3"},
        {"id": "c9", "from": "gen3",    "to": "output1"},
    ],
    "exposed_mapping": {
        "product_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "商品图",
            "type": "image",
            "required": True,
        },
        "user_prompt": {
            "node_id": "prompt1",
            "path": ["text"],
            "label": "提示词",
            "type": "text",
            "required": False,
            "default": "专业商品摄影，白色背景，工作室灯光，高清8K",
        },
        "api_provider": {
            "node_id": "gen1",
            "path": ["apiProvider"],
            "label": "生图引擎",
            "type": "select",
            "options": ["auto", "grsai", "yunwu"],
            "required": False,
            "default": "auto",
        },
        "model_id": {
            "node_id": "gen1",
            "path": ["model"],
            "label": "AI模型",
            "type": "select",
            "options": ["gpt-image-2", "gpt-image-2-vip", "gpt-image-1-mini", "gpt-image-2-all"],
            "required": False,
            "default": "gpt-image-2",
        },
        "aspect_ratio": {
            "node_id": "gen1",
            "path": ["ratio"],
            "label": "出图比例",
            "type": "select",
            "options": ["1:1 (淘宝主图)", "3:4 (小红书)", "9:16 (手机)", "4:3 (PC端)", "16:9 (宽屏)"],
            "required": False,
            "default": "1:1 (淘宝主图)",
        },
        "resolution": {
            "node_id": "gen1",
            "path": ["resolution"],
            "label": "画质/尺寸",
            "type": "select",
            "options": ["1K (1024px·快速)", "2K (2048px·推荐)", "4K (4096px·高清)"],
            "required": False,
            "default": "2K (2048px·推荐)",
        },
    },
}


# ===== 简易工作流（无LLM反推，无校验） =====

SIMPLE_BATCH_WORKFLOW: dict = {
    "name": "简易批量生成",
    "description": "最简流程：仅准备 + 并发生图，适合已写好提示词的场景",
    "stages": [
        {"id": "prepare",  "enabled": True},
        {"id": "analyze",  "enabled": False},
        {"id": "generate", "enabled": True},
        {"id": "validate", "enabled": False},
        {"id": "finalize", "enabled": True},
    ],
    "options": {
        "generateConcurrency": 36,
        "generateTimeoutMs": 480_000,
        "validateTimeoutMs": 0,
        "llmMaxConcurrency": 0,
    },
    "canvas_nodes": [
        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "输入图片", "url": "{{ref_image}}"},
        {"id": "prompt1",  "type": "prompt",    "x": 350,  "y": 200, "text": "{{user_prompt}}"},
        {"id": "gen1",     "type": "generator", "x": 600,  "y": 200, "apiProvider": "{{api_provider}}", "model": "{{model_id}}", "ratio": "{{aspect_ratio}}", "resolution": "{{resolution}}", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "output1",  "type": "output",    "x": 900,  "y": 200},
    ],
    "canvas_connections": [
        {"id": "c1", "from": "image1",  "to": "prompt1"},
        {"id": "c2", "from": "prompt1", "to": "gen1"},
        {"id": "c3", "from": "image1",  "to": "gen1"},
        {"id": "c4", "from": "gen1",    "to": "output1"},
    ],
    "exposed_mapping": {
        "ref_image": {
            "node_id": "image1",
            "path": ["url"],
            "label": "输入图片",
            "type": "image",
            "required": True,
        },
        "user_prompt": {
            "node_id": "prompt1",
            "path": ["text"],
            "label": "提示词",
            "type": "text",
            "required": False,
            "default": "专业商品摄影，白色背景，工作室灯光，高清8K",
        },
        "api_provider": {
            "node_id": "gen1",
            "path": ["apiProvider"],
            "label": "生图引擎",
            "type": "select",
            "options": ["auto", "grsai", "yunwu"],
            "required": False,
            "default": "auto",
        },
        "model_id": {
            "node_id": "gen1",
            "path": ["model"],
            "label": "AI模型",
            "type": "select",
            "options": ["gpt-image-2", "gpt-image-2-vip", "gpt-image-1-mini", "gpt-image-2-all"],
            "required": False,
            "default": "gpt-image-2",
        },
        "aspect_ratio": {
            "node_id": "gen1",
            "path": ["ratio"],
            "label": "出图比例",
            "type": "select",
            "options": ["1:1 (淘宝主图)", "3:4 (小红书)", "9:16 (手机)", "4:3 (PC端)", "16:9 (宽屏)"],
            "required": False,
            "default": "1:1 (淘宝主图)",
        },
        "resolution": {
            "node_id": "gen1",
            "path": ["resolution"],
            "label": "画质/尺寸",
            "type": "select",
            "options": ["1K (1024px·快速)", "2K (2048px·推荐)", "4K (4096px·高清)"],
            "required": False,
            "default": "1K (1024px·快速)",
        },
    },
}


# 按名称索引的预设表，方便运行时按名称查找工作流
WORKFLOW_PRESETS: dict[str, dict] = {
    presets["name"]: presets  # type: ignore[has-type]
    for presets in [
        MAIN_BATCH_WORKFLOW,
        POSE_BATCH_WORKFLOW,
        DETAIL_BATCH_WORKFLOW,
        QUICK_GENERATE_WORKFLOW,
        PIPELINE_FULL_WORKFLOW,
        SIMPLE_BATCH_WORKFLOW,
    ]
}
