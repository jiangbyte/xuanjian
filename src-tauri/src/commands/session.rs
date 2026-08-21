//! SSH / 通用会话读写与执行命令。
//!
//! Author: Charlie

use crate::crypto;
use crate::session::{local, ssh, SessionHandle, SessionInfo, SessionKind, SharedState};
use tauri::State;

/// 建立 SSH 连接。密码/口令支持密文（先尝试解密）或明文。
#[tauri::command]
pub async fn ssh_connect(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    params: ssh::SshConnectParams,
) -> Result<SessionInfo, String> {
    let mut params = params;
    // 鉴权：口令字段可能是 AES 密文，也可能是明文；先解密失败则保留原值
    if params.auth_type == "password" {
        if let Some(enc) = params.password.clone() {
            if let Ok(plain) = crypto::decrypt_password(&enc) {
                params.password = Some(plain);
            }
        }
    }
    if let Some(enc) = params.passphrase.clone() {
        if let Ok(plain) = crypto::decrypt_password(&enc) {
            params.passphrase = Some(plain);
        }
    }
    let sess = ssh::connect(app, params).await.map_err(|e| e.to_string())?;
    let info = SessionInfo {
        id: sess.id.clone(),
        kind: SessionKind::Ssh,
        title: sess.title.clone(),
    };
    state
        .sessions
        .lock()
        .insert(sess.id.clone(), SessionHandle::Ssh(sess));
    Ok(info)
}

/// 向会话写入用户输入（键盘 / 粘贴）。
#[tauri::command]
pub fn session_write(
    state: State<SharedState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.sessions.lock();
    let sess = sessions
        .get(&session_id)
        .ok_or_else(|| "session not found".to_string())?;
    match sess {
        SessionHandle::Local(s) => s.write(data.as_bytes()).map_err(|e| e.to_string()),
        SessionHandle::Ssh(s) => s.write(data.as_bytes()).map_err(|e| e.to_string()),
    }
}

/// 调整伪终端行列大小。
#[tauri::command]
pub fn session_resize(
    state: State<SharedState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock();
    let sess = sessions
        .get(&session_id)
        .ok_or_else(|| "session not found".to_string())?;
    match sess {
        SessionHandle::Local(s) => s.resize(cols, rows).map_err(|e| e.to_string()),
        SessionHandle::Ssh(s) => s.resize(cols, rows).map_err(|e| e.to_string()),
    }
}

/// 关闭会话并从全局表移除。
#[tauri::command]
pub fn session_close(state: State<SharedState>, session_id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock();
    if let Some(sess) = sessions.remove(&session_id) {
        match sess {
            SessionHandle::Local(s) => s.close(),
            SessionHandle::Ssh(s) => s.close().map_err(|e| e.to_string())?,
        }
    }
    Ok(())
}

/// 在会话中执行一次性命令并返回输出。
///
/// SSH 走独立 exec 通道；本地会话用同类型 Shell 另起进程执行。
#[tauri::command]
pub async fn session_exec(
    state: State<'_, SharedState>,
    session_id: String,
    command: String,
) -> Result<String, String> {
    let ssh_handle = {
        let sessions = state.sessions.lock();
        let sess = sessions
            .get(&session_id)
            .ok_or_else(|| "session not found".to_string())?;
        match sess {
            SessionHandle::Ssh(s) => Some(s.handle()),
            SessionHandle::Local(_) => None,
        }
    };
    if let Some(handle) = ssh_handle {
        return ssh::exec(handle, &command).await.map_err(|e| e.to_string());
    }

    let local_shell = {
        let sessions = state.sessions.lock();
        let sess = sessions
            .get(&session_id)
            .ok_or_else(|| "session not found".to_string())?;
        match sess {
            SessionHandle::Local(s) => Some((
                s.shell_id.clone(),
                s.shell_path.clone(),
                s.shell_args.clone(),
            )),
            SessionHandle::Ssh(_) => None,
        }
    };
    if let Some((shell_id, shell_path, shell_args)) = local_shell {
        local::exec_with_shell(&shell_id, &shell_path, &shell_args, &command)
            .await
            .map_err(|e| e.to_string())
    } else {
        Err("session not found".into())
    }
}
