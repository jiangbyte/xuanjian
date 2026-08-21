//! 会话领域：本地 PTY、SSH、SFTP 与共享应用状态。
//!
//! Author: Charlie

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;

pub mod local;
pub mod sftp;
pub mod ssh;

/// 本机可探测到的 Shell 信息（供前端列表展示）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalShellInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub args: Vec<String>,
    pub is_default: bool,
}

/// 会话类型：本地 Shell 或 SSH。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionKind {
    Local,
    Ssh,
}

/// 返回给前端的会话摘要。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub kind: SessionKind,
    pub title: String,
}

/// 进程内共享状态：活动会话与传输取消标志。
pub struct AppState {
    pub sessions: Mutex<HashMap<String, SessionHandle>>,
    /// 进行中的传输取消控制（transfer_id → 标志）。
    pub transfer_cancels: Mutex<HashMap<String, Arc<TransferAbort>>>,
}

/// 单次 SFTP 传输的取消/暂停信号。
pub struct TransferAbort {
    pub requested: std::sync::atomic::AtomicBool,
    /// true = 暂停（可续传），false = 取消（中止）。
    pub as_pause: std::sync::atomic::AtomicBool,
}

impl TransferAbort {
    pub fn new() -> Self {
        Self {
            requested: std::sync::atomic::AtomicBool::new(false),
            as_pause: std::sync::atomic::AtomicBool::new(false),
        }
    }

    pub fn request_pause(&self) {
        self.as_pause
            .store(true, std::sync::atomic::Ordering::SeqCst);
        self.requested
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn request_cancel(&self) {
        self.as_pause
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.requested
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn is_requested(&self) -> bool {
        self.requested.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn is_pause(&self) -> bool {
        self.as_pause.load(std::sync::atomic::Ordering::SeqCst)
    }
}

pub enum SessionHandle {
    Local(local::LocalSession),
    Ssh(ssh::SshSession),
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            transfer_cancels: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOutputPayload {
    pub session_id: String,
    pub data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionClosedPayload {
    pub session_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgressPayload {
    pub transfer_id: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

pub fn emit_output(app: &AppHandle, session_id: &str, data: &str) {
    use tauri::Emitter;
    let _ = app.emit(
        "session-output",
        SessionOutputPayload {
            session_id: session_id.to_string(),
            data: data.to_string(),
        },
    );
}

pub fn emit_transfer_progress(
    app: &AppHandle,
    transfer_id: &str,
    bytes_done: u64,
    bytes_total: u64,
) {
    use tauri::Emitter;
    let _ = app.emit(
        "sftp-transfer-progress",
        TransferProgressPayload {
            transfer_id: transfer_id.to_string(),
            bytes_done,
            bytes_total,
        },
    );
}

pub fn emit_closed(app: &AppHandle, session_id: &str) {
    use tauri::Emitter;
    let _ = app.emit(
        "session-closed",
        SessionClosedPayload {
            session_id: session_id.to_string(),
        },
    );
}

pub type SharedState = Arc<AppState>;
