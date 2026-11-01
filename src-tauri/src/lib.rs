use crate::services::ServiceManager;

pub mod actions;
pub mod services;
pub mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            ServiceManager::init(app.handle());
            Ok(())
        })
        .invoke_handler(ServiceManager::commands())
        .run(tauri::generate_context!());

    if let Err(err) = result {
        eprintln!("Error while running Nen: {err}");
    }
}
