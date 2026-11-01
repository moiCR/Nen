use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Runtime};

use super::Service;

pub struct OperationsService {
    next_job_id: AtomicU64,
}

impl Service for OperationsService {
    const NAME: &'static str = "operations";

    fn init<R: Runtime>(_app: &AppHandle<R>) -> Self {
        Self {
            next_job_id: AtomicU64::new(1),
        }
    }
}

impl OperationsService {
    pub fn allocate_job_id(&self) -> u64 {
        self.next_job_id.fetch_add(1, Ordering::Relaxed)
    }
}
