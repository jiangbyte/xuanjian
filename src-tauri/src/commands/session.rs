//! SSH / 通用会话读写与执行命令。
//!
//! Author: Charlie

use crate::crypto;
use crate::session::{local, ssh, SessionHandle, SessionInfo, SessionKind, SharedState};
use std::sync::Arc;
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

/// 流式执行长命令（如 `docker logs -f`），通过 `session-exec-output` 推送。
///
/// @returns job_id，可用 `session_exec_cancel` 停止。
#[tauri::command]
pub async fn session_exec_stream(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    session_id: String,
    command: String,
) -> Result<String, String> {
    use crate::session::SessionExecStreamPayload;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::Emitter;
    use uuid::Uuid;

    let job_id = Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .exec_cancels
        .lock()
        .insert(job_id.clone(), cancel.clone());

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

    let local_shell = if ssh_handle.is_none() {
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
    } else {
        None
    };

    let job_id_task = job_id.clone();
    let state_arc = state.inner().clone();
    tokio::spawn(async move {
        let emit = |data: String, done: bool| {
            let _ = app.emit(
                "session-exec-output",
                SessionExecStreamPayload {
                    job_id: job_id_task.clone(),
                    data,
                    done,
                },
            );
        };

        let result = if let Some(handle) = ssh_handle {
            ssh::exec_stream(handle, &command, cancel.clone(), |chunk| {
                emit(chunk, false);
            })
            .await
        } else if let Some((shell_id, shell_path, shell_args)) = local_shell {
            local::exec_stream_with_shell(
                &shell_id,
                &shell_path,
                &shell_args,
                &command,
                cancel.clone(),
                |chunk| emit(chunk, false),
            )
            .await
        } else {
            Err(anyhow::anyhow!("session not found"))
        };

        if let Err(e) = result {
            if !cancel.load(Ordering::SeqCst) {
                emit(format!("\n[error] {e}\n"), false);
            }
        }
        emit(String::new(), true);
        state_arc.exec_cancels.lock().remove(&job_id_task);
    });

    Ok(job_id)
}

/// 取消流式 exec。
#[tauri::command]
pub fn session_exec_cancel(state: State<'_, SharedState>, job_id: String) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if let Some(flag) = state.exec_cancels.lock().get(&job_id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}
