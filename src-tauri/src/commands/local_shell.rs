//! 本地 Shell 相关 Tauri 命令。
//!
//! Author: Charlie

use crate::session::{local, LocalShellInfo, SessionHandle, SessionInfo, SessionKind, SharedState};
use tauri::State;

/// 列举本机可启动的 Shell（PowerShell / CMD / bash 等）。
#[tauri::command]
pub fn list_local_shells() -> Vec<LocalShellInfo> {
    local::list_local_shells()
}

/// 打开本地 Shell 会话并登记到全局会话表。
///
/// `cols` / `rows` 缺省分别为 120 / 30。
#[tauri::command]
pub fn local_shell_open(
    app: tauri::AppHandle,
    state: State<SharedState>,
    shell_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<SessionInfo, String> {
    let shells = local::list_local_shells();
    let shell = shells
        .into_iter()
        .find(|s| s.id == shell_id)
        .ok_or_else(|| format!("shell not found: {shell_id}"))?;
    let sess = local::open_local_shell(app, &shell, cols.unwrap_or(120), rows.unwrap_or(30))
        .map_err(|e| e.to_string())?;
    let info = SessionInfo {
        id: sess.id.clone(),
        kind: SessionKind::Local,
        title: sess.title.clone(),
    };
    state
        .sessions
        .lock()
        .insert(sess.id.clone(), SessionHandle::Local(sess));
    Ok(info)
}
