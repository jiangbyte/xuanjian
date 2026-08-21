mod crypto;
mod network;
mod session;

use network::NetworkState;
use session::{
    local, sftp, ssh, AppState, LocalShellInfo, SessionHandle, SessionInfo, SessionKind,
    SharedState, TransferAbort,
};
use std::sync::Arc;
use tauri::State;
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn list_local_shells() -> Vec<LocalShellInfo> {
    local::list_local_shells()
}

#[tauri::command]
fn local_shell_open(
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
    let sess = local::open_local_shell(
        app,
        &shell,
        cols.unwrap_or(120),
        rows.unwrap_or(30),
    )
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

#[tauri::command]
async fn ssh_connect(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    params: ssh::SshConnectParams,
) -> Result<SessionInfo, String> {
    let mut params = params;
    if params.auth_type == "password" {
        if let Some(enc) = params.password.clone() {
            // Accept either plaintext or encrypted; try decrypt first
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

#[tauri::command]
fn session_write(state: State<SharedState>, session_id: String, data: String) -> Result<(), String> {
    let sessions = state.sessions.lock();
    let sess = sessions
        .get(&session_id)
        .ok_or_else(|| "session not found".to_string())?;
    match sess {
        SessionHandle::Local(s) => s.write(data.as_bytes()).map_err(|e| e.to_string()),
        SessionHandle::Ssh(s) => s.write(data.as_bytes()).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
fn session_resize(
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

#[tauri::command]
fn session_close(state: State<SharedState>, session_id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock();
    if let Some(sess) = sessions.remove(&session_id) {
        match sess {
            SessionHandle::Local(s) => s.close(),
            SessionHandle::Ssh(s) => s.close().map_err(|e| e.to_string())?,
        }
    }
    Ok(())
}

#[tauri::command]
async fn session_exec(
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
        return ssh::exec(handle, &command)
            .await
            .map_err(|e| e.to_string());
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

#[tauri::command]
async fn sftp_list(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
) -> Result<Vec<sftp::SftpEntry>, String> {
    let handle = {
        let sessions = state.sessions.lock();
        let sess = sessions
            .get(&session_id)
            .ok_or_else(|| "session not found".to_string())?;
        match sess {
            SessionHandle::Ssh(s) => s.handle(),
            _ => return Err("SFTP requires SSH session".into()),
        }
    };
    sftp::list_dir(handle, &path).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_upload(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    session_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: Option<String>,
    resume_from: Option<u64>,
) -> Result<(), String> {
    let handle = {
        let sessions = state.sessions.lock();
        let sess = sessions
            .get(&session_id)
            .ok_or_else(|| "session not found".to_string())?;
        match sess {
            SessionHandle::Ssh(s) => s.handle(),
            _ => return Err("SFTP requires SSH session".into()),
        }
    };
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

#[tauri::command]
async fn sftp_download(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    session_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: Option<String>,
    resume_from: Option<u64>,
) -> Result<(), String> {
    let handle = {
        let sessions = state.sessions.lock();
        let sess = sessions
            .get(&session_id)
            .ok_or_else(|| "session not found".to_string())?;
        match sess {
            SessionHandle::Ssh(s) => s.handle(),
            _ => return Err("SFTP requires SSH session".into()),
        }
    };
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

#[tauri::command]
fn sftp_transfer_cancel(
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

#[tauri::command]
async fn sftp_remove(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let handle = {
        let sessions = state.sessions.lock();
        let sess = sessions
            .get(&session_id)
            .ok_or_else(|| "session not found".to_string())?;
        match sess {
            SessionHandle::Ssh(s) => s.handle(),
            _ => return Err("SFTP requires SSH session".into()),
        }
    };
    sftp::remove_path(handle, &path, is_dir)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_mkdir(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let handle = {
        let sessions = state.sessions.lock();
        let sess = sessions
            .get(&session_id)
            .ok_or_else(|| "session not found".to_string())?;
        match sess {
            SessionHandle::Ssh(s) => s.handle(),
            _ => return Err("SFTP requires SSH session".into()),
        }
    };
    sftp::mkdir(handle, &path).await.map_err(|e| e.to_string())
}

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

const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

#[tauri::command]
async fn sftp_read(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let handle = ssh_handle(&state, &session_id)?;
    sftp::read_file(handle, &path, MAX_EDIT_BYTES)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sftp_write(
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

#[tauri::command]
async fn sftp_rename(
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

#[tauri::command]
async fn sftp_chmod(
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

#[tauri::command]
fn encrypt_secret(plain: String) -> Result<String, String> {
    crypto::encrypt_password(&plain).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "home directory not found".into())
}

#[tauri::command]
fn get_temp_dir() -> Result<String, String> {
    Ok(std::env::temp_dir().to_string_lossy().to_string())
}

#[tauri::command]
fn list_local_dir(path: String) -> Result<Vec<sftp::SftpEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let full = entry.path().to_string_lossy().to_string();
        let modified_at = meta.modified().ok().and_then(sftp::format_system_time);
        out.push(sftp::SftpEntry {
            name,
            path: full,
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified_at,
            permissions: sftp::format_local_permissions(&meta),
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

#[tauri::command]
fn create_local_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_local_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_EDIT_BYTES {
        return Err(format!(
            "file too large to edit (max {} bytes)",
            MAX_EDIT_BYTES
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
fn write_local_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_local_path(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn chmod_local_path(path: String, mode: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(mode);
        std::fs::set_permissions(&path, perms).map_err(|e| e.to_string())
    }
    #[cfg(windows)]
    {
        let _ = (path, mode);
        Err("chmod is not supported on Windows local files".into())
    }
}

#[tauri::command]
fn remove_local_path(path: String) -> Result<(), String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init_schema",
            sql: r#"
CREATE TABLE IF NOT EXISTS host_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL DEFAULT 'root',
  auth_type TEXT NOT NULL DEFAULT 'password',
  password_enc TEXT,
  private_key_path TEXT,
  group_id INTEGER,
  last_connected_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(group_id) REFERENCES host_groups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS host_tags (
  host_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (host_id, tag_id),
  FOREIGN KEY(host_id) REFERENCES hosts(id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS known_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  fingerprint TEXT NOT NULL,
  UNIQUE(host, port)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO host_groups (id, name, sort_order) VALUES (1, '默认', 0);
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('theme', 'dark');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('locale', 'zh-CN');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_local_shell', '');
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "host_rich_fields",
            sql: r#"
ALTER TABLE hosts ADD COLUMN remark TEXT;
ALTER TABLE hosts ADD COLUMN color TEXT;
ALTER TABLE hosts ADD COLUMN passphrase_enc TEXT;
ALTER TABLE hosts ADD COLUMN connect_timeout INTEGER NOT NULL DEFAULT 30;
ALTER TABLE hosts ADD COLUMN keepalive_interval INTEGER NOT NULL DEFAULT 60;
ALTER TABLE hosts ADD COLUMN terminal_type TEXT NOT NULL DEFAULT 'xterm-256color';
ALTER TABLE hosts ADD COLUMN startup_cmd TEXT;
ALTER TABLE hosts ADD COLUMN remote_path TEXT;
ALTER TABLE hosts ADD COLUMN jump_host_id INTEGER;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "scripts",
            sql: r#"
CREATE TABLE IF NOT EXISTS script_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'snippet',
  body TEXT NOT NULL,
  package_id INTEGER,
  paste_only INTEGER NOT NULL DEFAULT 0,
  send_mode TEXT NOT NULL DEFAULT 'once',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(package_id) REFERENCES script_packages(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO script_packages (id, name, sort_order) VALUES (1, '常用', 0);

INSERT OR IGNORE INTO scripts (id, name, description, kind, body, package_id, paste_only, send_mode)
VALUES
  (1, '磁盘空间', '查看磁盘占用', 'snippet', 'df -h', 1, 0, 'once'),
  (2, '系统日志', '跟踪系统日志', 'snippet', 'tail -f /var/log/syslog', 1, 0, 'once'),
  (3, '监听端口', '查看监听端口', 'snippet', 'ss -lntup', 1, 0, 'once');
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "notes",
            sql: r#"
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "note_categories",
            sql: r#"
CREATE TABLE IF NOT EXISTS note_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE notes ADD COLUMN category_id INTEGER REFERENCES note_categories(id) ON DELETE SET NULL;

INSERT OR IGNORE INTO note_categories (id, name, sort_order) VALUES (1, '默认', 0);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "session_logs",
            sql: r#"
CREATE TABLE IF NOT EXISTS session_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tab_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL,
  host_id INTEGER,
  shell_id TEXT,
  title TEXT NOT NULL,
  remote_user TEXT,
  remote_host TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  bytes_out INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_log_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  direction TEXT NOT NULL,
  t_ms INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(log_id) REFERENCES session_logs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_log_chunks_log ON session_log_chunks(log_id, seq);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "network_tool_history",
            sql: r#"
CREATE TABLE IF NOT EXISTS network_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_network_history_created ON network_history(created_at DESC);
"#,
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: SharedState = Arc::new(AppState::new());
    let network_state = Arc::new(NetworkState::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                // Avoid Flags::all() default; keep terminal Ctrl+Shift+C/V usable.
                .with_flags({
                    use tauri_plugin_prevent_default::Flags;
                    Flags::CONTEXT_MENU
                        | Flags::PRINT
                        | Flags::DOWNLOADS
                        | Flags::FIND
                        | Flags::RELOAD
                        | Flags::SOURCE
                        | Flags::OPEN
                        | Flags::DEV_TOOLS
                        | Flags::CARET_BROWSING
                })
                .platform(
                    tauri_plugin_prevent_default::PlatformOptions::new()
                        .browser_accelerator_keys(false)
                        .dev_tools(false)
                        .default_context_menus(false),
                )
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:xuanjian.db", migrations())
                .build(),
        )
        .manage(state)
        .manage(network_state)
        .invoke_handler(tauri::generate_handler![
            list_local_shells,
            local_shell_open,
            ssh_connect,
            session_write,
            session_resize,
            session_close,
            session_exec,
            sftp_list,
            sftp_upload,
            sftp_download,
            sftp_transfer_cancel,
            sftp_remove,
            sftp_mkdir,
            sftp_read,
            sftp_write,
            sftp_rename,
            sftp_chmod,
            encrypt_secret,
            get_home_dir,
            get_temp_dir,
            list_local_dir,
            create_local_dir,
            read_local_file,
            write_local_file,
            rename_local_path,
            chmod_local_path,
            remove_local_path,
            network::network_list_interfaces,
            network::network_ping,
            network::network_traceroute,
            network::network_dns_lookup,
            network::network_tcp_probe,
            network::network_cancel,
            network::network_detect_capture_tools,
            network::network_capture_start,
            network::network_capture_stop,
            network::network_pcap_summary,
            network::network_http_request,
            network::network_tls_cert,
            network::network_whois,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
