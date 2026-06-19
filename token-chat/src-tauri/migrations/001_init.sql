CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    secret_ref TEXT,
    extra_headers_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

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

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Conversation',
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

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_generation_runs_conversation ON generation_runs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_generation_runs_model ON generation_runs(model_id);
CREATE INDEX IF NOT EXISTS idx_generation_runs_created_at ON generation_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
