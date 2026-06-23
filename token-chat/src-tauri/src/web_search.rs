use crate::db::DbConn;
use reqwest::header::{HeaderName, HeaderValue};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::State;

const CONFIG_KEY: &str = "web_search_config";
const API_KEY_KEY: &str = "web_search_api_key";
static SEARCH_CANCELLED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchProviderConfig {
    pub enabled: bool,
    pub provider_id: String,
    pub base_url: String,
    pub api_key_header: String,
    pub api_key_prefix: String,
    pub api_key_query_param: String,
    pub query_param: String,
    pub result_count_param: String,
    pub language_param: String,
    pub region_param: String,
    pub safe_search_param: String,
    pub freshness_param: String,
    pub results_path: String,
    pub title_field: String,
    pub url_field: String,
    pub snippet_field: String,
    pub source_field: String,
    pub published_at_field: String,
    pub extra_headers_json: String,
    pub default_max_results: u32,
    pub default_language: String,
    pub default_region: String,
    pub safe_search: bool,
    pub timeout_ms: u64,
}

impl Default for SearchProviderConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider_id: "http-json".to_string(),
            base_url: String::new(),
            api_key_header: "Authorization".to_string(),
            api_key_prefix: "Bearer ".to_string(),
            api_key_query_param: String::new(),
            query_param: "q".to_string(),
            result_count_param: "count".to_string(),
            language_param: "language".to_string(),
            region_param: "region".to_string(),
            safe_search_param: "safeSearch".to_string(),
            freshness_param: "freshness".to_string(),
            results_path: "results".to_string(),
            title_field: "title".to_string(),
            url_field: "url".to_string(),
            snippet_field: "snippet".to_string(),
            source_field: "source".to_string(),
            published_at_field: "publishedAt".to_string(),
            extra_headers_json: "{}".to_string(),
            default_max_results: 5,
            default_language: "auto".to_string(),
            default_region: String::new(),
            safe_search: true,
            timeout_ms: 12_000,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchOptions {
    pub max_results: Option<u32>,
    pub freshness: Option<String>,
    pub language: Option<String>,
    pub region: Option<String>,
    pub safe_search: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub source: Option<String>,
    pub published_at: Option<String>,
    pub retrieved_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchConfigView {
    pub config: SearchProviderConfig,
    pub has_api_key: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSearchConfigInput {
    pub config: SearchProviderConfig,
    pub api_key: Option<String>,
    #[serde(default)]
    pub clear_api_key: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub provider_id: String,
    pub results: Vec<SearchResult>,
    pub searched_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchTestResult {
    pub success: bool,
    pub latency_ms: u128,
    pub result_count: usize,
    pub results: Vec<SearchResult>,
    pub error: Option<String>,
}

fn read_setting(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value_json FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn write_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?1, ?2, unixepoch()) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn load_config(conn: &rusqlite::Connection) -> Result<SearchProviderConfig, String> {
    match read_setting(conn, CONFIG_KEY)? {
        Some(value) => serde_json::from_str(&value)
            .map_err(|e| format!("Invalid saved search configuration: {e}")),
        None => Ok(SearchProviderConfig::default()),
    }
}

fn validate_config(config: &SearchProviderConfig) -> Result<(), String> {
    if config.provider_id != "http-json" {
        return Err(format!(
            "Unsupported Search Provider: {}",
            config.provider_id
        ));
    }
    let endpoint = reqwest::Url::parse(config.base_url.trim())
        .map_err(|_| "Search API Base URL is invalid".to_string())?;
    if endpoint.scheme() != "http" && endpoint.scheme() != "https" {
        return Err("Search API Base URL must use http:// or https://".to_string());
    }
    if config.query_param.trim().is_empty() {
        return Err("Search query parameter name is required".to_string());
    }
    if config.default_max_results == 0 || config.default_max_results > 20 {
        return Err("Default result count must be between 1 and 20".to_string());
    }
    if !(1_000..=120_000).contains(&config.timeout_ms) {
        return Err("Search timeout must be between 1000 and 120000 ms".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn get_search_config(db: State<'_, DbConn>) -> Result<SearchConfigView, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let config = load_config(&conn)?;
    let has_api_key = read_setting(&conn, API_KEY_KEY)?.is_some_and(|key| !key.is_empty());
    Ok(SearchConfigView {
        config,
        has_api_key,
    })
}

#[tauri::command]
pub fn save_search_config(
    db: State<'_, DbConn>,
    input: SaveSearchConfigInput,
) -> Result<SearchConfigView, String> {
    validate_config_for_save(&input.config)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let config_json = serde_json::to_string(&input.config).map_err(|e| e.to_string())?;
    write_setting(&conn, CONFIG_KEY, &config_json)?;
    if input.clear_api_key {
        conn.execute(
            "DELETE FROM app_settings WHERE key = ?1",
            params![API_KEY_KEY],
        )
        .map_err(|e| e.to_string())?;
    } else if let Some(api_key) = input.api_key.filter(|value| !value.trim().is_empty()) {
        write_setting(&conn, API_KEY_KEY, api_key.trim())?;
    }
    let has_api_key = read_setting(&conn, API_KEY_KEY)?.is_some_and(|key| !key.is_empty());
    Ok(SearchConfigView {
        config: input.config,
        has_api_key,
    })
}

fn validate_config_for_save(config: &SearchProviderConfig) -> Result<(), String> {
    if config.provider_id != "http-json" {
        return Err("Unsupported Search Provider".to_string());
    }
    if !config.base_url.trim().is_empty() {
        validate_config(config)?;
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_search() {
    SEARCH_CANCELLED.store(true, Ordering::Relaxed);
}

async fn wait_for_cancel() {
    while !SEARCH_CANCELLED.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}

fn redact_error(error: impl ToString, api_key: &str) -> String {
    let mut message = error.to_string();
    if !api_key.is_empty() {
        message = message.replace(api_key, "[REDACTED]");
    }
    if message.len() > 300 {
        message.truncate(300);
        message.push('…');
    }
    message
}

fn add_query_param(url: &mut reqwest::Url, name: &str, value: impl ToString) {
    if !name.trim().is_empty() {
        url.query_pairs_mut()
            .append_pair(name.trim(), &value.to_string());
    }
}

fn value_at_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    if path.trim().is_empty() {
        return Some(value);
    }
    path.split('.')
        .try_fold(value, |current, segment| current.get(segment))
}

fn result_array<'a>(body: &'a Value, configured_path: &str) -> Option<&'a Vec<Value>> {
    let candidate_paths = [
        configured_path,
        "web.results",
        "results",
        "data",
        "items",
        "organic_results",
    ];
    candidate_paths
        .iter()
        .filter(|path| !path.trim().is_empty())
        .find_map(|path| value_at_path(body, path).and_then(Value::as_array))
        .or_else(|| body.as_array())
}

fn string_at_paths(item: &Value, paths: &[&str]) -> Option<String> {
    paths.iter().find_map(|path| {
        if path.trim().is_empty() {
            return None;
        }
        value_at_path(item, path).and_then(|value| match value {
            Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        })
    })
}

fn normalize_results(
    body: &Value,
    config: &SearchProviderConfig,
    max_results: usize,
) -> Result<Vec<SearchResult>, String> {
    let items = result_array(body, &config.results_path)
        .ok_or_else(|| "Search API response does not contain a result array".to_string())?;
    let retrieved_at = chrono::Utc::now().to_rfc3339();
    let mut results = Vec::new();

    for item in items {
        let title =
            string_at_paths(item, &[&config.title_field, "title", "name"]).unwrap_or_default();
        let url =
            string_at_paths(item, &[&config.url_field, "url", "link", "href"]).unwrap_or_default();
        let valid_url = reqwest::Url::parse(&url)
            .ok()
            .filter(|parsed| parsed.scheme() == "http" || parsed.scheme() == "https");
        if title.is_empty() || valid_url.is_none() {
            continue;
        }
        let parsed_url = valid_url.expect("checked above");
        let source = string_at_paths(
            item,
            &[&config.source_field, "source", "siteName", "displayLink"],
        )
        .or_else(|| parsed_url.host_str().map(str::to_string));
        results.push(SearchResult {
            title,
            url: parsed_url.to_string(),
            snippet: string_at_paths(
                item,
                &[
                    &config.snippet_field,
                    "snippet",
                    "description",
                    "content",
                    "text",
                ],
            )
            .unwrap_or_default(),
            source,
            published_at: string_at_paths(
                item,
                &[
                    &config.published_at_field,
                    "publishedAt",
                    "published_at",
                    "date",
                    "age",
                ],
            ),
            retrieved_at: retrieved_at.clone(),
        });
        if results.len() >= max_results {
            break;
        }
    }
    Ok(results)
}

async fn execute_search(
    config: &SearchProviderConfig,
    api_key: &str,
    query: &str,
    options: SearchOptions,
) -> Result<SearchResponse, String> {
    validate_config(config)?;
    if query.trim().is_empty() {
        return Err("Search query is empty".to_string());
    }
    if api_key.is_empty()
        && (!config.api_key_header.trim().is_empty()
            || !config.api_key_query_param.trim().is_empty())
    {
        return Err("Search API Key is not configured; clear the API Key header/query fields for a keyless service".to_string());
    }
    SEARCH_CANCELLED.store(false, Ordering::Relaxed);

    let max_results = options
        .max_results
        .unwrap_or(config.default_max_results)
        .clamp(1, 20);
    let language = options
        .language
        .unwrap_or_else(|| config.default_language.clone());
    let region = options
        .region
        .unwrap_or_else(|| config.default_region.clone());
    let safe_search = options.safe_search.unwrap_or(config.safe_search);

    let mut url = reqwest::Url::parse(config.base_url.trim())
        .map_err(|_| "Search API Base URL is invalid".to_string())?;
    add_query_param(&mut url, &config.query_param, query.trim());
    add_query_param(&mut url, &config.result_count_param, max_results);
    if !language.is_empty() && language != "auto" {
        add_query_param(&mut url, &config.language_param, language);
    }
    if !region.is_empty() {
        add_query_param(&mut url, &config.region_param, region);
    }
    add_query_param(
        &mut url,
        &config.safe_search_param,
        if safe_search { "true" } else { "false" },
    );
    if let Some(freshness) = options
        .freshness
        .filter(|value| value != "any" && !value.is_empty())
    {
        add_query_param(&mut url, &config.freshness_param, freshness);
    }
    if !api_key.is_empty() && !config.api_key_query_param.trim().is_empty() {
        add_query_param(&mut url, &config.api_key_query_param, api_key);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(config.timeout_ms))
        .build()
        .map_err(|e| redact_error(e, api_key))?;
    let mut request = client.get(url).header("Accept", "application/json");
    if !api_key.is_empty() && !config.api_key_header.trim().is_empty() {
        let header_name = HeaderName::from_bytes(config.api_key_header.trim().as_bytes())
            .map_err(|_| "Invalid API key header name".to_string())?;
        let header_value = HeaderValue::from_str(&format!("{}{}", config.api_key_prefix, api_key))
            .map_err(|_| "Invalid API key header value".to_string())?;
        request = request.header(header_name, header_value);
    }
    if !config.extra_headers_json.trim().is_empty() {
        let headers: serde_json::Map<String, Value> =
            serde_json::from_str(&config.extra_headers_json)
                .map_err(|_| "Extra headers must be a JSON object".to_string())?;
        for (name, value) in headers {
            let Some(value) = value.as_str() else {
                return Err("Extra header values must be strings".to_string());
            };
            let header_name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| format!("Invalid extra header name: {name}"))?;
            let header_value = HeaderValue::from_str(value)
                .map_err(|_| format!("Invalid value for extra header: {name}"))?;
            request = request.header(header_name, header_value);
        }
    }

    let response = tokio::select! {
        result = request.send() => result.map_err(|e| redact_error(e, api_key))?,
        _ = wait_for_cancel() => return Err("SEARCH_CANCELLED".to_string()),
    };
    if !response.status().is_success() {
        return Err(format!(
            "Search API returned HTTP {}",
            response.status().as_u16()
        ));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|e| redact_error(format!("Invalid JSON response: {e}"), api_key))?;
    let results = normalize_results(&body, config, max_results as usize)?;
    Ok(SearchResponse {
        provider_id: config.provider_id.clone(),
        results,
        searched_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn search_web(
    db: State<'_, DbConn>,
    query: String,
    options: Option<SearchOptions>,
) -> Result<SearchResponse, String> {
    let (config, api_key) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        (
            load_config(&conn)?,
            read_setting(&conn, API_KEY_KEY)?.unwrap_or_default(),
        )
    };
    if !config.enabled {
        return Err("Web Search is disabled in Settings".to_string());
    }
    execute_search(&config, &api_key, &query, options.unwrap_or_default()).await
}

#[tauri::command]
pub async fn test_search_connection(db: State<'_, DbConn>) -> Result<SearchTestResult, String> {
    let (config, api_key) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        (
            load_config(&conn)?,
            read_setting(&conn, API_KEY_KEY)?.unwrap_or_default(),
        )
    };
    let start = Instant::now();
    let options = SearchOptions {
        max_results: Some(config.default_max_results.min(3)),
        language: Some(config.default_language.clone()),
        region: Some(config.default_region.clone()),
        safe_search: Some(config.safe_search),
        freshness: Some("any".to_string()),
    };
    match execute_search(&config, &api_key, "OpenAI", options).await {
        Ok(response) => Ok(SearchTestResult {
            success: true,
            latency_ms: start.elapsed().as_millis(),
            result_count: response.results.len(),
            results: response.results,
            error: None,
        }),
        Err(error) => Ok(SearchTestResult {
            success: false,
            latency_ms: start.elapsed().as_millis(),
            result_count: 0,
            results: Vec::new(),
            error: Some(redact_error(error, &api_key)),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_common_json_results_and_rejects_unsafe_urls() {
        let body = serde_json::json!({
            "results": [
                {"title": "Safe result", "url": "https://example.com/a", "snippet": "Evidence"},
                {"title": "Unsafe result", "url": "javascript:alert(1)", "snippet": "Ignore"}
            ]
        });
        let results = normalize_results(&body, &SearchProviderConfig::default(), 5).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Safe result");
        assert_eq!(results[0].source.as_deref(), Some("example.com"));
    }

    #[test]
    fn reports_a_malformed_response_instead_of_inventing_results() {
        let body = serde_json::json!({"answer": "no source list"});
        let error = normalize_results(&body, &SearchProviderConfig::default(), 5).unwrap_err();
        assert!(error.contains("result array"));
    }

    #[tokio::test]
    async fn generic_http_provider_builds_a_request_and_normalizes_the_response() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0_u8; 4096];
            let length = socket.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..length]);
            assert!(request.contains("q=rust"));
            assert!(request.contains("count=3"));
            let body = r#"{"results":[{"title":"Rust","url":"https://www.rust-lang.org/","snippet":"A language"}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });

        let config = SearchProviderConfig {
            enabled: true,
            base_url: format!("http://{address}/search"),
            api_key_header: String::new(),
            ..SearchProviderConfig::default()
        };
        let response = execute_search(
            &config,
            "",
            "rust",
            SearchOptions {
                max_results: Some(3),
                ..SearchOptions::default()
            },
        )
        .await
        .unwrap();
        server.await.unwrap();
        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].title, "Rust");
    }
}
