"""
画布节点类型 → 后端执行函数映射表
===============================

将无限画布上拖拽的节点类型映射到 backend workflow engine 的实际处理函数。
当画布保存为工作流模板时，每个 node.type 对应这里的一个 handler。

分类：
  asset_*    — 资产输入节点（图片/数据准备）
  process_*  — 处理节点（AI分析/提示词整合）
  gen_*      — 生成节点（生图引擎调用）
  eval_*     — 评估节点（质量校验）
  transform_*— 变换节点（视角裂变/水印/裁剪/格式转换）
  output_*   — 输出节点（结果汇总/推送/存储）
"""

from typing import Any, Callable, Coroutine, Dict, Optional

# 节点处理函数签名: async (ctx, config) -> Optional[Any]
NodeHandler = Callable[..., Coroutine[Any, Any, Optional[Any]]]


def _lazy_import_stage(name: str) -> NodeHandler:
    """延迟导入，避免循环依赖"""
    async def handler(ctx, config=None):
        from .stages import stageRegistry
        fn = stageRegistry.get(name)
        if fn:
            return await fn(ctx, config)
        raise ValueError(f"未知阶段: {name}")
    return handler


# ── 节点类型映射表 ──

NODE_TYPE_MAP: Dict[str, Dict[str, Any]] = {
    # ========== 资产输入节点 ==========
    "asset_product": {
        "label": "款式白底图",
        "icon": "📦",
        "stage": "prepare",
        "description": "输入商品白底图（正面/反面/细节）",
        "handler": _lazy_import_stage("prepare"),
    },
    "asset_model": {
        "label": "模特参考图",
        "icon": "🧍",
        "stage": "prepare",
        "description": "输入模特参考图（上装/下装/通用/配饰）",
        "handler": _lazy_import_stage("prepare"),
    },
    "asset_template": {
        "label": "模板参考图",
        "icon": "📋",
        "stage": "prepare",
        "description": "输入模板参考图（主图/姿势裂变/详情页）",
        "handler": _lazy_import_stage("prepare"),
    },
    "asset_detail": {
        "label": "细节参考图",
        "icon": "🔍",
        "stage": "prepare",
        "description": "输入细节参考图（面料/印花/辅料）",
        "handler": _lazy_import_stage("prepare"),
    },

    # ========== AI 处理节点 ==========
    "llm_analyze_model": {
        "label": "多模态识别（模特）",
        "icon": "👁",
        "stage": "analyze",
        "description": "MiMo 多模态提取模特不变特征",
        "handler": _lazy_import_stage("analyze"),
    },
    "llm_analyze_product": {
        "label": "多模态识别（商品）",
        "icon": "🔬",
        "stage": "analyze",
        "description": "MiMo 多模态提取商品视觉特征",
        "handler": _lazy_import_stage("analyze"),
    },
    "llm_assemble_prompt": {
        "label": "提示词整合",
        "icon": "🧩",
        "stage": "analyze",
        "description": "DeepSeek 整合不变量+商品资料+卡片描述，输出英文Prompt",
        "handler": _lazy_import_stage("analyze"),
    },

    # ========== 生图节点 ==========
    "image_generate": {
        "label": "生图引擎",
        "icon": "🎨",
        "stage": "generate",
        "description": "调用 Yunwu/Grsai 混合引擎生图",
        "handler": _lazy_import_stage("generate"),
    },

    # ========== 评估节点 ==========
    "mimo_validate": {
        "label": "MiMo 质量校验",
        "icon": "✅",
        "stage": "validate",
        "description": "多模态对比生图结果 vs 白底图，评分 1-10",
        "handler": _lazy_import_stage("validate"),
    },

    # ========== 变换节点 ==========
    "view_split": {
        "label": "视角裂变",
        "icon": "📐",
        "stage": "generate",
        "description": "从主图裂变正面/侧面/45度角等多视角",
        "handler": _lazy_import_stage("generate"),
        "config": {
            "angles": [
                {"name": "正面", "prompt": "front view, facing camera"},
                {"name": "侧面", "prompt": "side profile, 90 degree angle"},
                {"name": "45度角", "prompt": "three-quarter view, 45 degree angle"},
            ]
        },
    },
    "watermark": {
        "label": "添加水印",
        "icon": "💧",
        "stage": "generate",
        "description": "给生成的图片添加品牌水印",
        "handler": _lazy_import_stage("generate"),
    },
    "format_convert": {
        "label": "格式转换",
        "icon": "🔄",
        "stage": "generate",
        "description": "PNG→JPG/WebP 格式转换和质量压缩",
        "handler": _lazy_import_stage("generate"),
    },

    # ========== 输出节点 ==========
    "output_result": {
        "label": "结果输出",
        "icon": "📤",
        "stage": "finalize",
        "description": "汇总所有生成结果，返回给调用方",
        "handler": _lazy_import_stage("finalize"),
    },
    "output_oss_upload": {
        "label": "OSS 上传",
        "icon": "☁",
        "stage": "finalize",
        "description": "将生成图片上传到阿里云 OSS",
        "handler": _lazy_import_stage("finalize"),
    },
}


def get_node_label(node_type: str) -> str:
    """获取节点类型的显示标签"""
    return NODE_TYPE_MAP.get(node_type, {}).get("label", node_type)


def get_node_stage(node_type: str) -> str:
    """获取节点类型对应的执行阶段"""
    return NODE_TYPE_MAP.get(node_type, {}).get("stage", "unknown")


def get_node_handler(node_type: str) -> Optional[NodeHandler]:
    """获取节点类型对应的处理函数"""
    entry = NODE_TYPE_MAP.get(node_type)
    return entry["handler"] if entry else None


def list_node_types() -> list[dict]:
    """列出所有可用节点类型（供前端画布使用）"""
    return [
        {
            "type": ntype,
            "label": info["label"],
            "icon": info["icon"],
            "stage": info["stage"],
            "description": info["description"],
        }
        for ntype, info in NODE_TYPE_MAP.items()
    ]
