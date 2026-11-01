use tauri::{AppHandle, Runtime};

use super::WatcherService;
use crate::services::ServicesExt;

#[tauri::command]
pub async fn watch_directory<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let watcher = app.service::<WatcherService>();
    tokio::task::spawn_blocking(move || watcher.watch_path(&path))
        .await
        .map_err(|err| format!("Watcher task failed: {err}"))?
}

#[tauri::command]
pub async fn unwatch_directory<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let watcher = app.service::<WatcherService>();
    tokio::task::spawn_blocking(move || watcher.unwatch_path(&path))
        .await
        .map_err(|err| format!("Unwatch task failed: {err}"))?
}
