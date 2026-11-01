use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebouncedEvent, Debouncer, new_debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use super::Service;
use crate::utils::path::{normalize_windows_path, path_to_string};

pub mod commands;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChangedPayload {
    pub directory: String,
}

struct WatcherInner {
    debouncer: Option<Debouncer<RecommendedWatcher>>,
    watched_dirs: HashSet<PathBuf>,
}

pub struct WatcherService {
    inner: Mutex<WatcherInner>,
}

impl Service for WatcherService {
    const NAME: &'static str = "watcher";

    fn init<R: Runtime>(app: &AppHandle<R>) -> Self {
        let app_handle = app.clone();
        let debouncer = new_debouncer(
            Duration::from_millis(200),
            move |res: Result<Vec<DebouncedEvent>, notify::Error>| {
                if let Ok(events) = res {
                    let mut notified = HashSet::new();
                    for event in events {
                        let affected_dir = event
                            .path
                            .parent()
                            .map(normalize_windows_path)
                            .unwrap_or_else(|| normalize_windows_path(&event.path));
                        let dir_str = path_to_string(&affected_dir);
                        if notified.insert(dir_str.clone()) {
                            let _ = app_handle
                                .emit("fs-changed", FsChangedPayload { directory: dir_str });
                        }
                    }
                }
            },
        )
        .ok();

        Self {
            inner: Mutex::new(WatcherInner {
                debouncer,
                watched_dirs: HashSet::new(),
            }),
        }
    }
}

impl WatcherService {
    pub fn watch_path(&self, raw_path: &str) -> Result<(), String> {
        let target = normalize_windows_path(Path::new(raw_path));
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "Failed to lock watcher state".to_string())?;

        if guard.watched_dirs.contains(&target) {
            return Ok(());
        }

        if let Some(debouncer) = guard.debouncer.as_mut() {
            debouncer
                .watcher()
                .watch(&target, RecursiveMode::NonRecursive)
                .map_err(|err| format!("Failed to watch '{}': {err}", target.display()))?;
            guard.watched_dirs.insert(target);
        }

        Ok(())
    }

    pub fn unwatch_path(&self, raw_path: &str) -> Result<(), String> {
        let target = normalize_windows_path(Path::new(raw_path));
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "Failed to lock watcher state".to_string())?;

        if guard.watched_dirs.remove(&target)
            && let Some(debouncer) = guard.debouncer.as_mut()
        {
            let _ = debouncer.watcher().unwatch(&target);
        }

        Ok(())
    }
}
