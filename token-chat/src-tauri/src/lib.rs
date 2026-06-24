mod chat;
mod conversation;
mod db;
mod message;
mod prompt;
mod provider;
mod stats;
mod web_search;

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

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
            conversation::list_conversations,
            conversation::create_conversation,
            conversation::delete_conversation,
            conversation::update_conversation_title,
            conversation::update_conversation_model,
            message::list_messages,
            message::save_user_message,
            message::save_assistant_message,
            provider::list_providers,
            provider::create_provider,
            provider::update_provider,
            provider::get_provider_api_key,
            provider::delete_provider,
            provider::list_models,
            provider::create_model,
            provider::update_model,
            provider::delete_model,
            provider::test_provider,
            provider::discover_models,
            chat::send_message,
            chat::cancel_generation,
            web_search::get_search_config,
            web_search::save_search_config,
            web_search::test_search_connection,
            web_search::search_web,
            web_search::cancel_search,
            prompt::get_builtin_prompt,
            stats::record_generation_run,
            stats::get_conversation_token_usage,
            stats::get_stats_summary,
            stats::get_stats_by_model,
            stats::get_stats_daily_costs,
            stats::get_stats_by_conversation,
            read_file_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
