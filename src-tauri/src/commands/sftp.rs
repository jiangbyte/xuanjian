//! SFTP 相关 Tauri 命令（目录、传输、读写、权限）。
//!
//! Author: Charlie

use crate::session::{sftp, ssh, SessionHandle, SharedState, TransferAbort};
use std::sync::Arc;
use tauri::State;

/// 远程文件编辑体积上限（2 MiB），防止一次性读入过大文件。
const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

/// 从全局会话表取出 SSH Handle；非 SSH 会话返回错误。
fn ssh_handle(
    state: &State<'_, SharedState>,
    session_id: &str,
) -> Result<std::sync::Arc<tokio::sync::Mutex<russh::client::Handle<ssh::ClientHandler>>>, String> {
    let sessions = state.sessions.lock();
    let sess = sessions
        .get(session_id)
        .ok_or_else(|| "session not found".to_string())?;
    match sess {
        SessionHandle::Ssh(s) => Ok(s.handle()),
        _ => Err("SFTP requires SSH session".into()),
    }
}

/// 列出远程目录条目。
#[tauri::command]
pub async fn sftp_list(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
) -> Result<Vec<sftp::SftpEntry>, String> {
    let handle = ssh_handle(&state, &session_id)?;
    sftp::list_dir(handle, &path)
        .await
        .map_err(|e| e.to_string())
}

/// 上传本地文件到远程；可选 `transfer_id` 用于进度与取消。
#[tauri::command]
pub async fn sftp_upload(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    session_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: Option<String>,
    resume_from: Option<u64>,
) -> Result<(), String> {
    let handle = ssh_handle(&state, &session_id)?;
    let cancel = transfer_id.as_ref().map(|id| {
        let flag = Arc::new(TransferAbort::new());
        state
            .transfer_cancels
            .lock()
            .insert(id.clone(), flag.clone());
        flag
    });
    let result = sftp::upload_file(
        handle,
        &local_path,
        &remote_path,
        Some(&app),
        transfer_id.as_deref(),
        cancel,
        resume_from,
    )
    .await
    .map_err(|e| e.to_string());
    if let Some(id) = &transfer_id {
        state.transfer_cancels.lock().remove(id);
    }
    result
}

/// 下载远程文件到本地。
#[tauri::command]
pub async fn sftp_download(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    session_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: Option<String>,
    resume_from: Option<u64>,
) -> Result<(), String> {
    let handle = ssh_handle(&state, &session_id)?;
    let cancel = transfer_id.as_ref().map(|id| {
        let flag = Arc::new(TransferAbort::new());
        state
            .transfer_cancels
            .lock()
            .insert(id.clone(), flag.clone());
        flag
    });
    let result = sftp::download_file(
        handle,
        &remote_path,
        &local_path,
        Some(&app),
        transfer_id.as_deref(),
        cancel,
        resume_from,
    )
    .await
    .map_err(|e| e.to_string());
    if let Some(id) = &transfer_id {
        state.transfer_cancels.lock().remove(id);
    }
    result
}

/// 取消或暂停进行中的传输（`pause=true` 为暂停）。
#[tauri::command]
pub fn sftp_transfer_cancel(
    state: State<'_, SharedState>,
    transfer_id: String,
    pause: Option<bool>,
) -> Result<(), String> {
    if let Some(flag) = state.transfer_cancels.lock().get(&transfer_id) {
        if pause.unwrap_or(false) {
            flag.request_pause();
        } else {
            flag.request_cancel();
        }
    }
    Ok(())
}

/// 删除远程文件或目录。
#[tauri::command]
pub async fn sftp_remove(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let handle = ssh_handle(&state, &session_id)?;
    sftp::remove_path(handle, &path, is_dir)
        .await
        .map_err(|e| e.to_string())
}

/// 创建远程目录。
#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let handle = ssh_handle(&state, &session_id)?;
    sftp::mkdir(handle, &path).await.map_err(|e| e.to_string())
}

/// 读取远程文本文件（受 `MAX_EDIT_BYTES` 限制）。
#[tauri::command]
pub async fn sftp_read(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let handle = ssh_handle(&state, &session_id)?;
    sftp::read_file(handle, &path, MAX_EDIT_BYTES)
        .await
        .map_err(|e| e.to_string())
}

/// 写入远程文本文件。
#[tauri::command]
pub async fn sftp_write(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let handle = ssh_handle(&state, &session_id)?;
    sftp::write_file(handle, &path, &content)
        .await
        .map_err(|e| e.to_string())
}

/// 重命名远程路径。
#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, SharedState>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let handle = ssh_handle(&state, &session_id)?;
    sftp::rename(handle, &old_path, &new_path)
        .await
        .map_err(|e| e.to_string())
}

/// 设置远程文件权限（Unix mode）。
#[tauri::command]
pub async fn sftp_chmod(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
    mode: u32,
) -> Result<(), String> {
    let handle = ssh_handle(&state, &session_id)?;
    sftp::set_permissions(handle, &path, mode)
        .await
        .map_err(|e| e.to_string())
}
