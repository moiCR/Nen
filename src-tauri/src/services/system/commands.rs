use tauri::{AppHandle, Runtime};

use super::{DriveInfo, SystemPlace, SystemService};
use crate::services::ServicesExt;

#[tauri::command]
pub async fn get_system_places<R: Runtime>(app: AppHandle<R>) -> Result<Vec<SystemPlace>, String> {
    let service = app.service::<SystemService>();
    Ok(service.places())
}

#[tauri::command]
pub async fn get_drives<R: Runtime>(
    app: AppHandle<R>,
    refresh: Option<bool>,
) -> Result<Vec<DriveInfo>, String> {
    let service = app.service::<SystemService>();
    let should_refresh = refresh.unwrap_or(false);
    tokio::task::spawn_blocking(move || service.drives(should_refresh))
        .await
        .map_err(|err| format!("Failed to join drive task: {err}"))?
}
