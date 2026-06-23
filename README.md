# Token Chat Windows

A native AI chat client for Windows, supporting multiple OpenAI-compatible API providers.

面向 Windows 平台的原生 AI 聊天客户端，支持多个 OpenAI Compatible API Provider。

---

## Features / 功能特性

- **Multi-Provider Management** — Unified interface for multiple API providers
- **Token Tracking** — Precise token usage tracking and cost calculation
- **Conversation Branching** — Branch management and history navigation
- **Local-First** — All data stored in local SQLite database
- **SSE Streaming** — Real-time streaming output
- **Multi-Model Compare** — Side-by-side model comparison
- **Budget Alerts** — Cost budget warnings

- **多 Provider 统一管理** — 一个界面管理多个 API 提供商
- **Token 用量追踪** — 精确统计 Token 用量与费用计算
- **对话分支管理** — 支持对话分支与历史导航
- **本地优先** — 数据存储在本地 SQLite，保护隐私
- **SSE 流式输出** — 实时流式响应
- **多模型对比** — 并排对比不同模型输出
- **费用预算告警** — 超支自动提醒

## Tech Stack / 技术栈

- **Frontend / 前端**: TypeScript + Vite
- **Backend / 后端**: Rust + Tauri v2
- **Database / 数据库**: SQLite (via rusqlite)

## Getting Started / 快速开始

### Prerequisites / 前置依赖

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development / 开发

```bash
cd token-chat
npm install
npm run tauri dev
```

### Build / 构建

```bash
# Build installers (NSIS + MSI)
npm run tauri build
```

Build output / 构建产物：

| Format / 格式 | Location / 路径 |
|---|---|
| NSIS (.exe) | `token-chat/src-tauri/target/release/bundle/nsis/` |
| MSI (.msi) | `token-chat/src-tauri/target/release/bundle/msi/` |

## License / 许可证

[MIT](LICENSE) © Haowen Cang
