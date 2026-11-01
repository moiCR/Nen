use tauri::{AppHandle, Runtime};

use super::{DirectorySnapshot, FsScannerService, SearchParams};
use crate::services::ServicesExt;
use crate::services::icon_cache::IconCacheService;

#[tauri::command]
pub async fn list_directory<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    show_hidden: Option<bool>,
) -> Result<DirectorySnapshot, String> {
    let scanner = app.service::<FsScannerService>();
    let icon_cache = app.service::<IconCacheService>();
    let include_hidden = show_hidden.unwrap_or(false);

    tokio::task::spawn_blocking(move || scanner.read_directory(&path, include_hidden, &icon_cache))
        .await
        .map_err(|err| format!("Directory scan task failed: {err}"))?
}

#[tauri::command]
pub async fn start_search<R: Runtime>(
    app: AppHandle<R>,
    root_path: String,
    query: String,
    show_hidden: Option<bool>,
    max_results: Option<usize>,
) -> Result<u64, String> {
    let scanner = app.service::<FsScannerService>();
    let search_id = scanner.allocate_search_id();
    let params = SearchParams {
        search_id,
        root_path,
        query,
        show_hidden: show_hidden.unwrap_or(false),
        max_results,
    };
    let app_handle = app.clone();

    tokio::task::spawn_blocking(move || {
        scanner.run_recursive_search(&app_handle, params);
    });

    Ok(search_id)
}

#[tauri::command]
pub async fn cancel_search<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let scanner = app.service::<FsScannerService>();
    scanner.cancel_active_search();
    Ok(())
}
