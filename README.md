# Token Chat Windows

一款面向 Windows 平台的原生 AI 聊天客户端，支持多个 OpenAI Compatible API Provider。

## 功能特性

- 多 Provider 统一管理
- 精确的 Token 用量追踪与费用计算
- 对话分支与历史管理
- 本地优先，数据存储在本地 SQLite
- 支持 SSE 流式输出
- 多模型对比
- 费用预算告警

## 技术栈

- **前端**: TypeScript + Vite
- **后端**: Rust + Tauri
- **数据库**: SQLite

## 开发

```bash
# 安装依赖
cd token-chat
npm install

# 开发模式
npm run tauri dev

# 构建安装包 (NSIS + MSI)
build-installers.bat
```

## 安装包

构建完成后，安装包位于：

- **NSIS**: `token-chat/src-tauri/target/release/bundle/nsis/`
- **MSI**: `token-chat/src-tauri/target/release/bundle/msi/`

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件