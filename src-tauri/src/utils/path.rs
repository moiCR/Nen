use std::fs::Metadata;
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
use std::os::windows::fs::MetadataExt;

#[cfg(target_os = "windows")]
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
#[cfg(target_os = "windows")]
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;

pub fn normalize_windows_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    let stripped = raw.strip_prefix(r"\\?\").unwrap_or(&raw);
    PathBuf::from(stripped)
}

pub fn path_to_string(path: &Path) -> String {
    normalize_windows_path(path).to_string_lossy().into_owned()
}

pub fn is_hidden_or_system(path: &Path, metadata: &Metadata) -> bool {
    if let Some(name) = path.file_name().and_then(|n| n.to_str())
        && name.starts_with('.')
    {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        let attrs = metadata.file_attributes();
        (attrs & FILE_ATTRIBUTE_HIDDEN) != 0 || (attrs & FILE_ATTRIBUTE_SYSTEM) != 0
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = metadata;
        false
    }
}

pub fn parent_path_string(path: &Path) -> Option<String> {
    let normalized = normalize_windows_path(path);
    let parent = normalized.parent()?;
    if parent.as_os_str().is_empty() || parent == normalized {
        return None;
    }
    Some(path_to_string(parent))
}
