use serde::Serialize;
use std::sync::Mutex;
use sysinfo::Disks;
use tauri::{AppHandle, Runtime};

use super::Service;
use crate::utils::path::path_to_string;

pub mod commands;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPlace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub icon: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub total_space: u64,
    pub available_space: u64,
    pub is_removable: bool,
}

pub struct SystemService {
    places: Vec<SystemPlace>,
    disks: Mutex<Option<Disks>>,
}

impl Service for SystemService {
    const NAME: &'static str = "system";

    fn init<R: Runtime>(_app: &AppHandle<R>) -> Self {
        let places = Self::collect_system_places();
        let disks = Disks::new_with_refreshed_list().ok();
        Self {
            places,
            disks: Mutex::new(disks),
        }
    }
}

impl SystemService {
    fn collect_system_places() -> Vec<SystemPlace> {
        let mut places = Vec::with_capacity(6);

        if let Some(path) = dirs::home_dir() {
            places.push(SystemPlace {
                id: "home".to_string(),
                name: "Home".to_string(),
                path: path_to_string(&path),
                icon: "home".to_string(),
            });
        }

        if let Some(path) = dirs::desktop_dir() {
            places.push(SystemPlace {
                id: "desktop".to_string(),
                name: "Desktop".to_string(),
                path: path_to_string(&path),
                icon: "monitor".to_string(),
            });
        }

        if let Some(path) = dirs::download_dir() {
            places.push(SystemPlace {
                id: "downloads".to_string(),
                name: "Downloads".to_string(),
                path: path_to_string(&path),
                icon: "download".to_string(),
            });
        }

        if let Some(path) = dirs::document_dir() {
            places.push(SystemPlace {
                id: "documents".to_string(),
                name: "Documents".to_string(),
                path: path_to_string(&path),
                icon: "file-text".to_string(),
            });
        }

        if let Some(path) = dirs::picture_dir() {
            places.push(SystemPlace {
                id: "pictures".to_string(),
                name: "Pictures".to_string(),
                path: path_to_string(&path),
                icon: "image".to_string(),
            });
        }

        if let Some(path) = dirs::video_dir() {
            places.push(SystemPlace {
                id: "videos".to_string(),
                name: "Videos".to_string(),
                path: path_to_string(&path),
                icon: "film".to_string(),
            });
        }

        places
    }

    pub fn places(&self) -> Vec<SystemPlace> {
        self.places.clone()
    }

    fn format_drive_name(raw_name: &str) -> String {
        let trimmed = raw_name.trim();
        if trimmed.is_empty() {
            return "Local Disk".to_string();
        }
        trimmed.to_string()
    }

    pub fn drives(&self, refresh: bool) -> Result<Vec<DriveInfo>, String> {
        let mut guard = self
            .disks
            .lock()
            .map_err(|_| "Failed to acquire disks lock".to_string())?;

        if refresh && let Some(disks) = guard.as_mut() {
            disks.refresh(true);
        }

        if guard.is_none() {
            *guard = Some(
                Disks::new_with_refreshed_list()
                    .map_err(|err| format!("Failed to initialize disks: {err}"))?,
            );
        }

        let Some(disks) = guard.as_ref() else {
            return Ok(Vec::new());
        };

        let mut list: Vec<DriveInfo> = disks
            .iter()
            .map(|disk| {
                let mount_point = path_to_string(disk.mount_point());
                let name = Self::format_drive_name(&disk.name().to_string_lossy());

                DriveInfo {
                    name,
                    mount_point,
                    file_system: disk.file_system().to_string_lossy().into_owned(),
                    total_space: disk.total_space(),
                    available_space: disk.available_space(),
                    is_removable: disk.is_removable(),
                }
            })
            .collect();

        list.sort_by(|a, b| a.mount_point.cmp(&b.mount_point));
        Ok(list)
    }
}
