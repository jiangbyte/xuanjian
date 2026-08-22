//! WSL 内文件操作（通过本地会话的 wsl.exe 执行，与 PTY 同发行版）。
//!
//! Author: Charlie

use crate::session::local;
use crate::session::sftp::SftpEntry;
use crate::session::{SessionHandle, SharedState};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use tauri::State;

const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

fn local_wsl_shell(
    state: &SharedState,
    session_id: &str,
) -> Result<(String, String, Vec<String>), String> {
    let sessions = state.sessions.lock();
    let sess = sessions
        .get(session_id)
        .ok_or_else(|| "session not found".to_string())?;
    match sess {
        SessionHandle::Local(s) => {
            if !s.shell_id.starts_with("local:wsl:") {
                return Err("not a WSL session".into());
            }
            Ok((s.shell_id.clone(), s.shell_path.clone(), s.shell_args.clone()))
        }
        SessionHandle::Ssh(_) => Err("not a local session".into()),
    }
}

async fn wsl_exec(
    state: &SharedState,
    session_id: &str,
    command: &str,
) -> Result<String, String> {
    let (shell_id, shell_path, shell_args) = local_wsl_shell(state, session_id)?;
    local::exec_with_shell(&shell_id, &shell_path, &shell_args, command)
        .await
        .map_err(|e| e.to_string())
}

fn parse_list_output(raw: &str) -> Result<Vec<SftpEntry>, String> {
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(6, '\t').collect();
        if parts.len() < 6 {
            continue;
        }
        let name = parts[0].to_string();
        if name == "." || name == ".." {
            continue;
        }
        let is_dir = parts[1] == "1";
        let size = parts[2].parse::<u64>().unwrap_or(0);
        let mtime = parts[3].parse::<i64>().ok().and_then(|ts| {
            chrono::DateTime::from_timestamp(ts, 0).map(|dt| {
                dt.with_timezone(&chrono::Local)
                    .format("%Y-%m-%d %H:%M")
                    .to_string()
            })
        });
        let permissions = if parts[4].is_empty() {
            None
        } else {
            Some(parts[4].to_string())
        };
        out.push(SftpEntry {
            name,
            path: parts[5].to_string(),
            is_dir,
            size,
            modified_at: mtime,
            permissions,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

fn list_script(path: &str) -> String {
    let q = sh_quote(path);
    format!(
        r#"p={q}
for e in "$p"/.[!.]* "$p"/..?* "$p"/*; do
  [ -e "$e" ] || continue
  name=$(basename "$e")
  [ "$name" = "." ] || [ "$name" = ".." ] && continue
  if [ -d "$e" ]; then d=1; else d=0; fi
  size=$(stat -c '%s' "$e" 2>/dev/null || echo 0)
  mtime=$(stat -c '%Y' "$e" 2>/dev/null || echo 0)
  perm=$(stat -c '%a' "$e" 2>/dev/null || echo "")
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$d" "$size" "$mtime" "$perm" "$e"
done"#
    )
}

/// WSL 用户主目录（$HOME）。
#[tauri::command]
pub async fn wsl_home_dir(
    state: State<'_, SharedState>,
    session_id: String,
) -> Result<String, String> {
    let out = wsl_exec(&state, &session_id, "printf %s \"$HOME\"").await?;
    let home = out.trim().to_string();
    if home.is_empty() {
        return Err("WSL home directory not found".into());
    }
    Ok(home)
}

/// 列举 WSL 内目录。
#[tauri::command]
pub async fn wsl_list_dir(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
) -> Result<Vec<SftpEntry>, String> {
    let script = list_script(&path);
    let out = wsl_exec(&state, &session_id, &script).await?;
    parse_list_output(&out)
}

#[tauri::command]
pub async fn wsl_read_file(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let q = sh_quote(&path);
    let size_out = wsl_exec(
        &state,
        &session_id,
        &format!("stat -c '%s' {q} 2>/dev/null || echo -1"),
    )
    .await?;
    let size = size_out.trim().parse::<i64>().unwrap_or(-1);
    if size < 0 {
        return Err("file not found".into());
    }
    if size as u64 > MAX_EDIT_BYTES {
        return Err(format!(
            "file too large to edit (max {} bytes)",
            MAX_EDIT_BYTES
        ));
    }
    let out = wsl_exec(&state, &session_id, &format!("cat {q}")).await?;
    Ok(out)
}

#[tauri::command]
pub async fn wsl_write_file(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let q = sh_quote(&path);
    let b64 = B64.encode(content.as_bytes());
    let b64_q = sh_quote(&b64);
    let script = format!(
        "parent=$(dirname {q}); mkdir -p \"$parent\"; echo {b64_q} | base64 -d > {q}"
    );
    wsl_exec(&state, &session_id, &script).await?;
    Ok(())
}

#[tauri::command]
pub async fn wsl_mkdir(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let q = sh_quote(&path);
    wsl_exec(&state, &session_id, &format!("mkdir -p {q}")).await?;
    Ok(())
}

#[tauri::command]
pub async fn wsl_rename(
    state: State<'_, SharedState>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let o = sh_quote(&old_path);
    let n = sh_quote(&new_path);
    wsl_exec(&state, &session_id, &format!("mv {o} {n}")).await?;
    Ok(())
}

#[tauri::command]
pub async fn wsl_chmod(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
    mode: u32,
) -> Result<(), String> {
    let q = sh_quote(&path);
    wsl_exec(
        &state,
        &session_id,
        &format!("chmod {:o} {q}", mode & 0o777),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn wsl_remove(
    state: State<'_, SharedState>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let q = sh_quote(&path);
    let cmd = if is_dir {
        format!("rm -rf {q}")
    } else {
        format!("rm -f {q}")
    };
    wsl_exec(&state, &session_id, &cmd).await?;
    Ok(())
}
