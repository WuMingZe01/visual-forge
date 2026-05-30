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
        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "商品图输入"},
        {"id": "llm1",     "type": "llm",       "x": 400,  "y": 200, "prompt": "分析商品特征和风格", "model": "default", "w": 200, "h": 100},
        {"id": "prompt1",  "type": "prompt",    "x": 700,  "y": 200, "text": "根据分析结果生成主图提示词"},
        {"id": "gen1",     "type": "generator", "x": 1000, "y": 200, "apiProvider": "auto", "model": "", "ratio": "square", "resolution": "2k", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "output1",  "type": "output",    "x": 1300, "y": 200},
    ],
    "canvas_connections": [
        {"id": "c1", "from": "image1",  "to": "llm1"},
        {"id": "c2", "from": "llm1",    "to": "prompt1"},
        {"id": "c3", "from": "prompt1", "to": "gen1"},
        {"id": "c4", "from": "gen1",    "to": "output1"},
    ],
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
        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "姿势模板图"},
        {"id": "prompt1",  "type": "prompt",    "x": 400,  "y": 200, "text": "预定义姿势描述提示词"},
        {"id": "gen1",     "type": "generator", "x": 700,  "y": 200, "apiProvider": "auto", "model": "", "ratio": "portrait", "resolution": "2k", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "output1",  "type": "output",    "x": 1000, "y": 200},
    ],
    "canvas_connections": [
        {"id": "c1", "from": "image1",  "to": "prompt1"},
        {"id": "c2", "from": "prompt1", "to": "gen1"},
        {"id": "c3", "from": "gen1",    "to": "output1"},
    ],
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
        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "详情模板参考图"},
        {"id": "gen1",     "type": "generator", "x": 400,  "y": 200, "apiProvider": "auto", "model": "", "ratio": "portrait", "resolution": "2k", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "output1",  "type": "output",    "x": 700,  "y": 200},
    ],
    "canvas_connections": [
        {"id": "c1", "from": "image1", "to": "gen1"},
        {"id": "c2", "from": "gen1",   "to": "output1"},
    ],
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
        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "参考图"},
        {"id": "prompt1",  "type": "prompt",    "x": 400,  "y": 200, "text": "输入生图提示词"},
        {"id": "gen1",     "type": "generator", "x": 700,  "y": 200, "apiProvider": "auto", "model": "", "ratio": "square", "resolution": "2k", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "output1",  "type": "output",    "x": 1000, "y": 200},
    ],
    "canvas_connections": [
        {"id": "c1", "from": "image1",  "to": "prompt1"},
        {"id": "c2", "from": "prompt1", "to": "gen1"},
        {"id": "c3", "from": "gen1",    "to": "output1"},
    ],
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
        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "商品图输入"},
        {"id": "llm1",     "type": "llm",       "x": 400,  "y": 200, "prompt": "分析商品特征", "model": "default", "w": 200, "h": 100},
        {"id": "prompt1",  "type": "prompt",    "x": 700,  "y": 200, "text": "主图提示词"},
        {"id": "gen1",     "type": "generator", "x": 1000, "y": 100, "apiProvider": "auto", "model": "", "ratio": "square",   "resolution": "2k", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "gen2",     "type": "generator", "x": 1000, "y": 300, "apiProvider": "auto", "model": "", "ratio": "portrait", "resolution": "2k", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "gen3",     "type": "generator", "x": 1300, "y": 200, "apiProvider": "auto", "model": "", "ratio": "portrait", "resolution": "2k", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "output1",  "type": "output",    "x": 1600, "y": 200},
    ],
    "canvas_connections": [
        {"id": "c1", "from": "image1",  "to": "llm1"},
        {"id": "c2", "from": "llm1",    "to": "prompt1"},
        {"id": "c3", "from": "prompt1", "to": "gen1"},
        {"id": "c4", "from": "prompt1", "to": "gen2"},
        {"id": "c5", "from": "gen1",    "to": "gen3"},
        {"id": "c6", "from": "gen2",    "to": "gen3"},
        {"id": "c7", "from": "gen3",    "to": "output1"},
    ],
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
        {"id": "image1",   "type": "image",     "x": 100,  "y": 200, "name": "输入图片"},
        {"id": "gen1",     "type": "generator", "x": 400,  "y": 200, "apiProvider": "auto", "model": "", "ratio": "square", "resolution": "1k", "customRatio": "", "customSize": "", "inputs": []},
        {"id": "output1",  "type": "output",    "x": 700,  "y": 200},
    ],
    "canvas_connections": [
        {"id": "c1", "from": "image1", "to": "gen1"},
        {"id": "c2", "from": "gen1",   "to": "output1"},
    ],
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
