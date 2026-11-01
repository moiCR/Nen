use std::fs::{self, OpenOptions};
use std::path::Path;

use crate::utils::path::{normalize_windows_path, path_to_string};

#[tauri::command]
pub async fn create_dir(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let target = normalize_windows_path(Path::new(&path));
        fs::create_dir_all(&target)
            .map_err(|err| format!("Failed to create directory '{}': {err}", target.display()))?;
        Ok(path_to_string(&target))
    })
    .await
    .map_err(|err| format!("Create directory task failed: {err}"))?
}

#[tauri::command]
pub async fn create_empty_file(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let target = normalize_windows_path(Path::new(&path));
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|err| format!("Failed to create file '{}': {err}", target.display()))?;
        Ok(path_to_string(&target))
    })
    .await
    .map_err(|err| format!("Create file task failed: {err}"))?
}

#[tauri::command]
pub async fn rename_entry(from: String, to: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let src = normalize_windows_path(Path::new(&from));
        let dst = normalize_windows_path(Path::new(&to));
        fs::rename(&src, &dst).map_err(|err| {
            format!(
                "Failed to rename '{}' to '{}': {err}",
                src.display(),
                dst.display()
            )
        })?;
        Ok(path_to_string(&dst))
    })
    .await
    .map_err(|err| format!("Rename task failed: {err}"))?
}

#[tauri::command]
pub async fn delete_to_trash(paths: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let normalized: Vec<_> = paths
            .iter()
            .map(|p| normalize_windows_path(Path::new(p)))
            .collect();
        trash::delete_all(&normalized)
            .map_err(|err| format!("Failed to move to Recycle Bin: {err}"))
    })
    .await
    .map_err(|err| format!("Trash task failed: {err}"))?
}
