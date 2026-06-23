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

    // Existing installations predate structured web-search metadata. SQLite does
    // not support `ADD COLUMN IF NOT EXISTS`, so inspect the schema first.
    let has_search_metadata = {
        let mut stmt = conn.prepare("PRAGMA table_info(messages)")?;
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(Result::ok)
            .collect();
        columns.iter().any(|name| name == "search_metadata_json")
    };
    if !has_search_metadata {
        conn.execute(
            "ALTER TABLE messages ADD COLUMN search_metadata_json TEXT",
            [],
        )?;
    }

    app.manage(DbConn(Mutex::new(conn)));
    Ok(())
}
