use crate::db::DbConn;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

#[derive(Serialize)]
pub struct StatsSummary {
    pub total_cost_nanos: i64,
    pub total_requests: i64,
    pub cache_hit_rate: f64,
    pub avg_latency_ms: f64,
}

#[derive(Serialize)]
pub struct ModelStats {
    pub model_name: String,
    pub provider_name: String,
    pub request_count: i64,
    pub cached_tokens: i64,
    pub uncached_tokens: i64,
    pub output_tokens: i64,
    pub total_cost_nanos: i64,
}

#[derive(Deserialize)]
pub struct RecordGenerationRunInput {
    pub conversation_id: String,
    pub assistant_message_id: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub status: Option<String>,
    pub uncached_input_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
    pub cache_write_input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub usage_source: Option<String>,
    pub first_event_latency_ms: Option<i64>,
    pub first_token_latency_ms: Option<i64>,
    pub duration_ms: Option<i64>,
}

#[derive(Serialize)]
pub struct TokenUsageRun {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_nanos: i64,
    pub created_at: i64,
}

#[derive(Serialize)]
pub struct ConversationTokenUsage {
    pub conversation_id: String,
    pub uncached_input_tokens: i64,
    pub cached_input_tokens: i64,
    pub cache_write_input_tokens: i64,
    pub output_tokens: i64,
    pub cost_nanos: i64,
    pub request_count: i64,
    pub currency: String,
    pub recent_runs: Vec<TokenUsageRun>,
}

pub fn calculate_cost_nanos(
    uncached_input_tokens: i64,
    cache_read_input_tokens: i64,
    cache_write_input_tokens: i64,
    output_tokens: i64,
    uncached_input_nanos_per_million: i64,
    cache_read_nanos_per_million: i64,
    cache_write_nanos_per_million: i64,
    output_nanos_per_million: i64,
) -> i64 {
    let total = (uncached_input_tokens.max(0) as i128
        * uncached_input_nanos_per_million.max(0) as i128)
        + (cache_read_input_tokens.max(0) as i128 * cache_read_nanos_per_million.max(0) as i128)
        + (cache_write_input_tokens.max(0) as i128 * cache_write_nanos_per_million.max(0) as i128)
        + (output_tokens.max(0) as i128 * output_nanos_per_million.max(0) as i128);
    (total / 1_000_000).min(i64::MAX as i128) as i64
}

#[tauri::command]
pub fn record_generation_run(
    db: State<'_, DbConn>,
    input: RecordGenerationRunInput,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let uncached_input_tokens = input.uncached_input_tokens.unwrap_or(0).max(0);
    let cache_read_input_tokens = input.cache_read_input_tokens.unwrap_or(0).max(0);
    let cache_write_input_tokens = input.cache_write_input_tokens.unwrap_or(0).max(0);
    let output_tokens = input.output_tokens.unwrap_or(0).max(0);

    let price_snapshot = if let Some(model_id) = input.model_id.as_deref() {
        conn.query_row(
            "SELECT uncached_input_nanos_per_million, cache_read_nanos_per_million, cache_write_nanos_per_million, output_nanos_per_million, currency FROM models WHERE id = ?1",
            params![model_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
    } else {
        None
    };

    let (
        uncached_input_nanos_per_million,
        cache_read_nanos_per_million,
        cache_write_nanos_per_million,
        output_nanos_per_million,
        currency,
    ) = price_snapshot.unwrap_or((0, 0, 0, 0, "CNY".to_string()));

    let cost_nanos = calculate_cost_nanos(
        uncached_input_tokens,
        cache_read_input_tokens,
        cache_write_input_tokens,
        output_tokens,
        uncached_input_nanos_per_million,
        cache_read_nanos_per_million,
        cache_write_nanos_per_million,
        output_nanos_per_million,
    );
    let price_snapshot_json = serde_json::json!({
        "uncached_input_nanos_per_million": uncached_input_nanos_per_million,
        "cache_read_nanos_per_million": cache_read_nanos_per_million,
        "cache_write_nanos_per_million": cache_write_nanos_per_million,
        "output_nanos_per_million": output_nanos_per_million,
        "currency": currency,
    })
    .to_string();

    conn.execute(
        "INSERT INTO generation_runs (id, conversation_id, assistant_message_id, provider_id, model_id, status, uncached_input_tokens, cache_read_input_tokens, cache_write_input_tokens, output_tokens, usage_source, first_event_latency_ms, first_token_latency_ms, duration_ms, price_snapshot_json, cost_nanos, currency, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            id,
            input.conversation_id,
            input.assistant_message_id,
            input.provider_id,
            input.model_id,
            input.status.unwrap_or_else(|| "completed".to_string()),
            uncached_input_tokens,
            cache_read_input_tokens,
            cache_write_input_tokens,
            output_tokens,
            input.usage_source.unwrap_or_else(|| "estimated".to_string()),
            input.first_event_latency_ms,
            input.first_token_latency_ms,
            input.duration_ms,
            price_snapshot_json,
            cost_nanos,
            currency,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_conversation_token_usage(
    db: State<'_, DbConn>,
    conversation_id: String,
) -> Result<ConversationTokenUsage, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (uncached, cached, cache_write, output, cost, requests, currency) = conn
        .query_row(
            "SELECT
                COALESCE(SUM(uncached_input_tokens), 0),
                COALESCE(SUM(cache_read_input_tokens), 0),
                COALESCE(SUM(cache_write_input_tokens), 0),
                COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(cost_nanos), 0),
                COUNT(*),
                COALESCE(MAX(currency), 'CNY')
            FROM generation_runs
            WHERE conversation_id = ?1",
            params![conversation_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT
                cache_read_input_tokens + cache_write_input_tokens + uncached_input_tokens,
                output_tokens,
                cost_nanos,
                created_at
            FROM generation_runs
            WHERE conversation_id = ?1
            ORDER BY created_at DESC
            LIMIT 10",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(TokenUsageRun {
                input_tokens: row.get(0)?,
                output_tokens: row.get(1)?,
                cost_nanos: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut recent_runs: Vec<TokenUsageRun> = rows.filter_map(|r| r.ok()).collect();
    recent_runs.reverse();

    Ok(ConversationTokenUsage {
        conversation_id,
        uncached_input_tokens: uncached,
        cached_input_tokens: cached,
        cache_write_input_tokens: cache_write,
        output_tokens: output,
        cost_nanos: cost,
        request_count: requests,
        currency,
        recent_runs,
    })
}

#[tauri::command]
pub fn get_stats_summary(db: State<'_, DbConn>) -> Result<StatsSummary, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let total_requests: i64 = conn
        .query_row("SELECT COUNT(*) FROM generation_runs", [], |r| r.get(0))
        .unwrap_or(0);
    let total_cost: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(cost_nanos), 0) FROM generation_runs",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let total_cached: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(cache_read_input_tokens), 0) FROM generation_runs",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let total_input: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(uncached_input_tokens), 0) FROM generation_runs",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let avg_latency: f64 = conn
        .query_row(
            "SELECT COALESCE(AVG(first_event_latency_ms), 0) FROM generation_runs WHERE first_event_latency_ms IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0.0);
    let total_all_input = total_cached + total_input;
    let cache_rate = if total_all_input > 0 {
        total_cached as f64 / total_all_input as f64
    } else {
        0.0
    };
    Ok(StatsSummary {
        total_cost_nanos: total_cost,
        total_requests,
        cache_hit_rate: cache_rate,
        avg_latency_ms: avg_latency,
    })
}

#[cfg(test)]
mod tests {
    use super::calculate_cost_nanos;

    #[test]
    fn calculates_cost_from_token_prices_per_million() {
        let cost = calculate_cost_nanos(
            1_000,
            500,
            0,
            2_000,
            2_000_000_000,
            500_000_000,
            0,
            8_000_000_000,
        );
        assert_eq!(cost, 18_250_000);
    }

    #[test]
    fn clamps_negative_tokens_and_prices() {
        let cost = calculate_cost_nanos(-10, 100, 0, 50, -1, 1_000_000_000, 0, 2_000_000_000);
        assert_eq!(cost, 200_000);
    }
}

#[tauri::command]
pub fn get_stats_by_model(db: State<'_, DbConn>) -> Result<Vec<ModelStats>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT
                COALESCE(m.model_name, 'unknown') AS model_name,
                COALESCE(m.provider_name, 'unknown') AS provider_name,
                COUNT(*) AS request_count,
                COALESCE(SUM(gr.cache_read_input_tokens), 0) AS cached,
                COALESCE(SUM(gr.uncached_input_tokens), 0) AS uncached,
                COALESCE(SUM(gr.output_tokens), 0) AS output,
                COALESCE(SUM(gr.cost_nanos), 0) AS cost
            FROM generation_runs gr
            LEFT JOIN messages m ON gr.assistant_message_id = m.id
            GROUP BY m.model_name, m.provider_name
            ORDER BY cost DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ModelStats {
                model_name: row.get(0)?,
                provider_name: row.get(1)?,
                request_count: row.get(2)?,
                cached_tokens: row.get(3)?,
                uncached_tokens: row.get(4)?,
                output_tokens: row.get(5)?,
                total_cost_nanos: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}
