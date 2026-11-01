use std::collections::HashMap;
use tauri::{AppHandle, Runtime};

use super::{IconCacheService, IconRequest};
use crate::services::ServicesExt;

#[tauri::command]
pub async fn get_icons_batch<R: Runtime>(
    app: AppHandle<R>,
    requests: Vec<IconRequest>,
) -> Result<HashMap<String, String>, String> {
    let icon_cache = app.service::<IconCacheService>();
    tokio::task::spawn_blocking(move || icon_cache.resolve_batch(requests))
        .await
        .map_err(|err| format!("Icon extraction task failed: {err}"))
}
