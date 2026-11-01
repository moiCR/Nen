use std::cmp::Ordering;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::time::{Duration, Instant, UNIX_EPOCH};

use jwalk::WalkDir;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use super::Service;
use super::ServicesExt;
use super::icon_cache::IconCacheService;
use crate::utils::path::{
    is_hidden_or_system, normalize_windows_path, parent_path_string, path_to_string,
};

pub mod commands;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub extension: String,
    pub path: String,
    pub is_dir: bool,
    pub is_hidden: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySnapshot {
    pub path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<FileEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchProgressPayload {
    pub search_id: u64,
    pub entries: Vec<FileEntry>,
    pub total_found: usize,
    pub done: bool,
}

pub struct SearchParams {
    pub search_id: u64,
    pub root_path: String,
    pub query: String,
    pub show_hidden: bool,
    pub max_results: Option<usize>,
}

const SEARCH_BATCH_SIZE: usize = 50;
const SEARCH_FLUSH_INTERVAL: Duration = Duration::from_millis(40);
const DEFAULT_MAX_SEARCH_RESULTS: usize = 1000;

pub struct FsScannerService {
    scan_generation: AtomicU64,
    search_generation: AtomicU64,
}

impl Service for FsScannerService {
    const NAME: &'static str = "fs_scanner";

    fn init<R: Runtime>(_app: &AppHandle<R>) -> Self {
        Self {
            scan_generation: AtomicU64::new(0),
            search_generation: AtomicU64::new(0),
        }
    }
}

impl FsScannerService {
    pub fn allocate_search_id(&self) -> u64 {
        self.search_generation.fetch_add(1, AtomicOrdering::SeqCst) + 1
    }

    pub fn cancel_active_search(&self) {
        self.search_generation.fetch_add(1, AtomicOrdering::SeqCst);
    }

    pub fn current_search_id(&self) -> u64 {
        self.search_generation.load(AtomicOrdering::SeqCst)
    }

    fn extract_extension(path: &Path, is_dir: bool) -> String {
        if is_dir {
            return String::new();
        }
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_lowercase)
            .unwrap_or_default()
    }

    fn extract_file_size(metadata: &fs::Metadata, is_dir: bool) -> u64 {
        if is_dir {
            return 0;
        }
        metadata.len()
    }

    pub fn read_directory(
        &self,
        raw_path: &str,
        show_hidden: bool,
        icon_cache: &IconCacheService,
    ) -> Result<DirectorySnapshot, String> {
        self.scan_generation.fetch_add(1, AtomicOrdering::Relaxed);

        let target = normalize_windows_path(Path::new(raw_path));
        if !target.exists() {
            return Err(format!("Path does not exist: {}", target.display()));
        }
        if !target.is_dir() {
            return Err(format!("Path is not a directory: {}", target.display()));
        }

        let read_dir = fs::read_dir(&target)
            .map_err(|err| format!("Unable to read '{}': {err}", target.display()))?;

        let mut entries = Vec::new();

        for item in read_dir {
            let Ok(entry) = item else {
                continue;
            };
            let entry_path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };

            let is_hidden = is_hidden_or_system(&entry_path, &metadata);
            if is_hidden && !show_hidden {
                continue;
            }

            let is_dir = metadata.is_dir();
            let name = entry.file_name().to_string_lossy().into_owned();
            let extension = Self::extract_extension(&entry_path, is_dir);

            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .and_then(|dur| u64::try_from(dur.as_millis()).ok());

            let size = Self::extract_file_size(&metadata, is_dir);
            let path_str = path_to_string(&entry_path);
            let icon = icon_cache.get_cached(&path_str, &extension, is_dir);

            entries.push(FileEntry {
                name,
                extension,
                path: path_str,
                is_dir,
                is_hidden,
                size,
                modified,
                icon,
            });
        }

        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            _ => natord::compare_ignore_case(&a.name, &b.name),
        });

        Ok(DirectorySnapshot {
            path: path_to_string(&target),
            parent_path: parent_path_string(&target),
            entries,
        })
    }

    pub fn run_recursive_search<R: Runtime>(&self, app: &AppHandle<R>, params: SearchParams) {
        let icon_cache = app.service::<IconCacheService>();
        let search_id = params.search_id;
        let show_hidden = params.show_hidden;
        let root = normalize_windows_path(Path::new(&params.root_path));
        let query_lower = params.query.trim().to_lowercase();
        let limit = params.max_results.unwrap_or(DEFAULT_MAX_SEARCH_RESULTS);

        if query_lower.is_empty() || !root.exists() {
            let _ = app.emit(
                "search-progress",
                SearchProgressPayload {
                    search_id,
                    entries: Vec::new(),
                    total_found: 0,
                    done: true,
                },
            );
            return;
        }

        let walker = WalkDir::new(&root)
            .skip_hidden(!show_hidden)
            .min_depth(1)
            .follow_links(false);

        let mut batch = Vec::with_capacity(SEARCH_BATCH_SIZE);
        let mut total_found = 0usize;
        let mut last_flush = Instant::now();

        for dir_entry_res in walker {
            if self.current_search_id() != search_id {
                return;
            }

            let Ok(dir_entry) = dir_entry_res else {
                continue;
            };

            let name = dir_entry.file_name().to_string_lossy();
            if !name.to_lowercase().contains(&query_lower) {
                continue;
            }

            let entry_path = dir_entry.path();
            let Ok(metadata) = dir_entry.metadata() else {
                continue;
            };

            let is_hidden = is_hidden_or_system(&entry_path, &metadata);
            if is_hidden && !show_hidden {
                continue;
            }

            let is_dir = metadata.is_dir();
            let extension = Self::extract_extension(&entry_path, is_dir);

            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .and_then(|dur| u64::try_from(dur.as_millis()).ok());

            let size = Self::extract_file_size(&metadata, is_dir);
            let path_str = path_to_string(&entry_path);
            let icon = icon_cache.get_cached(&path_str, &extension, is_dir);

            batch.push(FileEntry {
                name: name.into_owned(),
                extension,
                path: path_str,
                is_dir,
                is_hidden,
                size,
                modified,
                icon,
            });
            total_found += 1;

            if total_found >= limit {
                break;
            }

            if batch.len() >= SEARCH_BATCH_SIZE || last_flush.elapsed() >= SEARCH_FLUSH_INTERVAL {
                if self.current_search_id() != search_id {
                    return;
                }
                let outgoing = std::mem::replace(&mut batch, Vec::with_capacity(SEARCH_BATCH_SIZE));
                let _ = app.emit(
                    "search-progress",
                    SearchProgressPayload {
                        search_id,
                        entries: outgoing,
                        total_found,
                        done: false,
                    },
                );
                last_flush = Instant::now();
            }
        }

        if self.current_search_id() == search_id {
            let _ = app.emit(
                "search-progress",
                SearchProgressPayload {
                    search_id,
                    entries: batch,
                    total_found,
                    done: true,
                },
            );
        }
    }
}
