use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;
use tauri::{Emitter, Window};

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

async fn post_chat_request(
    client: &Client,
    url: &str,
    api_key: &str,
    body: &Value,
) -> Result<reqwest::Response, String> {
    client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(body)
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| e.to_string())
}

fn should_retry(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

async fn post_with_retry(
    client: &Client,
    url: &str,
    api_key: &str,
    body: &Value,
) -> Result<reqwest::Response, String> {
    let max_attempts = 3;
    let mut last_err = String::new();

    for attempt in 0..max_attempts {
        if CANCEL.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("cancelled".to_string());
        }

        let resp = post_chat_request(client, url, api_key, body).await?;

        if resp.status().is_success() {
            return Ok(resp);
        }

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();

        if should_retry(status) && attempt + 1 < max_attempts {
            last_err = format!("HTTP {}: {}", status, text);
            let delay = std::time::Duration::from_secs(1 << attempt); // 1s, 2s
            tokio::time::sleep(delay).await;
            continue;
        }

        return Err(format!("HTTP {}: {}", status, text));
    }

    Err(last_err)
}

fn parse_usage(u: &Value) -> Usage {
    let prompt_tokens = u["prompt_tokens"]
        .as_u64()
        .or_else(|| u["input_tokens"].as_u64());
    let completion_tokens = u["completion_tokens"]
        .as_u64()
        .or_else(|| u["output_tokens"].as_u64());
    let cached_tokens = u["cached_tokens"].as_u64().or_else(|| {
        u["prompt_tokens_details"]["cached_tokens"]
            .as_u64()
            .or_else(|| u["input_tokens_details"]["cached_tokens"].as_u64())
    });
    let total_tokens =
        u["total_tokens"]
            .as_u64()
            .or_else(|| match (prompt_tokens, completion_tokens) {
                (Some(prompt), Some(completion)) => Some(prompt + completion),
                _ => None,
            });

    Usage {
        prompt_tokens,
        completion_tokens,
        cached_tokens,
        total_tokens,
    }
}

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
        "stream_options": {
            "include_usage": true
        }
    });
    if let Some(t) = temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(m) = max_tokens {
        body["max_tokens"] = serde_json::json!(m);
    }

    let resp = match post_with_retry(&client, &url, &api_key, &body).await {
        Ok(r) => r,
        Err(e) => {
            // Check if stream_options caused a 400 — remove and retry once
            if e.contains("HTTP 400") && e.to_ascii_lowercase().contains("stream") {
                if let Some(obj) = body.as_object_mut() {
                    obj.remove("stream_options");
                }
                post_with_retry(&client, &url, &api_key, &body).await?
            } else {
                return Err(e);
            }
        }
    };

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
                    usage = Some(parse_usage(u));
                }
            }

            let _ = window.emit(
                "chat-stream",
                StreamChunk {
                    content: full_content.clone(),
                    reasoning: if full_reasoning.is_empty() {
                        None
                    } else {
                        Some(full_reasoning.clone())
                    },
                    done: false,
                    usage: usage.clone(),
                },
            );
        }
    }

    let total_ms = start.elapsed().as_millis() as u64;
    let _ = window.emit(
        "chat-stream",
        StreamChunk {
            content: full_content.clone(),
            reasoning: if full_reasoning.is_empty() {
                None
            } else {
                Some(full_reasoning.clone())
            },
            done: true,
            usage: usage.clone(),
        },
    );
    let _ = window.emit(
        "chat-metrics",
        StreamMetrics {
            first_event_ms: first_event.unwrap_or(0),
            first_token_ms: first_token.unwrap_or(0),
            total_ms,
            tokens_generated: full_content.chars().count() as u64,
        },
    );

    Ok(())
}
