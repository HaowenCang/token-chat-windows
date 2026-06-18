# Token Chat Windows — 设计原型 Spec

## 产品定义
Token Chat Windows 是一款 Windows 原生 AI 聊天客户端，支持多 Provider OpenAI Compatible API，提供多轮对话、Token 统计与费用追踪。定位「轻量、专业、可控」。

## 原型目标
制作可交互的 HTML 原型，展示核心 UI 设计方向。聚焦 3 个主屏幕：
1. **主聊天界面**（含侧边栏对话列表 + 聊天区域 + 输入框）
2. **Provider 管理页面**（Provider 列表 + 模型配置）
3. **统计页面**（Token 用量 + 费用图表）

## 参考设计：token-monitor (Token Ledger)
- 技术：Tauri v2 + Vanilla TypeScript + 纯 CSS
- 布局：固定 244px 侧边栏 + 流式主区域
- 色彩：CSS 自定义属性体系，6 主题（午夜紫 #9589f7 / 深海蓝 #63b5dc / 云雾白 / 石墨橙 / 松林绿 / 暖纸白）
- 字体：7 个语义字号（page-title 28px / section-title 15px / body 13px / secondary 11px / data 26px / table 12px / control 12px）
- 组件：12px 圆角卡片、1px solid 边框、hover 上浮 2px、左侧 accent 色条
- 图表：手绘 SVG（sparkline、stacked bar、donut）
- 交互：底部 toast、跟随光标 tooltip、键盘快捷键

## 目标用户
- 需要管理多个 API Provider 的开发者
- 关注 Token 消耗与费用的重度用户
- 习惯 Windows 原生桌面工作流的用户

## 设计约束
- 暗色主题为默认，亮色主题可选
- 中文界面为主
- 最小窗口 1080×720，默认 1440×920
- 避免 AI slop：不用紫渐变作默认、不用 emoji 做图标、不用 SVG 画人物

## 三个设计方向

### 方向 A：Precision Ledger（精密账本）
- 直接移植 token-monitor 的视觉 DNA
- 244px 固定侧边栏，对话列表像"账目条目"
- 聊天消息区用数据卡片风格，每条消息带完整 Token 指标面板
- 统计页面复用 token-monitor 的 sparkline + donut + stacked bar
- 强调"每一条消息都是可追踪的数据记录"

### 方向 B：Conversational First（对话优先）
- 保留 token-monitor 的色彩系统和组件风格
- 但布局为聊天场景重新设计：侧边栏可折叠为图标模式
- 聊天区域更宽敞，消息气泡更传统（用户右、助手左）
- Token 指标作为消息底部的紧凑 badge，不占主导
- 统计页面用更现代的卡片网格，而非纯数据表格
- 强调"首先是一个好用的聊天工具，其次才是数据追踪"

### 方向 C：Dashboard-Chat Hybrid（仪表盘融合）
- 左侧窄聊天面板（360px），右侧宽仪表盘区域
- 聊天时右侧实时显示 Token 用量、费用曲线、模型对比
- 类似 IDE 的双栏布局：代码/聊天在左，输出/数据在右
- 统计页面是仪表盘的全屏展开版本
- Provider 管理用 modal overlay 而非独立页面
- 强调"聊天和数据监控并行，一站式工作台"

## 通用组件规范（三版共用）

### 侧边栏
- 品牌 logo 区
- 搜索框
- 对话列表项：标题 + 模型名 + 时间 + 置顶标记
- 新建对话按钮
- 归档开关

### 聊天区
- 顶部：对话标题 + 模型信息 + 工具栏（搜索/对比/统计/Provider/设置）
- 消息列表：用户消息（右对齐）+ 助手消息（左对齐）
- 助手消息底部：Token 指标面板（缓存输入/非缓存输入/输出/费用/延迟）
- 底部：多行输入框 + 附件按钮 + 发送/停止按钮

### Provider 管理
- Provider 列表卡片（名称 + URL + 健康状态）
- 模型列表（名称 + 价格 + 上下文窗口）
- 测试连通性按钮
- 导入/导出按钮

### 统计页
- 时间范围筛选（全部/今日/本月）
- 按模型聚合表格
- 按对话聚合表格
- 费用趋势图表
- 导出按钮

## 技术要求
- 纯 HTML/CSS 单文件，inline 所有样式和脚本
- 不依赖外部 CDN 或库
- 使用 CSS 自定义属性实现主题
- 交互：点击切换对话、发送消息、切换页面、展开折叠
- 模拟数据：预填 3-5 个对话、每个 5-10 条消息
