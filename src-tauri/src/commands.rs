//! Tauri commands exposed to the frontend via IPC.
//!
//! Each command here must be typed and must not leak implementation
//! details (no business logic in the UI, per docs/PLAN.md).

use tauri::Manager;

/// Writes `transcript_content` to `filename` inside the given directory and
/// returns the absolute path of the written file.
///
/// Extracted from [`save_transcript`] so it can be unit-tested without a
/// real [`tauri::AppHandle`] (Documents dir resolution requires a running
/// Tauri app context).
fn write_transcript_to_dir(dir: &std::path::Path, filename: &str, transcript_content: &str) -> Result<String, String> {
    let path = dir.join(filename);

    std::fs::write(&path, transcript_content).map_err(|err| format!("Failed to write transcript file: {err}"))?;

    Ok(path.to_string_lossy().into_owned())
}

/// Saves the transcript to a file in the current user's Documents
/// directory.
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
#[allow(clippy::needless_pass_by_value)]
pub fn save_transcript(app: tauri::AppHandle, transcript_content: String, filename: String) -> Result<String, String> {
    let dir = app
        .path()
        .document_dir()
        .map_err(|err| format!("Failed to resolve Documents directory: {err}"))?;

    write_transcript_to_dir(&dir, &filename, &transcript_content)
}

#[cfg(test)]
mod tests {
    use super::write_transcript_to_dir;
    use std::fs;

    #[test]
    fn writes_transcript_file_and_returns_its_path() {
        let dir = std::env::temp_dir().join(format!("tauri_kit_test_{}", std::process::id()));
        fs::create_dir_all(&dir).expect("failed to create temp dir");

        let result = write_transcript_to_dir(&dir, "transcript-test.txt", "hello world");

        let path = result.expect("save_transcript should succeed");
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello world");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn returns_error_when_directory_does_not_exist() {
        let dir = std::env::temp_dir().join("tauri_kit_test_nonexistent_dir_xyz");
        fs::remove_dir_all(&dir).ok();

        let result = write_transcript_to_dir(&dir, "transcript-test.txt", "hello world");

        assert!(result.is_err());
    }
}
