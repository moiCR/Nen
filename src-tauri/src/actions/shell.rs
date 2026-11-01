use std::collections::HashMap;
use std::ffi::OsStr;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, OnceLock};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder};
use serde::Serialize;
use tauri::{AppHandle, Runtime};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC,
    GetDIBits, GetObjectW, HBITMAP,
};
use windows::Win32::System::Com::{
    COINIT_APARTMENTTHREADED, CoInitializeEx, CoTaskMemFree, CoUninitialize,
};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    CMF_EXPLORE, CMF_NORMAL, CMINVOKECOMMANDINFO, IContextMenu, IContextMenu2, ILCreateFromPathW,
    IShellFolder, SHBindToParent,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreatePopupMenu, DestroyMenu, GetMenuItemCount, GetMenuItemInfoW, HMENU, MENUITEMINFOW,
    MFS_DISABLED, MFS_GRAYED, MFT_SEPARATOR, MIIM_BITMAP, MIIM_FTYPE, MIIM_ID, MIIM_STATE,
    MIIM_STRING, MIIM_SUBMENU, SW_SHOWNORMAL, WM_INITMENUPOPUP,
};
use windows::core::{Interface, PCSTR, PCWSTR, PWSTR};

use crate::services::ServicesExt;
use crate::services::icon_cache::{IconCacheService, IconRequest};
use crate::utils::path::{normalize_windows_path, path_to_string};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const FIRST_CMD_ID: u32 = 1;
const LAST_CMD_ID: u32 = 0x7FFF;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellMenuItem {
    pub id: String,
    pub menu_index: u32,
    pub cmd_id: Option<u32>,
    pub custom_action: Option<String>,
    pub label: String,
    pub is_separator: bool,
    pub disabled: bool,
    pub has_submenu: bool,
    pub icon: Option<String>,
    pub children: Vec<ShellMenuItem>,
}

struct PackagedBinaries {
    wt: Option<PathBuf>,
    nanazip_gui: Option<PathBuf>,
    nanazip_fm: Option<PathBuf>,
}

static PACKAGED_BINARIES: OnceLock<PackagedBinaries> = OnceLock::new();
static SHELL_WORKER: OnceLock<Mutex<Sender<WorkerCommand>>> = OnceLock::new();

fn packaged_binaries() -> &'static PackagedBinaries {
    PACKAGED_BINARIES.get_or_init(|| PackagedBinaries {
        wt: find_windows_app_binary("wt.exe"),
        nanazip_gui: find_windows_app_binary("NanaZipG.exe"),
        nanazip_fm: find_windows_app_binary("NanaZip.Windows.exe")
            .or_else(|| find_windows_app_binary("NanaZipF.exe")),
    })
}

enum WorkerCommand {
    OpenMenu {
        target: PathBuf,
        reply: Sender<Result<Vec<ShellMenuItem>, String>>,
    },
    ExpandSubmenu {
        menu_path: Vec<u32>,
        reply: Sender<Result<Vec<ShellMenuItem>, String>>,
    },
    InvokeCmd {
        target: PathBuf,
        cmd_id: u32,
        reply: Sender<Result<(), String>>,
    },
}

struct ActiveShellSession {
    target: PathBuf,
    pidl: *mut ITEMIDLIST,
    hmenu: HMENU,
    context_menu: IContextMenu,
    cm2: Option<IContextMenu2>,
    initialized_submenus: Vec<isize>,
}

impl Drop for ActiveShellSession {
    fn drop(&mut self) {
        unsafe {
            if !self.hmenu.is_invalid() && !self.hmenu.0.is_null() {
                let _ = DestroyMenu(self.hmenu);
            }
            if !self.pidl.is_null() {
                CoTaskMemFree(Some(self.pidl.cast()));
            }
        }
    }
}

fn get_worker_sender() -> Result<Sender<WorkerCommand>, String> {
    let lock = SHELL_WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<WorkerCommand>();
        std::thread::spawn(move || {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            }
            let mut active_session: Option<ActiveShellSession> = None;
            let mut bitmap_cache: HashMap<u64, String> = HashMap::with_capacity(128);

            while let Ok(cmd) = rx.recv() {
                match cmd {
                    WorkerCommand::OpenMenu { target, reply } => {
                        active_session = None;
                        let res = unsafe { create_menu_session(&target, &mut bitmap_cache) };
                        match res {
                            Ok((session, items)) => {
                                active_session = Some(session);
                                let _ = reply.send(Ok(items));
                            }
                            Err(err) => {
                                let _ = reply.send(Err(err));
                            }
                        }
                    }
                    WorkerCommand::ExpandSubmenu { menu_path, reply } => {
                        let Some(session) = active_session.as_mut() else {
                            let _ = reply.send(Err("No active shell menu session".to_string()));
                            continue;
                        };
                        let res = unsafe {
                            expand_session_submenu(session, &menu_path, &mut bitmap_cache)
                        };
                        let _ = reply.send(res);
                    }
                    WorkerCommand::InvokeCmd {
                        target,
                        cmd_id,
                        reply,
                    } => {
                        let res = unsafe {
                            invoke_on_session(
                                &mut active_session,
                                &target,
                                cmd_id,
                                &mut bitmap_cache,
                            )
                        };
                        active_session = None;
                        let _ = reply.send(res);
                    }
                }
            }

            drop(active_session);
            unsafe {
                CoUninitialize();
            }
        });
        Mutex::new(tx)
    });

    lock.lock()
        .map(|tx| tx.clone())
        .map_err(|_| "Failed to lock shell worker".to_string())
}

#[tauri::command]
pub async fn open_item(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let target = normalize_windows_path(Path::new(&path));
        open::that_detached(&target)
            .map_err(|err| format!("Failed to open '{}': {err}", target.display()))
    })
    .await
    .map_err(|err| format!("Open task failed: {err}"))?
}

#[tauri::command]
pub async fn get_shell_context_menu<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    is_background: bool,
) -> Result<Vec<ShellMenuItem>, String> {
    let icon_cache = app.service::<IconCacheService>();
    tokio::task::spawn_blocking(move || {
        let target = normalize_windows_path(Path::new(&path));
        let is_dir = target.is_dir();

        if is_background {
            return Ok(build_packaged_extensions_items(
                &target,
                true,
                &[],
                &icon_cache,
            ));
        }

        let sender = get_worker_sender()?;
        let (reply_tx, reply_rx) = mpsc::channel();
        sender
            .send(WorkerCommand::OpenMenu {
                target: target.clone(),
                reply: reply_tx,
            })
            .map_err(|err| format!("Shell worker send error: {err}"))?;

        let items = reply_rx
            .recv()
            .map_err(|err| format!("Shell worker recv error: {err}"))??;

        let extras = build_packaged_extensions_items(&target, is_dir, &items, &icon_cache);
        if extras.is_empty() {
            return Ok(items);
        }

        let mut combined = extras;
        if !items.is_empty() {
            combined.push(ShellMenuItem {
                id: "sep-packaged".to_string(),
                menu_index: u32::MAX,
                cmd_id: None,
                custom_action: None,
                label: String::new(),
                is_separator: true,
                disabled: false,
                has_submenu: false,
                icon: None,
                children: Vec::new(),
            });
            combined.extend(items);
        }
        Ok(combined)
    })
    .await
    .map_err(|err| format!("Context menu task failed: {err}"))?
}

#[tauri::command]
pub async fn expand_shell_submenu(menu_path: Vec<u32>) -> Result<Vec<ShellMenuItem>, String> {
    tokio::task::spawn_blocking(move || {
        let sender = get_worker_sender()?;
        let (reply_tx, reply_rx) = mpsc::channel();
        sender
            .send(WorkerCommand::ExpandSubmenu {
                menu_path,
                reply: reply_tx,
            })
            .map_err(|err| format!("Shell worker send error: {err}"))?;

        reply_rx
            .recv()
            .map_err(|err| format!("Shell worker recv error: {err}"))?
    })
    .await
    .map_err(|err| format!("Expand submenu task failed: {err}"))?
}

#[tauri::command]
pub async fn invoke_shell_context_item(
    path: String,
    cmd_id: Option<u32>,
    custom_action: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let target = normalize_windows_path(Path::new(&path));
        if let Some(action) = custom_action {
            return execute_custom_action(&target, &action);
        }
        let Some(id) = cmd_id else {
            return Err("Missing command identifier".to_string());
        };

        let sender = get_worker_sender()?;
        let (reply_tx, reply_rx) = mpsc::channel();
        sender
            .send(WorkerCommand::InvokeCmd {
                target,
                cmd_id: id,
                reply: reply_tx,
            })
            .map_err(|err| format!("Shell worker send error: {err}"))?;

        reply_rx
            .recv()
            .map_err(|err| format!("Shell worker recv error: {err}"))?
    })
    .await
    .map_err(|err| format!("Invoke context menu failed: {err}"))?
}

unsafe fn create_menu_session(
    target: &Path,
    bitmap_cache: &mut HashMap<u64, String>,
) -> Result<(ActiveShellSession, Vec<ShellMenuItem>), String> {
    let wide_path = to_wide_null(target.as_os_str());
    let pidl = unsafe { ILCreateFromPathW(PCWSTR(wide_path.as_ptr())) };
    if pidl.is_null() {
        return Err(format!("Unable to resolve PIDL for '{}'", target.display()));
    }

    let mut child_pidl: *mut ITEMIDLIST = std::ptr::null_mut();
    let Ok(parent_folder) =
        (unsafe { SHBindToParent::<IShellFolder>(pidl, Some(&raw mut child_pidl)) })
    else {
        unsafe { CoTaskMemFree(Some(pidl.cast())) };
        return Err("SHBindToParent failed".to_string());
    };

    let child_slice = [child_pidl.cast_const()];
    let Ok(context_menu) = (unsafe {
        parent_folder.GetUIObjectOf::<IContextMenu>(HWND::default(), &child_slice, None)
    }) else {
        unsafe { CoTaskMemFree(Some(pidl.cast())) };
        return Err("GetUIObjectOf::<IContextMenu> failed".to_string());
    };

    let Ok(hmenu) = (unsafe { CreatePopupMenu() }) else {
        unsafe { CoTaskMemFree(Some(pidl.cast())) };
        return Err("CreatePopupMenu failed".to_string());
    };

    let query_res = unsafe {
        context_menu.QueryContextMenu(
            hmenu,
            0,
            FIRST_CMD_ID,
            LAST_CMD_ID,
            CMF_NORMAL | CMF_EXPLORE,
        )
    };

    let cm2 = context_menu.cast::<IContextMenu2>().ok();
    let mut items = Vec::new();
    if query_res.is_ok() {
        items = unsafe { extract_single_hmenu_level(hmenu, "root", bitmap_cache) };
    }

    let session = ActiveShellSession {
        target: target.to_path_buf(),
        pidl,
        hmenu,
        context_menu,
        cm2,
        initialized_submenus: Vec::new(),
    };

    Ok((session, items))
}

unsafe fn expand_session_submenu(
    session: &mut ActiveShellSession,
    menu_path: &[u32],
    bitmap_cache: &mut HashMap<u64, String>,
) -> Result<Vec<ShellMenuItem>, String> {
    if menu_path.is_empty() {
        return Ok(Vec::new());
    }

    let mut current_menu = session.hmenu;
    for &pos in menu_path {
        let mut info = MENUITEMINFOW {
            cbSize: u32::try_from(std::mem::size_of::<MENUITEMINFOW>()).unwrap_or(80),
            fMask: MIIM_SUBMENU,
            ..Default::default()
        };
        let ok = unsafe { GetMenuItemInfoW(current_menu, pos, true, &raw mut info) };
        if ok.is_err() || info.hSubMenu.is_invalid() || info.hSubMenu.0.is_null() {
            return Ok(Vec::new());
        }

        let submenu_handle_key = info.hSubMenu.0 as isize;
        if !session.initialized_submenus.contains(&submenu_handle_key) {
            if let Some(cm2) = session.cm2.as_ref() {
                let _ = unsafe {
                    cm2.HandleMenuMsg(
                        WM_INITMENUPOPUP,
                        WPARAM(info.hSubMenu.0 as usize),
                        LPARAM(pos as isize),
                    )
                };
            }
            session.initialized_submenus.push(submenu_handle_key);
        }

        current_menu = info.hSubMenu;
    }

    let prefix = menu_path
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join("-");

    Ok(unsafe { extract_single_hmenu_level(current_menu, &prefix, bitmap_cache) })
}

unsafe fn invoke_on_session(
    active_session: &mut Option<ActiveShellSession>,
    target: &Path,
    cmd_id: u32,
    bitmap_cache: &mut HashMap<u64, String>,
) -> Result<(), String> {
    let needs_new = active_session.as_ref().is_none_or(|s| s.target != target);

    if needs_new {
        let (new_session, _) = unsafe { create_menu_session(target, bitmap_cache)? };
        *active_session = Some(new_session);
    }

    let Some(session) = active_session.as_ref() else {
        return Err("Failed to initialize menu session".to_string());
    };

    let invoke_info = CMINVOKECOMMANDINFO {
        cbSize: u32::try_from(std::mem::size_of::<CMINVOKECOMMANDINFO>()).unwrap_or(56),
        hwnd: HWND::default(),
        lpVerb: PCSTR(usize::try_from(cmd_id).unwrap_or(0) as *const u8),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };

    unsafe {
        session
            .context_menu
            .InvokeCommand(&raw const invoke_info)
            .map_err(|err| format!("InvokeCommand failed: {err}"))
    }
}

unsafe fn extract_single_hmenu_level(
    hmenu: HMENU,
    prefix: &str,
    bitmap_cache: &mut HashMap<u64, String>,
) -> Vec<ShellMenuItem> {
    let count = unsafe { GetMenuItemCount(Some(hmenu)) };
    if count <= 0 {
        return Vec::new();
    }

    let mut items: Vec<ShellMenuItem> = Vec::new();

    for index in 0..count {
        let pos = u32::try_from(index).unwrap_or(0);
        let mut text_buf = vec![0u16; 260];
        let mut info = MENUITEMINFOW {
            cbSize: u32::try_from(std::mem::size_of::<MENUITEMINFOW>()).unwrap_or(80),
            fMask: MIIM_ID | MIIM_FTYPE | MIIM_STATE | MIIM_STRING | MIIM_SUBMENU | MIIM_BITMAP,
            dwTypeData: PWSTR(text_buf.as_mut_ptr()),
            cch: u32::try_from(text_buf.len()).unwrap_or(260),
            ..Default::default()
        };

        let ok = unsafe { GetMenuItemInfoW(hmenu, pos, true, &raw mut info) };
        if ok.is_err() {
            continue;
        }

        if (info.fType & MFT_SEPARATOR)
            != windows::Win32::UI::WindowsAndMessaging::MENU_ITEM_TYPE(0)
        {
            if items.last().is_none_or(|last| last.is_separator) {
                continue;
            }
            items.push(ShellMenuItem {
                id: format!("sep-{prefix}-{index}"),
                menu_index: pos,
                cmd_id: None,
                custom_action: None,
                label: String::new(),
                is_separator: true,
                disabled: false,
                has_submenu: false,
                icon: None,
                children: Vec::new(),
            });
            continue;
        }

        let len = usize::try_from(info.cch).unwrap_or(0).min(text_buf.len());
        let raw_label = String::from_utf16_lossy(&text_buf[..len]);
        let label = clean_menu_label(&raw_label);
        if label.is_empty() {
            continue;
        }

        let disabled = (info.fState & (MFS_DISABLED | MFS_GRAYED))
            != windows::Win32::UI::WindowsAndMessaging::MENU_ITEM_STATE(0);
        let icon = hbitmap_to_data_uri(info.hbmpItem, bitmap_cache);
        let has_submenu = !info.hSubMenu.is_invalid() && !info.hSubMenu.0.is_null();

        let cmd_id = (info.wID >= FIRST_CMD_ID && info.wID <= LAST_CMD_ID)
            .then_some(info.wID - FIRST_CMD_ID);

        if cmd_id.is_none() && !has_submenu {
            continue;
        }

        items.push(ShellMenuItem {
            id: format!("shell-{prefix}-{index}-{}", info.wID),
            menu_index: pos,
            cmd_id,
            custom_action: None,
            label,
            is_separator: false,
            disabled,
            has_submenu,
            icon,
            children: Vec::new(),
        });
    }

    if items.last().is_some_and(|last| last.is_separator) {
        items.pop();
    }

    items
}

fn to_wide_null(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(std::iter::once(0)).collect()
}

fn clean_menu_label(raw: &str) -> String {
    let before_tab = raw.split('\t').next().unwrap_or(raw).trim();
    let mut result = String::with_capacity(before_tab.len());
    let mut chars = before_tab.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '&' {
            if chars.peek() == Some(&'&') {
                result.push('&');
                let _ = chars.next();
            }
            continue;
        }
        result.push(ch);
    }

    if let Some(idx) = result.rfind('(')
        && result.ends_with(')')
        && result.len() - idx <= 4
    {
        return result[..idx].trim().to_string();
    }

    result.trim().to_string()
}

fn hash_pixels(width: u32, height: u32, pixels: &[u8]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    width.hash(&mut hasher);
    height.hash(&mut hasher);
    pixels.hash(&mut hasher);
    hasher.finish()
}

fn hbitmap_to_data_uri(hbmp: HBITMAP, bitmap_cache: &mut HashMap<u64, String>) -> Option<String> {
    if hbmp.is_invalid() || hbmp.0.is_null() {
        return None;
    }

    let hbmp_val = hbmp.0 as isize;
    if (-12..=12).contains(&hbmp_val) {
        return None;
    }

    unsafe {
        let mut bmp = BITMAP::default();
        let written = GetObjectW(
            hbmp.into(),
            i32::try_from(std::mem::size_of::<BITMAP>()).ok()?,
            Some((&raw mut bmp).cast()),
        );
        if written == 0 || bmp.bmWidth <= 0 || bmp.bmHeight == 0 {
            return None;
        }

        let width = u32::try_from(bmp.bmWidth).ok()?;
        let height = bmp.bmHeight.unsigned_abs();
        if width > 128 || height > 128 {
            return None;
        }

        let hdc = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            return None;
        }

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: u32::try_from(std::mem::size_of::<BITMAPINFOHEADER>()).unwrap_or(40),
                biWidth: bmp.bmWidth,
                biHeight: -bmp.bmHeight.abs(),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let lines = GetDIBits(
            hdc,
            hbmp,
            0,
            height,
            Some(pixels.as_mut_ptr().cast()),
            &raw mut bmi,
            DIB_RGB_COLORS,
        );
        let _ = DeleteDC(hdc);

        if lines == 0 {
            return None;
        }

        let digest = hash_pixels(width, height, &pixels);
        if let Some(cached) = bitmap_cache.get(&digest) {
            return Some(cached.clone());
        }

        for chunk in pixels.as_chunks_mut::<4>().0 {
            chunk.swap(0, 2);
        }

        let mut png_bytes = Vec::with_capacity(1024);
        let encoder = PngEncoder::new(Cursor::new(&mut png_bytes));
        encoder
            .write_image(&pixels, width, height, ExtendedColorType::Rgba8)
            .ok()?;

        let uri = format!(
            "data:image/png;base64,{}",
            BASE64_STANDARD.encode(&png_bytes)
        );
        bitmap_cache.insert(digest, uri.clone());
        Some(uri)
    }
}

fn find_windows_app_binary(binary_name: &str) -> Option<PathBuf> {
    let local_app_data = dirs::data_local_dir()?;
    let candidate = local_app_data
        .join("Microsoft")
        .join("WindowsApps")
        .join(binary_name);
    candidate.exists().then_some(candidate)
}

fn resolve_exe_icon(exe_path: &Path, icon_cache: &IconCacheService) -> Option<String> {
    let path_str = path_to_string(exe_path);
    if let Some(cached) = icon_cache.get_cached(&path_str, "exe", false) {
        return Some(cached);
    }
    let resolved = icon_cache.resolve_batch(vec![IconRequest {
        path: path_str.clone(),
        extension: "exe".to_string(),
        is_dir: false,
    }]);
    resolved.get(&path_str).cloned()
}

fn build_packaged_extensions_items(
    target: &Path,
    is_dir: bool,
    existing_items: &[ShellMenuItem],
    icon_cache: &IconCacheService,
) -> Vec<ShellMenuItem> {
    let bins = packaged_binaries();
    let mut extras = Vec::new();

    let has_terminal = existing_items
        .iter()
        .any(|i| i.label.to_lowercase().contains("terminal"));

    if is_dir
        && !has_terminal
        && let Some(wt_path) = bins.wt.as_ref()
    {
        extras.push(ShellMenuItem {
            id: "packaged-wt".to_string(),
            menu_index: u32::MAX,
            cmd_id: None,
            custom_action: Some("open_terminal".to_string()),
            label: "Open in Terminal".to_string(),
            is_separator: false,
            disabled: false,
            has_submenu: false,
            icon: resolve_exe_icon(wt_path, icon_cache),
            children: Vec::new(),
        });
    }

    let has_nanazip = existing_items
        .iter()
        .any(|i| i.label.to_lowercase().contains("nanazip"));

    if !has_nanazip && let Some(nanazip_gui) = bins.nanazip_gui.as_ref() {
        let icon = resolve_exe_icon(nanazip_gui, icon_cache);
        let stem = target
            .file_stem()
            .or_else(|| target.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or("archive");
        let ext = target
            .extension()
            .and_then(|s| s.to_str())
            .map(str::to_lowercase)
            .unwrap_or_default();
        let is_archive = matches!(
            ext.as_str(),
            "7z" | "zip" | "rar" | "tar" | "gz" | "bz2" | "xz" | "iso" | "cab" | "wim"
        );

        let mut children = Vec::new();
        if !is_dir && is_archive {
            children.push(ShellMenuItem {
                id: "nanazip-open".to_string(),
                menu_index: 0,
                cmd_id: None,
                custom_action: Some("nanazip:open".to_string()),
                label: "Open archive".to_string(),
                is_separator: false,
                disabled: false,
                has_submenu: false,
                icon: icon.clone(),
                children: Vec::new(),
            });
            children.push(ShellMenuItem {
                id: "nanazip-extract-dlg".to_string(),
                menu_index: 1,
                cmd_id: None,
                custom_action: Some("nanazip:extract_dlg".to_string()),
                label: "Extract files...".to_string(),
                is_separator: false,
                disabled: false,
                has_submenu: false,
                icon: icon.clone(),
                children: Vec::new(),
            });
            children.push(ShellMenuItem {
                id: "nanazip-extract-here".to_string(),
                menu_index: 2,
                cmd_id: None,
                custom_action: Some("nanazip:extract_here".to_string()),
                label: "Extract Here".to_string(),
                is_separator: false,
                disabled: false,
                has_submenu: false,
                icon: icon.clone(),
                children: Vec::new(),
            });
            children.push(ShellMenuItem {
                id: "nanazip-extract-sub".to_string(),
                menu_index: 3,
                cmd_id: None,
                custom_action: Some("nanazip:extract_sub".to_string()),
                label: format!("Extract to \"{stem}\\\""),
                is_separator: false,
                disabled: false,
                has_submenu: false,
                icon: icon.clone(),
                children: Vec::new(),
            });
            children.push(ShellMenuItem {
                id: "nanazip-test".to_string(),
                menu_index: 4,
                cmd_id: None,
                custom_action: Some("nanazip:test".to_string()),
                label: "Test archive".to_string(),
                is_separator: false,
                disabled: false,
                has_submenu: false,
                icon: icon.clone(),
                children: Vec::new(),
            });
        }

        children.push(ShellMenuItem {
            id: "nanazip-add-dlg".to_string(),
            menu_index: 5,
            cmd_id: None,
            custom_action: Some("nanazip:add_dlg".to_string()),
            label: "Add to archive...".to_string(),
            is_separator: false,
            disabled: false,
            has_submenu: false,
            icon: icon.clone(),
            children: Vec::new(),
        });
        children.push(ShellMenuItem {
            id: "nanazip-add-7z".to_string(),
            menu_index: 6,
            cmd_id: None,
            custom_action: Some("nanazip:add_7z".to_string()),
            label: format!("Add to \"{stem}.7z\""),
            is_separator: false,
            disabled: false,
            has_submenu: false,
            icon: icon.clone(),
            children: Vec::new(),
        });
        children.push(ShellMenuItem {
            id: "nanazip-add-zip".to_string(),
            menu_index: 7,
            cmd_id: None,
            custom_action: Some("nanazip:add_zip".to_string()),
            label: format!("Add to \"{stem}.zip\""),
            is_separator: false,
            disabled: false,
            has_submenu: false,
            icon: icon.clone(),
            children: Vec::new(),
        });

        extras.push(ShellMenuItem {
            id: "packaged-nanazip".to_string(),
            menu_index: u32::MAX,
            cmd_id: None,
            custom_action: None,
            label: "NanaZip".to_string(),
            is_separator: false,
            disabled: false,
            has_submenu: true,
            icon,
            children,
        });
    }

    extras
}

fn resolve_working_dir(target: &Path) -> &Path {
    if target.is_dir() {
        return target;
    }
    target.parent().unwrap_or(target)
}

fn execute_custom_action(target: &Path, action: &str) -> Result<(), String> {
    if action == "open_terminal" {
        let dir = resolve_working_dir(target);
        if let Some(wt) = packaged_binaries().wt.as_ref() {
            Command::new(wt)
                .arg("-d")
                .arg(dir)
                .spawn()
                .map_err(|err| format!("Failed to launch Windows Terminal: {err}"))?;
            return Ok(());
        }
        Command::new("cmd.exe")
            .arg("/K")
            .current_dir(dir)
            .spawn()
            .map_err(|err| format!("Failed to launch cmd.exe: {err}"))?;
        return Ok(());
    }

    if let Some(nana_cmd) = action.strip_prefix("nanazip:") {
        return execute_nanazip_action(target, nana_cmd);
    }

    Err(format!("Unknown custom action: {action}"))
}

fn execute_nanazip_action(target: &Path, nana_cmd: &str) -> Result<(), String> {
    let bins = packaged_binaries();
    let parent_dir = target.parent().unwrap_or(target);
    let stem = target
        .file_stem()
        .or_else(|| target.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("archive");

    if nana_cmd == "open"
        && let Some(bin) = bins.nanazip_fm.as_ref()
    {
        Command::new(bin)
            .arg(target)
            .spawn()
            .map_err(|err| format!("Failed to open NanaZip: {err}"))?;
        return Ok(());
    }

    let Some(gui) = bins.nanazip_gui.as_ref() else {
        return Err("NanaZipG.exe not found".to_string());
    };

    let mut cmd = Command::new(gui);
    cmd.current_dir(parent_dir).creation_flags(CREATE_NO_WINDOW);

    match nana_cmd {
        "extract_dlg" => {
            cmd.arg("x").arg("-ad").arg(target);
        }
        "extract_here" => {
            cmd.arg("x")
                .arg(format!("-o{}", parent_dir.display()))
                .arg(target);
        }
        "extract_sub" => {
            let sub = parent_dir.join(stem);
            cmd.arg("x").arg(format!("-o{}", sub.display())).arg(target);
        }
        "test" => {
            cmd.arg("t").arg(target);
        }
        "add_dlg" => {
            let archive = parent_dir.join(format!("{stem}.7z"));
            cmd.arg("a").arg("-ad").arg(archive).arg(target);
        }
        "add_7z" => {
            let archive = parent_dir.join(format!("{stem}.7z"));
            cmd.arg("a").arg("-t7z").arg(archive).arg(target);
        }
        "add_zip" => {
            let archive = parent_dir.join(format!("{stem}.zip"));
            cmd.arg("a").arg("-tzip").arg(archive).arg(target);
        }
        _ => return Err(format!("Unsupported NanaZip command: {nana_cmd}")),
    }

    cmd.spawn()
        .map_err(|err| format!("Failed to start NanaZip: {err}"))?;
    Ok(())
}
