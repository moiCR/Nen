use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime, ipc::Invoke};

pub mod fs_scanner;
pub mod icon_cache;
pub mod operations;
pub mod system;
pub mod watcher;

use self::fs_scanner::FsScannerService;
use self::icon_cache::IconCacheService;
use self::operations::OperationsService;
use self::system::SystemService;
use self::watcher::WatcherService;

pub type SharedService<T> = Arc<T>;

pub trait Service: Sized + Send + Sync + 'static {
    const NAME: &'static str;

    fn init<R: Runtime>(app: &AppHandle<R>) -> Self;

    fn build<R: Runtime>(app: &AppHandle<R>) -> Arc<Self> {
        let instance = Arc::new(Self::init(app));
        app.manage(Arc::clone(&instance));
        println!("Service '{}' initialized", Self::NAME);
        instance
    }
}

pub trait ServicesExt<R: Runtime> {
    fn service<S: Service>(&self) -> SharedService<S>;
}

impl<R: Runtime, T: Manager<R>> ServicesExt<R> for T {
    fn service<S: Service>(&self) -> SharedService<S> {
        self.state::<SharedService<S>>().inner().clone()
    }
}

#[derive(Clone)]
pub struct ServiceManager {
    pub system: SharedService<SystemService>,
    pub fs_scanner: SharedService<FsScannerService>,
    pub watcher: SharedService<WatcherService>,
    pub icon_cache: SharedService<IconCacheService>,
    pub operations: SharedService<OperationsService>,
}

impl ServiceManager {
    pub fn init<R: Runtime>(app: &AppHandle<R>) -> Self {
        let manager = Self {
            system: SystemService::build(app),
            fs_scanner: FsScannerService::build(app),
            watcher: WatcherService::build(app),
            icon_cache: IconCacheService::build(app),
            operations: OperationsService::build(app),
        };

        app.manage(manager.clone());
        println!("ServiceManager ready with all services attached");
        manager
    }

    pub fn commands<R: Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
        tauri::generate_handler![
            system::commands::get_system_places,
            system::commands::get_drives,
            fs_scanner::commands::list_directory,
            fs_scanner::commands::start_search,
            fs_scanner::commands::cancel_search,
            icon_cache::commands::get_icons_batch,
            watcher::commands::watch_directory,
            watcher::commands::unwatch_directory,
            crate::actions::fs::create_dir,
            crate::actions::fs::create_empty_file,
            crate::actions::fs::rename_entry,
            crate::actions::fs::delete_to_trash,
            crate::actions::shell::open_item,
            crate::actions::shell::get_shell_context_menu,
            crate::actions::shell::expand_shell_submenu,
            crate::actions::shell::invoke_shell_context_item,
        ]
    }
}
