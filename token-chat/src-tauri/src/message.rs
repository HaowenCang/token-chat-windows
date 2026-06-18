use crate::db::DbConn;
use rusqlite::params;
use serde::Serialize;
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
pub fn list_messages(
    db: State<'_, DbConn>,
    conversation_id: String,
) -> Result<Vec<Message>, String> {
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
pub fn save_user_message(
    db: State<'_, DbConn>,
    conversation_id: String,
    content: String,
) -> Result<Message, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let content_json = serde_json::json!({"text": content}).to_string();
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content_json, status, created_at) VALUES (?1, ?2, 'user', ?3, 'completed', ?4)",
        params![id, conversation_id, content_json, now],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now, conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(Message {
        id,
        conversation_id,
        parent_message_id: None,
        role: "user".to_string(),
        content_json,
        reasoning_content: None,
        provider_id: None,
        provider_name: None,
        model_id: None,
        model_name: None,
        status: "completed".to_string(),
        attachments_json: None,
        tool_calls_json: None,
        error: None,
        created_at: now,
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
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now, conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(Message {
        id,
        conversation_id,
        parent_message_id: None,
        role: "assistant".to_string(),
        content_json,
        reasoning_content: reasoning,
        provider_id: Some(provider_id),
        provider_name: Some(provider_name),
        model_id: Some(model_id),
        model_name: Some(model_name),
        status,
        attachments_json: None,
        tool_calls_json: None,
        error: None,
        created_at: now,
    })
}
