# Visual Forge — 电商 AI 生图工作台

一站式电商服装 AI 出图平台，集成无限画布工作流编辑、多引擎并发生图、LLM 多模态分析、批量处理。

## 功能模块

| 模块 | 说明 |
|------|------|
| **素材工坊** | 换装/换模特/白底图/角度迁移，上传即出图 |
| **无限画布** | 节点式工作流编辑器，拖拽连线搭建生图流程 |
| **工作流执行** | 一键选择预设模板，上传图片批量出图 |
| **角度迁移** | 商品图自动变换展示角度 |

## 技术架构

```
前端: React + TypeScript + Vite + Zustand
后端: Python FastAPI + uvicorn
画布: Vanilla JS (Infinite Canvas)
生成: 多引擎并发（GrsAI / Yunwu / ComfyUI / RunningHub / Comfly）
LLM: MiMo 多模态分析 + DeepSeek 提示词整合
```

## 快速启动

```bash
# 后端
cd server && python main.py    # :3000

# 前端
cd web && npm run dev           # :5174
```

## API Key 配置

编辑 `server/API/.env`，填入各平台 API Key：

```env
YUNWU_KEY_1=sk-xxx
GRSAI_KEY_1=sk-xxx
MIMO_API_KEY_1=sk-xxx
COMFLY_API_KEY=sk-xxx
RUNNINGHUB_API_KEY=xxx
```

## 预设工作流

| 工作流 | 流程 | 并发 |
|--------|------|------|
| 主图批量生成 | 商品图 → LLM分析 → 提示词 → 并发生图 → 校验 | 36路 |
| 姿势裂变批量生成 | 模板图 → 提示词 → 并发生图 | 5路 |
| 详情页批量生成 | 模板参考图 → 1:1生成 | 5路 |
| 快速生图 | 参考图 → 提示词 → 直接生图 | 1路 |
| 贯穿管道 | 主图 → 姿势 → 详情 全链路串联 | 36路 |
| 简易批量 | 跳过分析，直接并发生图 | 36路 |
| AI智能反推生图 | 商品图 → LLM多模态分析 → 自动提示词 → 生图 | 1路 |
| 单图快速生图 | 纯文本提示词 → 生图 | 1路 |

## License

Private — 内部使用
