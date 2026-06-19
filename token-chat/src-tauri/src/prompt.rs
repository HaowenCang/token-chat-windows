#[tauri::command]
pub fn get_builtin_prompt() -> String {
    include_str!("../../../prompt.txt").to_string()
}
