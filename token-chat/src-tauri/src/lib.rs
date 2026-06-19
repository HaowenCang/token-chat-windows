mod chat;
mod conversation;
mod db;
mod message;
mod prompt;
mod provider;
mod stats;

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
            prompt::get_builtin_prompt,
            stats::record_generation_run,
            stats::get_conversation_token_usage,
            stats::get_stats_summary,
            stats::get_stats_by_model,
            stats::get_stats_daily_costs,
            stats::get_stats_by_conversation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
