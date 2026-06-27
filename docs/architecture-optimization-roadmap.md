# Token Chat 后续架构优化路线图

> 当前版本日期: 2026-06-26  
> 范围: `token-chat` 前端 TypeScript/Tauri 架构优化  
> 关键词: Module、Interface、Seam、Adapter、Depth、Leverage、Locality

## 执行状态

截至 2026-06-27，阶段 0-7 已全部完成。当前架构入口见 `docs/architecture.md`，关键技术与安全决策见 `docs/adr/`；后续优化应以新的性能数据、功能需求或已记录决策的变化为依据，而不是重复本路线图中的拆分工作。

## 背景

本路线图延续当前已经完成的架构优化工作：平台 IPC 已基本收进 `src/ipc/*` Adapter，Tauri runtime 判断已收进 `src/platform/runtime.ts`，聊天页面正在从旧的 DOM/innerHTML Surface 逐步迁移到 Preact Surface。

后续优化的目标不是做大规模重写，而是持续加深关键 Module：缩小调用方必须理解的 Interface，把跨平台、渲染、工作流、表单转换和统计投影这些变化点集中到明确的 Seam 上。

## 已完成基线

- `src/ipc/*` 承接 Tauri `invoke` Adapter，业务 Module 不再直接拼命令参数。
- `src/platform/runtime.ts` 集中判断当前是否运行在 Tauri 环境。
- `chat-view-model.ts` 提供会话列表和消息搜索元数据的展示投影。
- `chat.ts` 作为聊天 Surface 入口，负责挂载 Preact Adapter。
- `ChatInput`、`ConversationList`、`MessageList`、`RightPanel` 已开始接管聊天交互区域。
- `vite.config.ts` 关闭 Preact devtools transform，避免当前依赖组合下的开发期 `zimmerframe` overlay。

## 阶段 0: 当前变更固化

### 目标

在继续推进之前，把现有优化作为稳定基线，避免后续阶段叠在未验证的临时状态上。

### 工作项

- 跑 `npm run build`。
- 跑 `cargo test`。
- 跑浏览器冒烟：聊天页加载、输入框可用、模型选择可切换、控制台无错误。
- 检查 `git diff --check`，确认只有可接受的 LF/CRLF 提示。
- 如需要提交，单独提交一版“平台 Adapter + Chat Surface 收口”基线。

### 验收

- 构建和测试全绿。
- `invoke` 只出现在 `src/ipc/*`。
- `window.__TAURI_INTERNALS__` 只出现在 `src/platform/runtime.ts`。
- 本地开发页无 Vite overlay。

## 阶段 1: Markdown / MathJax 渲染 Module

### 目标

用成熟库替换当前自写 Markdown/类 LaTeX 渲染逻辑，降低解析安全风险和维护成本，同时保持调用方 Interface 稳定。

### 技术选型

- Markdown: `markdown-it`
- LaTeX / 数学公式: `MathJax`

`markdown-it` 更适合当前“Markdown 字符串 -> HTML”的 Interface；`MathJax` 对 TeX/LaTeX、复杂公式和可访问性支持更完整。

参考:

- https://github.com/markdown-it/markdown-it
- https://docs.mathjax.org/

### 目标 Module

- `src/chat-markdown.ts`
- 可新增 `src/markdown-renderer.ts` 或 `src/rendering/markdown-renderer.ts`

### Interface

保留调用方使用的简单 Interface：

```ts
renderMarkdown(content: string): string
```

内部 Implementation 改为：

- `markdown-it` 负责 Markdown 解析。
- `MathJax` 负责数学公式渲染。
- 安全层负责清理或禁用不可信 HTML。

### 工作项

- 安装 `markdown-it` 和 `mathjax`。
- 保留 `renderMarkdown(content): string`，避免 `MessageList`、`chat-render`、流式更新路径一起改。
- 设计数学公式约定：
  - inline: `$...$` 和 `\(...\)`
  - block: `$$...$$` 和 `\[...\]`
- 明确 HTML 安全策略：
  - 默认不信任模型输出。
  - 禁止脚本、事件属性、危险 URL。
  - 如果启用原始 HTML，必须经过 sanitize。
- 加测试样例：
  - 标题、列表、表格、代码块、链接。
  - inline/block 公式。
  - 转义字符。
  - 恶意 HTML 输入。
  - 流式消息增量更新。

### 验收

- 普通 Markdown 视觉不退化。
- 数学公式可渲染。
- 危险 HTML 不执行。
- 流式消息更新仍然可用。
- 调用方不需要知道 `markdown-it` 或 `MathJax`。

## 阶段 2: Chat Workflow 收口

### 目标

把发送流程从“长函数 + 多个回调”加深为清楚的 Chat Workflow Module，让发送、取消、搜索增强、保存消息、记录 token run 的顺序集中。

### 当前摩擦

- `chat-send.ts` 仍然承载大量流程细节。
- `chat-conversation.ts` 和 `chat-send.ts` 之间仍有回调和标题更新耦合。
- 错误路径、取消路径、搜索失败路径、保存失败路径都在同一条长流程里。

### 目标 Module

- 新增 `ChatRunWorkflow`。
- 保留 `ChatInput` 作为输入 Adapter。
- 保留 `chat-conversation.ts` 作为会话生命周期 Module。

### 建议 Interface

```ts
sendCurrentDraft(): Promise<void>
cancelCurrentRun(): Promise<void>
renameConversationFromFirstMessage(conversationId: string): Promise<void>
```

### 工作项

- 把 `handleSend` 拆成内部步骤：
  - prepare draft
  - optional web search
  - save user message
  - create streaming assistant message
  - call model
  - save assistant message
  - record generation run
  - refresh token usage
- 把取消路径独立成 `cancelCurrentRun()`。
- 把自动标题生成从发送 Module 移到会话/标题 Module。
- 明确每个失败点的状态回滚策略。

### 验收

- 发送流程可通过更小 Interface 测试。
- 搜索失败不会阻断普通发送。
- 保存失败、取消、模型错误都有明确状态。
- `ChatInput` 不知道保存、搜索、token run 细节。

## 阶段 3: Provider 管理页深度优化

### 目标

拆掉 `provider.ts` 的大文件浅 Module，把 Provider/Model 展示投影、表单读取、payload 转换和页面事件分离。

### 当前摩擦

- `provider.ts` 混合渲染、表单读取、modal 事件、mock 数据、Provider/Model 操作。
- Provider 与 Model 的 payload 转换散落在多个 DOM 事件里。
- 表单校验和数据归一化缺少独立测试 Surface。

### 目标 Module

- `ProviderCatalogViewModel`
- `ProviderFormModel`
- `ModelFormModel`
- `provider.ts` 保留为页面 Surface。

### 工作项

- 抽 Provider/Model 列表投影。
- 抽选中 Provider、选中 Model、modal 状态。
- 抽新增/编辑 Provider payload 构造。
- 抽新增/编辑 Model payload 构造。
- 保持 `ipc/provider-catalog.ts` Adapter 不变。

### 验收

- Provider/Model 表单转换可独立测试。
- `provider.ts` 中 DOM 事件只负责读控件和调用 Module Interface。
- 新增、编辑、删除、发现模型流程行为不变。

## 阶段 4: Stats 页面深度优化

### 目标

把统计数据投影、排序、趋势图交互从 `stats.ts` 中拆出来，让统计页面的 Interface 更小、更可测。

### 当前摩擦

- `stats.ts` 同时负责数据加载、投影、排序、图表 SVG、DOM 事件和导出。
- 趋势图 scope、series、model filter 状态缺少清晰 Module。

### 目标 Module

- `StatsViewModel`
- `TokenTrendModel`
- `StatsExportModel`
- `stats.ts` 保留为页面 Surface。

### 工作项

- 抽 summary、by model、by conversation、daily costs 的展示投影。
- 抽排序状态和排序函数。
- 抽趋势图 series 显隐和 model filter。
- 抽 JSON/CSV 导出数据转换。
- 保持 `ipc/stats-snapshot.ts` Adapter 不变。

### 验收

- 排序、筛选、趋势显隐可用纯函数或轻量状态测试覆盖。
- `stats.ts` 的页面事件不再直接包含统计计算细节。

## 阶段 5: Settings / Prompt / Search 配置收口

### 目标

把设置页的 localStorage、搜索配置、Prompt 编辑收进专门 Module，避免 `settings.ts` 继续承担过多 Interface。

### 当前摩擦

- `settings.ts` 直接管理大量 DOM 查询、localStorage 读写和搜索配置表单。
- Prompt 列表编辑、全局 Prompt、搜索 API Key、主题、字体、货币设置混在一个 Surface 中。

### 目标 Module

- `SettingsState`
- `SearchSettingsModel`
- `PromptLibraryModel`
- `AppearanceSettingsModel`

### 工作项

- 抽 theme、font、currency、send key 的状态读写。
- 抽 Web Search 表单投影和保存 payload。
- 抽 Prompt Library 的增删改和 localStorage 持久化。
- `settings.ts` 逐步降为渲染和事件连接层。

### 验收

- 保存/重置/测试搜索连接不依赖散落 DOM 查询。
- Prompt Library 可独立测试。
- 设置页改动不再影响聊天发送主流程。

## 阶段 6: 测试补强

### 目标

给高风险 Module 加轻量 TypeScript 测试，让核心行为不依赖手动浏览器验证。

### 优先测试对象

- `chat-view-model`
- Markdown / MathJax renderer
- `web-search` metadata 和配置归一化
- Provider/Model 表单 payload
- Stats 投影、排序、趋势状态
- Chat Workflow 关键状态迁移

### 工作项

- 评估当前项目测试工具，优先选择轻量方案。
- 避免一开始铺太大的 e2e 测试。
- 每个新深 Module 至少补 1 组核心测试。

### 验收

- 不启动 Tauri 和浏览器也能覆盖关键转换逻辑。
- 浏览器冒烟只负责确认渲染和交互接线。

## 阶段 7: 最终清理与文档

### 目标

在主要 Module 形状稳定后，做命名、死代码和架构说明的收尾。

### 工作项

- 删除旧 renderer 死路径和重复 helper。
- 扫描未使用导出。
- 给以下目录/Module 写简短说明：
  - `src/ipc/`
  - `src/platform/`
  - Chat Workflow
  - Markdown renderer
  - Provider 管理页
  - Stats 页面
- 如决策稳定，补 ADR：
  - 为什么选择 `markdown-it + MathJax`。
  - 为什么保留 HTML sanitize 层。
  - 为什么 Tauri Adapter 收在 `src/ipc/*`。

### 验收

- 新贡献者可以从文档理解主要 Seam。
- 架构审查不会重复提出已记录并已接受的方向。

## 推荐执行顺序

1. 固化当前变更。
2. 实施 Markdown / MathJax 渲染 Module。
3. 收口 Chat Workflow。
4. 深化 Provider 管理页。
5. 深化 Stats 页面。
6. 收口 Settings / Prompt / Search 配置。
7. 补测试。
8. 清理和文档化。

## 每阶段通用验收清单

- `npm run build`
- `cargo test`
- `git diff --check`
- 浏览器冒烟：
  - 页面无 Vite overlay。
  - 控制台无相关 warn/error。
  - 被改动 Surface 的主交互可用。
- 扫描架构约束：
  - `invoke` 只留在 `src/ipc/*`。
  - Tauri runtime 判断只留在 `src/platform/runtime.ts`。
  - 页面 Surface 不直接承担数据转换或平台命令参数拼装。
