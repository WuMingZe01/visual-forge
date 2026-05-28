# Visual Forge 项目优化计划

> 基于2026-05-25需求梳理的系统优化方案

---

## 🎯 优化目标

打造一个**稳定、高效、易用**的电商AI生图工作台，核心原则：
- **保留核心功能**：两阶段LLM、双轨提示词、图片压缩
- **优化代码质量**：结构清晰、责任明确、易于维护
- **提升用户体验**：流程顺畅、交互友好、反馈及时

---

## 📁 一、技术架构优化

### 1.1 目录结构优化

```
web/src/
├── components/
│   ├── studio/          # 主图组件
│   ├── batch/           # 批量工单组件
│   ├── common/          # 通用组件
│   └── layout/          # 布局组件
├── pages/               # 页面组件
├── services/            # API服务
├── store/               # Zustand状态管理
├── hooks/               # 自定义Hooks（新增）
├── types/               # 类型定义
├── utils/               # 工具函数
└── constants/           # 常量配置（新增）
```

### 1.2 责任边界明确

| 模块 | 职责 |
|------|------|
| **Pages** | 路由入口，组合组件，处理页面级状态 |
| **Components** | 纯UI组件，只接收props渲染 |
| **Hooks** | 业务逻辑封装，可复用的状态和副作用 |
| **Services** | 纯API调用，无状态 |
| **Store** | 全局状态管理，持久化 |
| **Utils** | 纯函数工具 |

### 1.3 核心流程梳理

```
选款 (StyleManage)
  ↓
加载款式信息 (useTryOnStore)
  ↓
上传图片 → 压缩处理 (utils/image.ts)
  ↓
AI智能生成 (hooks/useAIPrompt.ts)
  ↓
生成图片 (services/tryonApi.ts)
  ↓
保存任务 (useTaskHistoryStore)
```

---

## 🔧 二、主图生成功能优化

### 2.1 保留的核心功能

- ✅ **两阶段LLM**：
  - Stage 1: Kimi K2.6 多模态 → 提取不变特征
  - Stage 2: DeepSeek V4 Flash → 生成中文方案

- ✅ **双轨提示词**：
  - 业务层：中文可编辑方案（概述+详细+负面）
  - API层：英文安全提示词（自动生成，不可直接编辑）

- ✅ **图片压缩**：
  - Canvas 2000px 长边
  - JPEG 92% 质量
  - 自动转base64

### 2.2 姿势裂变模式优化

```tsx
interface TemplateSlot {
  id: string;
  label: string;           // 如"正面站姿"
  image: ReferenceImage | null;
  prompt: string;
}
```

---

## 🎨 三、用户体验优化

### 3.1 款式管理 (StyleManage)
- [x] 批量导入款号
- [x] 领猫SCM集成
- [x] 本地款式库（localStorage）
- [x] 30+字段展示
- [x] 快速跳转主图

### 3.2 批量工单 (BatchGenerate)
- [x] Excel款号粘贴
- [x] 自动拉取产品参数
- [x] 逐行确认生成
- [x] 进度展示

### 3.3 设置页面 (Settings)
- [x] LLM配置（多模态+文本）
- [x] 生图引擎配置
- [x] 领猫SCM配置
- [x] 默认提示词设置

---

## 📦 四、功能扩展

### 4.1 详情页 (DetailCanvas)
- 独立运行，无需主图
- 9个预设模块
- 竖版拼接预览

### 4.2 通用生图 (GeneralStudio)
- 28种预设风格
- 自由提示词
- 参考图支持

### 4.3 任务历史 (TaskHistory)
- 全任务记录
- 批量下载
- 状态筛选

---

## 🔄 实施步骤

### Phase 1: 架构重构（优先级：高）
1. 创建hooks目录和自定义hooks
2. 提取通用工具函数
3. 重组组件目录结构
4. 清理冗余代码

### Phase 2: 主图优化（优先级：高）
1. 优化StudioTryOn代码结构
2. 改进姿势裂变模式
3. 增强错误处理

### Phase 3: UX优化（优先级：中）
1. 优化加载状态
2. 改进反馈机制
3. 简化设置页面

### Phase 4: 功能完善（优先级：中）
1. 增强批量工单
2. 优化详情页
3. 完善任务历史

---

## 📝 变更记录

| 日期 | 内容 |
|------|------|
| 2026-05-25 | 初始优化计划 |
