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
pub fn create_conversation(
    db: State<'_, DbConn>,
    input: CreateConversation,
) -> Result<Conversation, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let title = input.title.unwrap_or_else(|| "新对话".to_string());
    conn.execute(
        "INSERT INTO conversations (id, title, provider_id, model_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, title, input.provider_id, input.model_id, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(Conversation {
        id,
        title,
        provider_id: input.provider_id,
        model_id: input.model_id,
        parent_conversation_id: None,
        folder: None,
        tags: None,
        pinned_at: None,
        archived_at: None,
        created_at: now,
        updated_at: now,
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
pub fn update_conversation_title(
    db: State<'_, DbConn>,
    id: String,
    title: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_conversation_model(
    db: State<'_, DbConn>,
    id: String,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE conversations SET provider_id = ?1, model_id = ?2, updated_at = ?3 WHERE id = ?4",
        params![provider_id, model_id, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
