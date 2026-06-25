use crate::credential;
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

    // Store API key in Windows Credential Manager, save provider_id as reference
    if let Some(ref key) = input.api_key {
        if !key.is_empty() {
            credential::store_api_key(&id, key)?;
        }
    }

    conn.execute(
        "INSERT INTO providers (id, name, base_url, secret_ref, extra_headers_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, input.name, input.base_url, id, input.extra_headers_json, now, now],
    ).map_err(|e| e.to_string())?;
    Ok(Provider {
        id: id.clone(),
        name: input.name,
        base_url: input.base_url,
        secret_ref: Some(id.clone()),
        extra_headers_json: input.extra_headers_json,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_provider(
    db: State<'_, DbConn>,
    id: String,
    input: CreateProvider,
) -> Result<Provider, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();

    // Update API key in Credential Manager
    if let Some(ref key) = input.api_key {
        if !key.is_empty() {
            credential::store_api_key(&id, key)?;
        }
    }

    conn.execute(
        "UPDATE providers SET name = ?1, base_url = ?2, secret_ref = ?3, extra_headers_json = ?4, updated_at = ?5 WHERE id = ?6",
        params![input.name, input.base_url, id, input.extra_headers_json, now, id],
    ).map_err(|e| e.to_string())?;
    Ok(Provider {
        id: id.clone(),
        name: input.name,
        base_url: input.base_url,
        secret_ref: Some(id),
        extra_headers_json: input.extra_headers_json,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_provider_api_key(_db: State<'_, DbConn>, id: String) -> Result<Option<String>, String> {
    // Read API key from Windows Credential Manager
    credential::get_api_key(&id)
}

#[tauri::command]
pub fn delete_provider(db: State<'_, DbConn>, id: String) -> Result<(), String> {
    // Delete credential from Windows Credential Manager (ignore if not found)
    let _ = credential::delete_api_key(&id);

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
    let currency = input.currency.unwrap_or_else(|| "CNY".to_string());
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
            currency,
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
        currency,
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
pub fn update_model(
    db: State<'_, DbConn>,
    id: String,
    input: CreateModel,
) -> Result<Model, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();
    let currency = input.currency.unwrap_or_else(|| "CNY".to_string());
    conn.execute(
        "UPDATE models SET model_name = ?1, display_name = ?2, system_prompt = ?3, temperature = ?4, max_output_tokens = ?5, context_window = ?6, uncached_input_nanos_per_million = ?7, cache_read_nanos_per_million = ?8, cache_write_nanos_per_million = ?9, output_nanos_per_million = ?10, currency = ?11, updated_at = ?12 WHERE id = ?13",
        params![
            input.model_name, input.display_name, input.system_prompt,
            input.temperature.unwrap_or(1.0), input.max_output_tokens,
            input.context_window.unwrap_or(128000),
            input.uncached_input_nanos_per_million.unwrap_or(0),
            input.cache_read_nanos_per_million.unwrap_or(0),
            input.cache_write_nanos_per_million.unwrap_or(0),
            input.output_nanos_per_million.unwrap_or(0),
            currency, now, id
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
        currency,
        capabilities_json: None,
        created_at: now,
        updated_at: now,
    })
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
        Ok(
            serde_json::json!({"success": false, "error": format!("HTTP {}", resp.status()), "latency_ms": latency}),
        )
    }
}

#[derive(Serialize, Deserialize)]
pub struct DiscoveredModel {
    pub id: String,
    pub owned_by: Option<String>,
}

#[tauri::command]
pub async fn discover_models(
    base_url: String,
    api_key: String,
) -> Result<Vec<DiscoveredModel>, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, text));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut models = Vec::new();

    if let Some(data) = body["data"].as_array() {
        for item in data {
            let id = item["id"].as_str().unwrap_or("").to_string();
            let owned_by = item["owned_by"].as_str().map(|s| s.to_string());
            if !id.is_empty() {
                models.push(DiscoveredModel { id, owned_by });
            }
        }
    }

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}
