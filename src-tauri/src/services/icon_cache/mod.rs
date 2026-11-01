use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;
use std::sync::RwLock;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use file_icon_provider::get_file_icon;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use super::Service;
use crate::utils::path::normalize_windows_path;

pub mod commands;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconRequest {
    pub path: String,
    pub extension: String,
    pub is_dir: bool,
}

pub struct IconCacheService {
    cache: RwLock<HashMap<String, String>>,
}

impl Service for IconCacheService {
    const NAME: &'static str = "icon_cache";

    fn init<R: Runtime>(_app: &AppHandle<R>) -> Self {
        Self {
            cache: RwLock::new(HashMap::with_capacity(256)),
        }
    }
}

impl IconCacheService {
    pub fn cache_key(path: &str, extension: &str, is_dir: bool) -> String {
        if is_dir {
            let clean = path
                .replace('/', "\\")
                .trim_end_matches('\\')
                .to_ascii_lowercase();
            return format!("dir:{clean}");
        }

        let ext = extension.trim().to_ascii_lowercase();
        if matches!(
            ext.as_str(),
            "exe" | "lnk" | "ico" | "url" | "msi" | "scr" | "appref-ms"
        ) {
            return format!("path:{}", path.replace('/', "\\").to_ascii_lowercase());
        }

        if !ext.is_empty() {
            return format!("ext:{ext}");
        }

        "__file__".to_string()
    }

    pub fn get_cached(&self, path: &str, extension: &str, is_dir: bool) -> Option<String> {
        let key = Self::cache_key(path, extension, is_dir);
        self.cache.read().ok()?.get(&key).cloned()
    }

    pub fn resolve_batch(&self, requests: Vec<IconRequest>) -> HashMap<String, String> {
        let mut results = HashMap::with_capacity(requests.len());
        let mut missing_by_key: HashMap<String, Vec<String>> = HashMap::new();
        let mut sample_path_for_key: HashMap<String, String> = HashMap::new();

        if let Ok(guard) = self.cache.read() {
            for req in requests {
                let key = Self::cache_key(&req.path, &req.extension, req.is_dir);
                if let Some(cached_uri) = guard.get(&key) {
                    results.insert(req.path, cached_uri.clone());
                    continue;
                }
                sample_path_for_key
                    .entry(key.clone())
                    .or_insert_with(|| req.path.clone());
                missing_by_key.entry(key).or_default().push(req.path);
            }
        }

        if missing_by_key.is_empty() {
            return results;
        }

        let mut newly_extracted: HashMap<String, String> = HashMap::new();

        for (key, sample_path) in sample_path_for_key {
            if let Some(data_uri) = Self::extract_icon_data_uri(&sample_path) {
                newly_extracted.insert(key, data_uri);
            }
        }

        if !newly_extracted.is_empty() {
            if let Ok(mut guard) = self.cache.write() {
                for (key, uri) in &newly_extracted {
                    guard.insert(key.clone(), uri.clone());
                }
            }

            for (key, paths) in missing_by_key {
                if let Some(uri) = newly_extracted.get(&key) {
                    for p in paths {
                        results.insert(p, uri.clone());
                    }
                }
            }
        }

        results
    }

    fn extract_icon_data_uri(raw_path: &str) -> Option<String> {
        let target = normalize_windows_path(Path::new(raw_path));
        let icon = get_file_icon(&target, 32).ok()?;
        if icon.width == 0 || icon.height == 0 || icon.pixels.is_empty() {
            return None;
        }

        let mut png_bytes = Vec::with_capacity(2048);
        let encoder = PngEncoder::new(Cursor::new(&mut png_bytes));
        encoder
            .write_image(
                &icon.pixels,
                icon.width,
                icon.height,
                ExtendedColorType::Rgba8,
            )
            .ok()?;

        let encoded = BASE64_STANDARD.encode(&png_bytes);
        Some(format!("data:image/png;base64,{encoded}"))
    }
}
