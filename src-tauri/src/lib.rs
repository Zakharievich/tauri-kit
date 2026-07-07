use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

/// Saves the transcript (and optional summary, already embedded in
/// `content`) to a `.txt` file in the user's Documents directory.
///
/// Never touches the network and never keeps a copy anywhere else — the
/// transcript is written **only** locally on the participant's machine
/// (docs/PLAN.md, HIGH RISK 4.3).
///
/// # Errors
///
/// Returns a stringified error if the Documents directory cannot be
/// resolved or the file cannot be written.
#[tauri::command]
fn save_transcript(app: tauri::AppHandle, content: String, file_name: String) -> Result<String, String> {
    let dir = app
        .path()
        .document_dir()
        .map_err(|err| format!("Failed to resolve Documents directory: {err}"))?;

    let path = dir.join(file_name);

    std::fs::write(&path, content).map_err(|err| format!("Failed to write transcript file: {err}"))?;

    Ok(path.to_string_lossy().into_owned())
}

/// Runs the Tauri application.
///
/// # Panics
///
/// Panics if the Tauri application fails to start.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, save_transcript])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


