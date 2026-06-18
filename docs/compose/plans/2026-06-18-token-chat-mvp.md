# Token Chat Windows — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Tauri v2 desktop chat app with Provider management, SSE streaming chat, and Token statistics — the core value proposition of Token Chat Windows.

**Architecture:** Tauri v2 (Rust backend + TypeScript frontend, zero framework). Rust handles SQLite, HTTP/SSE, credential storage. TypeScript renders UI via `innerHTML` template-literal pattern (same as token-monitor). Single `render()` function rebuilds DOM on state change.

**Tech Stack:**
- Tauri v2 (`tauri 2`, `tauri-build 2`)
- Rust (edition 2021): `rusqlite 0.31` (bundled), `reqwest 0.12` (streaming), `serde 1`, `serde_json 1`, `uuid 1`, `chrono 0.4`, `tokio 1`, `windows 0.58` (credential manager)
- TypeScript 5.6, Vite 6
- CSS custom properties (adapted from prototype C: Dashboard Hybrid)

**Design Reference:** `design-demos/dashboard-hybrid.html` — three-panel layout (380px conversation list + flex chat + 320px token monitor)

---

## File Structure

```
token-chat/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── src/
│   │   ├── main.rs              # Tauri entry point
│   │   ├── lib.rs               # Command registration
│   │   ├── db.rs                # SQLite connection + migrations
│   │   ├── provider.rs          # Provider CRUD commands
│   │   ├── conversation.rs      # Conversation CRUD commands
│   │   ├── message.rs           # Message CRUD + SSE streaming
│   │   ├── stats.rs             # Statistics queries
│   │   └── credentials.rs       # Windows Credential Manager
│   └── migrations/
│       └── 001_init.sql         # Database schema
├── src/
│   ├── main.ts                  # Entry point + routing
│   ├── state.ts                 # App state + types
│   ├── render.ts                # Shell render (sidebar + main)
│   ├── chat.ts                  # Chat page logic
│   ├── provider.ts              # Provider management page
│   ├── stats.ts                 # Statistics page
│   └── styles.css               # All styles
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Task 1: Tauri Project Scaffold

**Covers:** Project setup

**Files:**
- Create: `token-chat/package.json`
- Create: `token-chat/tsconfig.json`
- Create: `token-chat/vite.config.ts`
- Create: `token-chat/index.html`
- Create: `token-chat/src-tauri/Cargo.toml`
- Create: `token-chat/src-tauri/tauri.conf.json`
- Create: `token-chat/src-tauri/build.rs`
- Create: `token-chat/src-tauri/src/main.rs`
- Create: `token-chat/src-tauri/src/lib.rs`

- [ ] **Step 1: Create project directory and initialize npm**

```bash
mkdir -p token-chat/src-tauri/src token-chat/src-tauri/migrations token-chat/src
cd token-chat
npm init -y
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "token-chat",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-opener": "^2"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "typescript": "^5.6",
    "vite": "^6"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create vite.config.ts**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
```

- [ ] **Step 5: Create index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="midnight">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0d1117">
  <title>Token Chat</title>
  <link rel="stylesheet" href="/src/styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 6: Create Cargo.toml**

```toml
[package]
name = "token-chat"
version = "0.1.0"
edition = "2021"

[lib]
name = "token_chat_lib"
crate-type = ["lib", "cdylib", "staticlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.31", features = ["bundled"] }
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
tokio = { version = "1", features = ["full"] }
windows = { version = "0.58", features = ["Win32_Security_Credentials"] }
```

- [ ] **Step 7: Create build.rs**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 8: Create main.rs**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    token_chat_lib::run()
}
```

- [ ] **Step 9: Create lib.rs (minimal)**

```rust
mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            db::init(&app_handle)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 10: Create tauri.conf.json**

```json
{
  "productName": "Token Chat",
  "version": "0.1.0",
  "identifier": "com.tokenchat.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Token Chat",
        "width": 1440,
        "height": 920,
        "minWidth": 1080,
        "minHeight": 720
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.ico"
    ]
  }
}
```

- [ ] **Step 11: Install dependencies and verify build**

```bash
npm install
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 12: Commit**

```bash
git init
git add .
git commit -m "feat: tauri v2 project scaffold"
```

---

## Task 2: SQLite Database Schema

**Covers:** S3 (Data Model)

**Files:**
- Create: `src-tauri/migrations/001_init.sql`
- Create: `src-tauri/src/db.rs`

- [ ] **Step 1: Create migration SQL**

```sql
-- Provider configuration
CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    secret_ref TEXT,
    extra_headers_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Model configuration
CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    system_prompt TEXT,
    temperature REAL DEFAULT 1.0,
    max_output_tokens INTEGER,
    context_window INTEGER DEFAULT 128000,
    uncached_input_nanos_per_million INTEGER DEFAULT 0,
    cache_read_nanos_per_million INTEGER DEFAULT 0,
    cache_write_nanos_per_million INTEGER DEFAULT 0,
    output_nanos_per_million INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'CNY',
    capabilities_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '新对话',
    provider_id TEXT REFERENCES providers(id),
    model_id TEXT REFERENCES models(id),
    parent_conversation_id TEXT REFERENCES conversations(id),
    folder TEXT,
    tags TEXT,
    pinned_at INTEGER,
    archived_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    parent_message_id TEXT REFERENCES messages(id),
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content_json TEXT NOT NULL,
    reasoning_content TEXT,
    provider_id TEXT,
    provider_name TEXT,
    model_id TEXT,
    model_name TEXT,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'streaming', 'cancelled', 'failed')),
    attachments_json TEXT,
    tool_calls_json TEXT,
    error TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Generation runs
CREATE TABLE IF NOT EXISTS generation_runs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    assistant_message_id TEXT REFERENCES messages(id),
    provider_id TEXT,
    model_id TEXT,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled', 'failed')),
    provider_request_id TEXT,
    uncached_input_tokens INTEGER DEFAULT 0,
    cache_read_input_tokens INTEGER DEFAULT 0,
    cache_write_input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    usage_source TEXT DEFAULT 'provider_reported',
    first_event_latency_ms INTEGER,
    first_token_latency_ms INTEGER,
    duration_ms INTEGER,
    price_snapshot_json TEXT,
    cost_nanos INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'CNY',
    error_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_generation_runs_conversation ON generation_runs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_generation_runs_model ON generation_runs(model_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
```

- [ ] **Step 2: Create db.rs**

```rust
use rusqlite::Connection;
use std::fs;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

pub struct DbConn(pub Mutex<Connection>);

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("token-chat.db");
    let conn = Connection::open(db_path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    conn.execute_batch(include_str!("../migrations/001_init.sql"))?;

    app.manage(DbConn(Mutex::new(conn)));
    Ok(())
}
```

- [ ] **Step 3: Update lib.rs to expose db module**

```rust
mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            db::init(&app_handle)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Verify database creation**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/migrations/ src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat: sqlite database schema with 5 tables"
```

---

## Task 3: Provider Management Backend

**Covers:** S2.1 (Provider Management)

**Files:**
- Create: `src-tauri/src/provider.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create provider.rs**

```rust
use crate::db::DbConn;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub secret_ref: Option<String>,
    pub extra_headers_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub provider_id: String,
    pub model_name: String,
    pub display_name: String,
    pub system_prompt: Option<String>,
    pub temperature: f64,
    pub max_output_tokens: Option<i64>,
    pub context_window: i64,
    pub uncached_input_nanos_per_million: i64,
    pub cache_read_nanos_per_million: i64,
    pub cache_write_nanos_per_million: i64,
    pub output_nanos_per_million: i64,
    pub currency: String,
    pub capabilities_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Deserialize)]
pub struct CreateProvider {
    pub name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub extra_headers_json: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateModel {
    pub provider_id: String,
    pub model_name: String,
    pub display_name: String,
    pub system_prompt: Option<String>,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<i64>,
    pub context_window: Option<i64>,
    pub uncached_input_nanos_per_million: Option<i64>,
    pub cache_read_nanos_per_million: Option<i64>,
    pub cache_write_nanos_per_million: Option<i64>,
    pub output_nanos_per_million: Option<i64>,
    pub currency: Option<String>,
}

#[tauri::command]
pub fn list_providers(db: State<'_, DbConn>) -> Result<Vec<Provider>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, base_url, secret_ref, extra_headers_json, created_at, updated_at FROM providers ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Provider {
                id: row.get(0)?,
                name: row.get(1)?,
                base_url: row.get(2)?,
                secret_ref: row.get(3)?,
                extra_headers_json: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn create_provider(db: State<'_, DbConn>, input: CreateProvider) -> Result<Provider, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO providers (id, name, base_url, secret_ref, extra_headers_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, input.name, input.base_url, input.api_key, input.extra_headers_json, now, now],
    ).map_err(|e| e.to_string())?;
    Ok(Provider {
        id,
        name: input.name,
        base_url: input.base_url,
        secret_ref: input.api_key,
        extra_headers_json: input.extra_headers_json,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub fn delete_provider(db: State<'_, DbConn>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM providers WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_models(db: State<'_, DbConn>, provider_id: String) -> Result<Vec<Model>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, provider_id, model_name, display_name, system_prompt, temperature, max_output_tokens, context_window, uncached_input_nanos_per_million, cache_read_nanos_per_million, cache_write_nanos_per_million, output_nanos_per_million, currency, capabilities_json, created_at, updated_at FROM models WHERE provider_id = ?1 ORDER BY display_name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![provider_id], |row| {
            Ok(Model {
                id: row.get(0)?,
                provider_id: row.get(1)?,
                model_name: row.get(2)?,
                display_name: row.get(3)?,
                system_prompt: row.get(4)?,
                temperature: row.get(5)?,
                max_output_tokens: row.get(6)?,
                context_window: row.get(7)?,
                uncached_input_nanos_per_million: row.get(8)?,
                cache_read_nanos_per_million: row.get(9)?,
                cache_write_nanos_per_million: row.get(10)?,
                output_nanos_per_million: row.get(11)?,
                currency: row.get(12)?,
                capabilities_json: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn create_model(db: State<'_, DbConn>, input: CreateModel) -> Result<Model, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO models (id, provider_id, model_name, display_name, system_prompt, temperature, max_output_tokens, context_window, uncached_input_nanos_per_million, cache_read_nanos_per_million, cache_write_nanos_per_million, output_nanos_per_million, currency, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            id, input.provider_id, input.model_name, input.display_name,
            input.system_prompt, input.temperature.unwrap_or(1.0),
            input.max_output_tokens, input.context_window.unwrap_or(128000),
            input.uncached_input_nanos_per_million.unwrap_or(0),
            input.cache_read_nanos_per_million.unwrap_or(0),
            input.cache_write_nanos_per_million.unwrap_or(0),
            input.output_nanos_per_million.unwrap_or(0),
            input.currency.unwrap_or_else(|| "CNY".to_string()),
            now, now
        ],
    ).map_err(|e| e.to_string())?;
    Ok(Model {
        id,
        provider_id: input.provider_id,
        model_name: input.model_name,
        display_name: input.display_name,
        system_prompt: input.system_prompt,
        temperature: input.temperature.unwrap_or(1.0),
        max_output_tokens: input.max_output_tokens,
        context_window: input.context_window.unwrap_or(128000),
        uncached_input_nanos_per_million: input.uncached_input_nanos_per_million.unwrap_or(0),
        cache_read_nanos_per_million: input.cache_read_nanos_per_million.unwrap_or(0),
        cache_write_nanos_per_million: input.cache_write_nanos_per_million.unwrap_or(0),
        output_nanos_per_million: input.output_nanos_per_million.unwrap_or(0),
        currency: input.currency.unwrap_or_else(|| "CNY".to_string()),
        capabilities_json: None,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub fn delete_model(db: State<'_, DbConn>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM models WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn test_provider(base_url: String, api_key: String) -> Result<serde_json::Value, String> {
    let start = std::time::Instant::now();
    let client = reqwest::Client::new();
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| serde_json::json!({"success": false, "error": e.to_string(), "latency_ms": start.elapsed().as_millis()}).to_string())?;
    let latency = start.elapsed().as_millis() as u64;
    if resp.status().is_success() {
        Ok(serde_json::json!({"success": true, "latency_ms": latency}))
    } else {
        Ok(serde_json::json!({"success": false, "error": format!("HTTP {}", resp.status()), "latency_ms": latency}))
    }
}
```

- [ ] **Step 2: Register commands in lib.rs**

```rust
mod db;
mod provider;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            db::init(&app_handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            provider::list_providers,
            provider::create_provider,
            provider::delete_provider,
            provider::list_models,
            provider::create_model,
            provider::delete_model,
            provider::test_provider,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify build**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/provider.rs src-tauri/src/lib.rs
git commit -m "feat: provider management backend commands"
```

---

## Task 4: Conversation & Message Backend

**Covers:** S2.2 (Conversation), S2.3 (Chat)

**Files:**
- Create: `src-tauri/src/conversation.rs`
- Create: `src-tauri/src/message.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create conversation.rs**

```rust
use crate::db::DbConn;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Serialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub parent_conversation_id: Option<String>,
    pub folder: Option<String>,
    pub tags: Option<String>,
    pub pinned_at: Option<i64>,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Deserialize)]
pub struct CreateConversation {
    pub title: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

#[tauri::command]
pub fn list_conversations(db: State<'_, DbConn>) -> Result<Vec<Conversation>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, provider_id, model_id, parent_conversation_id, folder, tags, pinned_at, archived_at, created_at, updated_at FROM conversations WHERE archived_at IS NULL ORDER BY pinned_at DESC, updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                provider_id: row.get(2)?,
                model_id: row.get(3)?,
                parent_conversation_id: row.get(4)?,
                folder: row.get(5)?,
                tags: row.get(6)?,
                pinned_at: row.get(7)?,
                archived_at: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn create_conversation(db: State<'_, DbConn>, input: CreateConversation) -> Result<Conversation, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let title = input.title.unwrap_or_else(|| "新对话".to_string());
    conn.execute(
        "INSERT INTO conversations (id, title, provider_id, model_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, title, input.provider_id, input.model_id, now, now],
    ).map_err(|e| e.to_string())?;
    Ok(Conversation {
        id, title, provider_id: input.provider_id, model_id: input.model_id,
        parent_conversation_id: None, folder: None, tags: None,
        pinned_at: None, archived_at: None, created_at: now, updated_at: now,
    })
}

#[tauri::command]
pub fn delete_conversation(db: State<'_, DbConn>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_conversation_title(db: State<'_, DbConn>, id: String, title: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();
    conn.execute("UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3", params![title, now, id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Create message.rs**

```rust
use crate::db::DbConn;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Serialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub parent_message_id: Option<String>,
    pub role: String,
    pub content_json: String,
    pub reasoning_content: Option<String>,
    pub provider_id: Option<String>,
    pub provider_name: Option<String>,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub status: String,
    pub attachments_json: Option<String>,
    pub tool_calls_json: Option<String>,
    pub error: Option<String>,
    pub created_at: i64,
}

#[tauri::command]
pub fn list_messages(db: State<'_, DbConn>, conversation_id: String) -> Result<Vec<Message>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, conversation_id, parent_message_id, role, content_json, reasoning_content, provider_id, provider_name, model_id, model_name, status, attachments_json, tool_calls_json, error, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                parent_message_id: row.get(2)?,
                role: row.get(3)?,
                content_json: row.get(4)?,
                reasoning_content: row.get(5)?,
                provider_id: row.get(6)?,
                provider_name: row.get(7)?,
                model_id: row.get(8)?,
                model_name: row.get(9)?,
                status: row.get(10)?,
                attachments_json: row.get(11)?,
                tool_calls_json: row.get(12)?,
                error: row.get(13)?,
                created_at: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_user_message(db: State<'_, DbConn>, conversation_id: String, content: String) -> Result<Message, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let content_json = serde_json::json!({"text": content}).to_string();
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content_json, status, created_at) VALUES (?1, ?2, 'user', ?3, 'completed', ?4)",
        params![id, conversation_id, content_json, now],
    ).map_err(|e| e.to_string())?;
    conn.execute("UPDATE conversations SET updated_at = ?1 WHERE id = ?2", params![now, conversation_id])
        .map_err(|e| e.to_string())?;
    Ok(Message {
        id, conversation_id, parent_message_id: None, role: "user".to_string(),
        content_json, reasoning_content: None, provider_id: None, provider_name: None,
        model_id: None, model_name: None, status: "completed".to_string(),
        attachments_json: None, tool_calls_json: None, error: None, created_at: now,
    })
}

#[tauri::command]
pub fn save_assistant_message(
    db: State<'_, DbConn>,
    conversation_id: String,
    content: String,
    reasoning: Option<String>,
    provider_id: String,
    provider_name: String,
    model_id: String,
    model_name: String,
    status: String,
) -> Result<Message, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let content_json = serde_json::json!({"text": content}).to_string();
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content_json, reasoning_content, provider_id, provider_name, model_id, model_name, status, created_at) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, conversation_id, content_json, reasoning, provider_id, provider_name, model_id, model_name, status, now],
    ).map_err(|e| e.to_string())?;
    Ok(Message {
        id, conversation_id, parent_message_id: None, role: "assistant".to_string(),
        content_json, reasoning_content: reasoning, provider_id: Some(provider_id),
        provider_name: Some(provider_name), model_id: Some(model_id),
        model_name: Some(model_name), status, attachments_json: None,
        tool_calls_json: None, error: None, created_at: now,
    })
}
```

- [ ] **Step 3: Register commands in lib.rs**

```rust
mod db;
mod provider;
mod conversation;
mod message;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            db::init(&app_handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            provider::list_providers,
            provider::create_provider,
            provider::delete_provider,
            provider::list_models,
            provider::create_model,
            provider::delete_model,
            provider::test_provider,
            conversation::list_conversations,
            conversation::create_conversation,
            conversation::delete_conversation,
            conversation::update_conversation_title,
            message::list_messages,
            message::save_user_message,
            message::save_assistant_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Verify build**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/conversation.rs src-tauri/src/message.rs src-tauri/src/lib.rs
git commit -m "feat: conversation and message backend commands"
```

---

## Task 5: SSE Streaming Chat Backend

**Covers:** S2.3.2 (SSE Streaming), S2.3.3 (Stop Generation), S2.5.1 (Message Metrics)

**Files:**
- Create: `src-tauri/src/chat.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create chat.rs**

```rust
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::Instant;
use tauri::{Emitter, Window};
use tokio::sync::Mutex;

#[derive(Clone, Serialize)]
pub struct StreamChunk {
    pub content: String,
    pub reasoning: Option<String>,
    pub done: bool,
    pub usage: Option<Usage>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub cached_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

#[derive(Clone, Serialize)]
pub struct StreamMetrics {
    pub first_event_ms: u64,
    pub first_token_ms: u64,
    pub total_ms: u64,
    pub tokens_generated: u64,
}

static CANCEL: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub fn cancel_generation() {
    CANCEL.store(true, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub async fn send_message(
    window: Window,
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<Value>,
    temperature: Option<f64>,
    max_tokens: Option<u64>,
) -> Result<(), String> {
    CANCEL.store(false, std::sync::atomic::Ordering::Relaxed);
    let start = Instant::now();
    let client = Client::new();
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });
    if let Some(t) = temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(m) = max_tokens {
        body["max_tokens"] = serde_json::json!(m);
    }

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, text));
    }

    let mut first_event = None;
    let mut first_token = None;
    let mut full_content = String::new();
    let mut full_reasoning = String::new();
    let mut usage: Option<Usage> = None;
    let mut stream = resp.bytes_stream();

    use futures_util::StreamExt;
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        if CANCEL.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || !line.starts_with("data: ") {
                continue;
            }
            let data = &line[6..];
            if data == "[DONE]" {
                break;
            }

            if first_event.is_none() {
                first_event = Some(start.elapsed().as_millis() as u64);
            }

            if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                if let Some(choices) = parsed["choices"].as_array() {
                    for choice in choices {
                        let delta = &choice["delta"];
                        if let Some(content) = delta["content"].as_str() {
                            if first_token.is_none() && !content.is_empty() {
                                first_token = Some(start.elapsed().as_millis() as u64);
                            }
                            full_content.push_str(content);
                        }
                        if let Some(reasoning) = delta["reasoning_content"].as_str() {
                            full_reasoning.push_str(reasoning);
                        }
                    }
                }
                if let Some(u) = parsed.get("usage") {
                    usage = Some(Usage {
                        prompt_tokens: u["prompt_tokens"].as_u64(),
                        completion_tokens: u["completion_tokens"].as_u64(),
                        cached_tokens: u["cached_tokens"].as_u64(),
                        total_tokens: u["total_tokens"].as_u64(),
                    });
                }
            }

            let _ = window.emit("chat-stream", StreamChunk {
                content: full_content.clone(),
                reasoning: if full_reasoning.is_empty() { None } else { Some(full_reasoning.clone()) },
                done: false,
                usage: usage.clone(),
            });
        }
    }

    let total_ms = start.elapsed().as_millis() as u64;
    let _ = window.emit("chat-stream", StreamChunk {
        content: full_content.clone(),
        reasoning: if full_reasoning.is_empty() { None } else { Some(full_reasoning.clone()) },
        done: true,
        usage: usage.clone(),
    });
    let _ = window.emit("chat-metrics", StreamMetrics {
        first_event_ms: first_event.unwrap_or(0),
        first_token_ms: first_token.unwrap_or(0),
        total_ms,
        tokens_generated: full_content.chars().count() as u64,
    });

    Ok(())
}
```

- [ ] **Step 2: Add futures-util to Cargo.toml**

```toml
[dependencies]
# ... existing deps ...
futures-util = "0.3"
```

- [ ] **Step 3: Register commands in lib.rs**

Add `mod chat;` and register `chat::send_message`, `chat::cancel_generation` in invoke_handler.

- [ ] **Step 4: Verify build**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/chat.rs src-tauri/Cargo.toml src-tauri/src/lib.rs
git commit -m "feat: sse streaming chat backend"
```

---

## Task 6: Frontend Styles & Shell

**Covers:** S2.9 (UI & Themes)

**Files:**
- Create: `src/styles.css`
- Create: `src/main.ts`
- Create: `src/state.ts`

- [ ] **Step 1: Create state.ts**

```ts
export interface Provider {
  id: string;
  name: string;
  base_url: string;
  created_at: number;
  updated_at: number;
}

export interface Model {
  id: string;
  provider_id: string;
  model_name: string;
  display_name: string;
  context_window: number;
  uncached_input_nanos_per_million: number;
  cache_read_nanos_per_million: number;
  output_nanos_per_million: number;
  currency: string;
}

export interface Conversation {
  id: string;
  title: string;
  provider_id: string | null;
  model_id: string | null;
  pinned_at: number | null;
  archived_at: number | null;
  updated_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content_json: string;
  reasoning_content: string | null;
  provider_name: string | null;
  model_name: string | null;
  status: string;
  created_at: number;
}

export type Page = 'chat' | 'provider' | 'stats';

export interface AppState {
  page: Page;
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Message[];
  providers: Provider[];
  models: Model[];
  isStreaming: boolean;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
}

export const state: AppState = {
  page: 'chat',
  conversations: [],
  currentConversationId: null,
  messages: [],
  providers: [],
  models: [],
  isStreaming: false,
  sidebarCollapsed: false,
  rightPanelCollapsed: false,
};
```

- [ ] **Step 2: Create styles.css (adapted from prototype C)**

Extract the CSS from `design-demos/dashboard-hybrid.html` into a standalone `src/styles.css`. Key sections:
- CSS custom properties (theme system)
- Layout (three-panel: sidebar + chat + right panel)
- Sidebar styles
- Chat message styles
- Input area styles
- Provider management styles
- Statistics styles
- Modal styles
- Utility classes

- [ ] **Step 3: Create main.ts (minimal shell)**

```ts
import { invoke } from '@tauri-apps/api/core';
import { state, Page } from './state';

function render() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="app-layout">
      ${renderSidebar()}
      ${renderMain()}
      ${renderRightPanel()}
    </div>
  `;
  bindEvents();
}

function renderSidebar(): string { /* ... */ }
function renderMain(): string { /* ... */ }
function renderRightPanel(): string { /* ... */ }
function bindEvents(): void { /* ... */ }

// Initialize
render();
```

- [ ] **Step 4: Verify dev server starts**

```bash
cd token-chat && npm run dev
```

- [ ] **Step 5: Commit**

```bash
git add src/styles.css src/main.ts src/state.ts
git commit -m "feat: frontend shell with three-panel layout"
```

---

## Task 7: Chat Page Frontend

**Covers:** S2.2 (Conversation List), S2.3 (Chat UI)

**Files:**
- Create: `src/chat.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Create chat.ts with conversation list + message rendering**

Implement:
- `renderConversationList()` — sidebar conversation items
- `renderMessages()` — message bubbles with token metrics
- `renderInputArea()` — text input + send button
- `handleSend()` — invoke Tauri command, listen for SSE events
- `handleStreamChunk()` — update message in real-time

- [ ] **Step 2: Integrate chat.ts into main.ts**

Import and wire up chat rendering functions.

- [ ] **Step 3: Test chat flow**

Verify: create conversation → select → type message → send → see streaming response.

- [ ] **Step 4: Commit**

```bash
git add src/chat.ts src/main.ts
git commit -m "feat: chat page with conversation list and streaming messages"
```

---

## Task 8: Provider Management Frontend

**Covers:** S2.1 (Provider Management UI)

**Files:**
- Create: `src/provider.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Create provider.ts**

Implement:
- `renderProviderList()` — provider cards with health status
- `renderModelTable()` — models under selected provider
- `renderAddProviderModal()` — form for adding provider
- `handleTestConnection()` — test provider connectivity
- `handleAddProvider()` — create provider via Tauri command

- [ ] **Step 2: Integrate into main.ts**

- [ ] **Step 3: Commit**

```bash
git add src/provider.ts src/main.ts
git commit -m "feat: provider management page"
```

---

## Task 9: Statistics Frontend

**Covers:** S2.5 (Token Statistics)

**Files:**
- Create: `src/stats.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Create stats.ts**

Implement:
- `renderKpiCards()` — total cost, requests, cache hit rate, avg latency
- `renderModelTable()` — per-model aggregation
- `renderCostChart()` — SVG sparkline (hand-drawn style)
- Time range filter (all/today/month)

- [ ] **Step 2: Add stats backend command**

Add `get_stats` command in Rust that queries `generation_runs` table.

- [ ] **Step 3: Integrate into main.ts**

- [ ] **Step 4: Commit**

```bash
git add src/stats.ts src/main.ts src-tauri/src/stats.rs src-tauri/src/lib.rs
git commit -m "feat: statistics page with charts and aggregation"
```

---

## Task 10: End-to-End Integration Test

**Covers:** Full MVP flow

- [ ] **Step 1: Build and run the app**

```bash
cd token-chat
npm run tauri dev
```

- [ ] **Step 2: Test complete flow**

1. Add a Provider (OpenAI with real API key)
2. Auto-discover models
3. Create a conversation
4. Send a message
5. See streaming response with token metrics
6. Check statistics page
7. Export data

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: mvp integration complete"
```

---

## Future Phases (not in this plan)

- Phase 2: Conversation branching, thinking process, tool calls
- Phase 3: Attachments, conversation search, folders/tags
- Phase 4: Budget alerts, system prompt templates, multi-model comparison
- Phase 5: Themes (6 themes), import/export, keyboard shortcuts
- Phase 6: Context window budget, draft auto-save, title auto-generation
