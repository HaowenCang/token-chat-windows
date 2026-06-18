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
