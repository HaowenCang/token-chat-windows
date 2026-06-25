# 架构优化修复计划

> 当前版本: v0.9.15 | 编写日期: 2026-06-25

已完成的安全与参数修复：API Key → Credential Manager、CSP 启用、API 重试、hardcoded temperature/maxTokens、废弃 CSS 清理、冗余报告文件清理。

以下三项是剩余的架构优化，按优先级排列。

---

## 第一阶段：拆分 chat.ts（预计 1-2 天）

### 问题

`chat.ts` 共 1210 行，混合了 5 类职责：

| 职责 | 函数/变量 | 行数约 |
|------|----------|--------|
| 发送流程 | `handleSend`, sendSequence, cancelledSendIds, sendPreparationInProgress | 280 行 |
| 消息渲染 | `renderChatMessages`, `renderMessage`, `renderMessageSearchMetadata`, markdown/搜索元数据 | 150 行 |
| 文件附件 | selectedAttachments, `addAttachmentFiles`, `fileToAttachment`, `renderAttachmentDrafts`, `buildApiContent` | 150 行 |
| 流式监听 | `setupStreamListeners`, `cleanupStreamListeners`, `updateStreamingMessage`, streamUnlisten | 80 行 |
| 对话 CRUD + 事件绑定 | `loadConversations`, `selectConversation`, `createConversation`, `deleteConversation`, `bindChatEvents` 等 | 350 行 |

模块级可变单例变量（`sendSequence`, `activeSendId`, `cancelledSendIds`, `sendPreparationInProgress`, `webSearchPhase`, `selectedAttachments`）散布在文件顶部，任意函数都能读写，是重入 bug 的根源。

### 目标

将 `chat.ts` 拆分为 5 个文件，每个文件职责单一、可独立理解。不改变任何运行时行为。

### 拆分方案

```
chat.ts (入口，~100行)
├── chat-attachment.ts    — 附件选择/预览/序列化 (~150行)
├── chat-render.ts        — 消息列表/输入区/对话列表的 HTML 生成 (~200行)
├── chat-stream.ts        — SSE 监听器 setup/teardown + 流式 DOM 更新 (~100行)
├── chat-send.ts          — handleSend + 发送状态管理 (~300行)
└── chat-conversation.ts  — 对话 CRUD + 列表事件绑定 (~250行)
```

#### chat.ts（入口，保留原文件名）
- 导出入口函数 `initChat()`，供 main.ts 调用
- 重新导出 main.ts 需要的公开 API（`loadConversations`, `selectConversation`, `renderConversationList` 等）
- 不包含任何业务逻辑

#### chat-attachment.ts
搬入：
- 类型定义 `MessageAttachment`（第 87-97 行）
- 状态变量 `selectedAttachments`, `selectionCopyFallbackBound`（第 98-99 行）
- 函数：`isTextLike`, `readFileAsDataUrl`, `fileToAttachment`, `addAttachmentFiles`（第 139-188 行）
- 函数：`renderAttachmentDrafts`, `renderMessageAttachments`（第 189-218 行）
- 函数：`buildTextWithAttachments`, `buildApiContent`, `titleFromContent`, `isDefaultConversationTitle`（第 219-266 行）
- 函数：`formatFileSize`（第 123-127 行）

导出：`selectedAttachments`, `addAttachmentFiles`, `renderAttachmentDrafts`, `renderMessageAttachments`, `buildTextWithAttachments`, `buildApiContent`, `titleFromContent`, `isDefaultConversationTitle`, `formatFileSize`, `parseAttachments`

#### chat-render.ts
搬入：
- 函数：`renderConversationList`（第 270-293 行）
- 函数：`renderChatMessages`, `renderMessage`, `renderMessageSearchMetadata`（第 296-393 行）
- 函数：`sourceHost`, `getMessageCopyText`, `copyText`, `bindSelectionCopyFallback`（第 394-441 行）
- 函数：`renderChatInput`（第 444-475 行）
- 函数：`renderChatArea`, `renderConversationListInDom`, `renderChatInputInDom`, `rerenderChatInputPreservingDraft`, `renderRightPanelInDom`（第 984-1041 行）
- 函数：`scrollToBottom`, `autoResizeTextarea`（第 968-980 行）
- 工具函数：`escHtml`（第 110 行）

导出：`renderConversationList`, `renderChatMessages`, `renderChatInput`, `renderChatArea`, `renderConversationListInDom`, `renderChatInputInDom`, `renderRightPanelInDom`

#### chat-stream.ts
搬入：
- 状态变量：`streamUnlisten`, `metricsUnlisten`（第 41-42 行）
- 函数：`setupStreamListeners`（第 894-925 行）
- 函数：`cleanupStreamListeners`（第 926-929 行）
- 函数：`updateStreamingMessage`（第 931-967 行）

导出：`setupStreamListeners`, `cleanupStreamListeners`, `updateStreamingMessage`

#### chat-send.ts
搬入：
- 状态变量：`sendSequence`, `activeSendId`, `cancelledSendIds`, `sendPreparationInProgress`, `webSearchPhase`, `webSearchStatusText`（第 100-109 行）
- 函数：`isChatWebSearchEnabled`, `setWebSearchPhase`（第 114-127 行）
- 函数：`handleSend`（第 612-893 行）
- 函数：`bindChatInputEvents`（第 1103-1209 行）

导出：`handleSend`, `bindChatInputEvents`

#### chat-conversation.ts
搬入：
- Mock 数据（第 45-83 行，仅 dev 模式）
- 函数：`loadConversations`, `selectConversation`, `createConversation`（第 478-542 行）
- 函数：`deleteConversation`, `updateConversationTitleLocal`, `maybeAutoGenerateConversationTitle`, `renameCurrentConversation`（第 543-609 行）
- 函数：`bindConversationListEvents`, `bindMessageEvents`, `bindChatEvents`（第 1044-1210 行）

导出：`loadConversations`, `selectConversation`, `createConversation`, `bindChatEvents`, `bindConversationListEvents`

### 依赖关系

```
chat.ts
  ├── chat-conversation.ts → state, i18n, glass-dialog, chat-render, chat-send
  ├── chat-send.ts → state, i18n, web-search, chat-attachment, chat-stream, chat-render, chat-token
  ├── chat-stream.ts → state, chat-token, chat-render (updateStreamingMessage)
  ├── chat-render.ts → state, i18n, chat-markdown, chat-attachment, chat-token
  └── chat-attachment.ts → state (纯工具，无循环依赖)
```

无循环依赖：attachment 是叶子模块，stream 依赖 render，send 依赖所有下层。

### 执行步骤

1. 创建 `chat-attachment.ts`，搬入附件相关代码（叶子模块，无依赖）
2. 创建 `chat-render.ts`，搬入渲染函数
3. 创建 `chat-stream.ts`，搬入流式监听
4. 创建 `chat-send.ts`，搬入发送流程
5. 创建 `chat-conversation.ts`，搬入对话 CRUD 和事件绑定
6. 改造 `chat.ts` 为入口文件，re-export 公开 API
7. 每步执行 `npm run build` 验证编译通过
8. 最终 `npm run tauri build` 全量验证

### 风险控制

- **零功能变更**：只搬代码，不改逻辑
- **逐步验证**：每搬一个文件就编译一次
- **re-export 兼容**：main.ts 的 import 路径不变（`from './chat'`）

---

## 第二阶段：引入 Preact 框架（预计 1-2 周）

### 问题

当前 innerHTML 全量重渲染导致：
- 每次 `render()` 重建整个页面 DOM，事件监听器全部重绑定
- 流式输出时必须绕过 `render()` 做增量 DOM 更新（`updateStreamingMessage`）
- 焦点丢失、滚动跳位、输入区闪烁
- 两套渲染路径并存（全量 render + 增量 patch），维护成本高

### 目标

用 Preact 替换 innerHTML，实现声明式 UI + 虚拟 DOM diff，统一渲染路径。

### 为什么选 Preact

| 候选 | 体积 (gzip) | 迁移成本 | 生态 |
|------|-------------|---------|------|
| **Preact** | **4 KB** | 低（兼容 React JSX） | 完整（hooks, signals, preact/compat） |
| Solid.js | 7 KB | 中（不同范式） | 较小 |
| Lit | 16 KB | 中（Web Components） | 较小 |
| Vue | 33 KB | 高 | 大 |

Preact 体积最小，API 与 React 兼容（团队熟悉度高），`preact/compat` 可渐进迁移。

### 迁移策略：渐进式，由内向外

不一次性重写。按组件树从叶子到根逐步迁移：

```
阶段 2a: 基础设施 (2-3天)
  ├── 安装 preact + @preact/signals
  ├── 配置 Vite JSX transform (preact)
  └── 创建 Preact 挂载点 (#app 内嵌 <div id="preact-root">)

阶段 2b: 迁移消息列表 (3-4天)  ← 最大痛点
  ├── <MessageList> 组件 (替代 renderChatMessages)
  ├── <Message> 组件 (替代 renderMessage)
  ├── <MessageBubble> 组件 (msg-bubble + markdown 渲染)
  ├── <AttachmentGrid> 组件
  └── 流式更新改为 setState，去掉 updateStreamingMessage 的手动 DOM patch

阶段 2c: 迁移输入区 (2-3天)
  ├── <ChatInput> 组件 (textarea + 附件)
  ├── <AttachmentDrafts> 组件
  └── 去掉 autoResizeTextarea 手动 DOM 操作

阶段 2d: 迁移侧边栏和导航 (2天)
  ├── <Sidebar> 组件
  ├── <ConversationList> 组件
  └── <TopNav> 组件

阶段 2e: 迁移右侧面板和设置页 (2天)
  ├── <RightPanel> 组件 (token monitor)
  ├── <ProviderPage> 组件
  └── <SettingsPage> / <StatsPage> 保持 innerHTML 最后迁移
```

### 状态管理方案

用 `@preact/signals` 替代全局 `state` 单例：

```typescript
// state.ts 改造
import { signal, computed } from '@preact/signals';

export const currentPage = signal<Page>('chat');
export const conversations = signal<Conversation[]>([]);
export const messages = signal<Message[]>([]);
export const isStreaming = signal(false);
export const sidebarCollapsed = signal(false);
// ... 替代原来的 state.xxx 直接赋值
```

好处：
- Signals 自动追踪依赖，精确重渲染
- 不需要手动调 `render()` 和 `bindEvents()`
- 与 Preact 原生集成，零额外绑定代码

### 关键约束

- **保留 Tauri IPC 层不变**：`invoke()` 调用方式不动
- **保留 CSS 文件不动**：Preact 组件用同样的 class 名，现有样式直接生效
- **保留 Rust 后端不动**：前端迁移不影响后端
- **保留 dev mock 模式**：非 Tauri 环境仍可用

### 风险控制

- 每个阶段独立可运行，不存在"迁移到一半不能用"的状态
- 旧的 innerHTML 渲染和新的 Preact 组件可以共存（不同页面/区域）
- 每阶段完成后 `npm run tauri build` 验证

---

## 第三阶段：CSS 模块化（预计 2-3 天，随第二阶段自然完成）

### 问题

- `styles.css` 3471 行，Section 4/5 旧样式与 Section 7 新样式共存
- 两套 CSS 变量系统（旧 `--text`/`--surface` + 新 `--text-primary`/`--glass-card-bg`）都在用
- 4 个全局 CSS 文件无隔离，靠选择器优先级管理

### 目标

新 Preact 组件使用 CSS Modules，旧代码保持不动自然萎缩。

### 方案

#### 3a. 启用 CSS Modules（随 2b 开始）

Vite 原生支持 CSS Modules，只需将文件命名为 `*.module.css`：

```
src/
  components/
    MessageList/
      index.tsx
      MessageList.module.css    ← 局部作用域，自动哈希类名
    Sidebar/
      index.tsx
      Sidebar.module.css
```

#### 3b. 迁移旧变量系统到新系统（随 2b-2d）

每迁移一个组件时，将该组件用到的旧变量（`--text`, `--surface` 等）替换为新变量（`--text-primary`, `--glass-card-bg` 等）。逐步淘汰旧变量。

#### 3c. 清理 styles.css 废弃段（最后）

当所有组件迁移到 Preact + CSS Modules 后：
- 删除 Section 4（sidebar 旧样式）— 已被 unified-shell.css + glass-system.css 覆盖
- 删除 Section 5 中的 `.msg-bubble` 旧样式 — 被 Section 7 覆盖
- 删除旧变量定义（`:root` 中的 `--text`, `--surface` 等）— 无引用后安全删除
- `styles.css` 预计从 3471 行缩减到 ~1500 行

### 不做的事

- 不引入 PostCSS / Sass / Tailwind — 项目规模不需要
- 不重写 glass-system.css / unified-shell.css / liquid-glass.css — 这三个文件结构良好
- 不强制一次性迁移所有 CSS — 旧样式自然萎缩

---

## 总览时间线

```
第 1 周    ████████  第一阶段：拆分 chat.ts
第 2 周    ████████  第二阶段 2a-2b：Preact 基础 + 消息列表迁移
第 3 周    ████████  第二阶段 2c-2d：输入区 + 侧边栏迁移
第 4 周    ████████  第二阶段 2e + 第三阶段：剩余页面 + CSS 清理
```

每阶段独立可交付、可验证、可回滚。
