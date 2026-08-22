//! 本地 LLM 直连代理（Tauri 命令，非常驻网关进程）。
//!
//! Author: Charlie

pub mod proxy;

use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub struct AiState {
    pub stream_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AiState {
    pub fn new() -> Self {
        Self {
            stream_cancels: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for AiState {
    fn default() -> Self {
        Self::new()
    }
}
