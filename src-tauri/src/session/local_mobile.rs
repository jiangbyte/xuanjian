//! 移动端本地 Shell 占位：无 PTY / WSL（伴侣端仅用 SSH）。
//!
//! Author: Charlie

use crate::session::LocalShellInfo;
use anyhow::{anyhow, Result};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::AppHandle;

pub struct LocalSession {
    pub id: String,
    pub title: String,
    pub shell_id: String,
    pub shell_path: String,
    pub shell_args: Vec<String>,
}

impl LocalSession {
    pub fn write(&self, _data: &[u8]) -> Result<()> {
        Err(anyhow!("local PTY is not available on mobile"))
    }

    pub fn resize(&self, _cols: u16, _rows: u16) -> Result<()> {
        Err(anyhow!("local PTY is not available on mobile"))
    }

    pub fn close(&self) {}
}

pub fn list_local_shells() -> Vec<LocalShellInfo> {
    Vec::new()
}

pub fn open_local_shell(
    _app: AppHandle,
    _shell: &LocalShellInfo,
    _cols: u16,
    _rows: u16,
) -> Result<LocalSession> {
    Err(anyhow!("local PTY is not available on mobile"))
}

pub async fn exec_with_shell(
    _shell_id: &str,
    _shell_path: &str,
    _shell_args: &[String],
    _command: &str,
) -> Result<String> {
    Err(anyhow!("local shell exec is not available on mobile"))
}

pub async fn exec_stream_with_shell(
    _shell_id: &str,
    _shell_path: &str,
    _shell_args: &[String],
    _command: &str,
    _cancel: Arc<AtomicBool>,
    _on_chunk: impl FnMut(String),
) -> Result<()> {
    Err(anyhow!("local shell stream is not available on mobile"))
}
