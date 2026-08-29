//! 本地伪终端（PTY）会话：探测 Shell、打开、读写与一次性 exec。
//!
//! Author: Charlie

use super::{emit_closed, emit_output, LocalShellInfo};
use anyhow::{anyhow, Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::AppHandle;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use which::which;

pub struct LocalSession {
    pub id: String,
    pub title: String,
    pub shell_id: String,
    pub shell_path: String,
    pub shell_args: Vec<String>,
    writer: MutexWriter,
    master: Box<dyn MasterPty + Send>,
    alive: Arc<AtomicBool>,
}

struct MutexWriter {
    inner: parking_lot::Mutex<Box<dyn Write + Send>>,
}

impl LocalSession {
    pub fn write(&self, data: &[u8]) -> Result<()> {
        let mut w = self.writer.inner.lock();
        w.write_all(data)?;
        w.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn close(&self) {
        self.alive.store(false, Ordering::SeqCst);
    }
}

pub fn list_local_shells() -> Vec<LocalShellInfo> {
    #[cfg(target_os = "windows")]
    {
        list_windows_shells()
    }
    #[cfg(target_os = "macos")]
    {
        list_macos_shells()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        list_linux_shells()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        Vec::new()
    }
}

#[cfg(target_os = "windows")]
fn list_windows_shells() -> Vec<LocalShellInfo> {
    let mut shells = Vec::new();

    let candidates: Vec<(&str, &str, Vec<String>)> = vec![
        ("powershell", "Windows PowerShell", vec![]),
        ("pwsh", "PowerShell", vec![]),
        ("cmd", "CMD", vec![]),
    ];

    for (bin, name, args) in candidates {
        if let Ok(path) = which(bin) {
            let path_str = path.to_string_lossy().to_string();
            shells.push(LocalShellInfo {
                id: format!("local:{bin}"),
                name: name.to_string(),
                path: path_str,
                args,
                is_default: false,
            });
        }
    }

    // Prefer PowerShell as default on Windows
    if let Some(ps) = shells.iter_mut().find(|s| s.id == "local:powershell") {
        ps.is_default = true;
    } else if let Some(first) = shells.first_mut() {
        first.is_default = true;
    }

    // Git Bash
    let git_bash_paths = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ];
    for p in git_bash_paths {
        if Path::new(p).exists() {
            shells.push(LocalShellInfo {
                id: "local:git-bash".into(),
                name: "Git Bash".into(),
                path: p.into(),
                args: vec!["--login".into(), "-i".into()],
                is_default: false,
            });
            break;
        }
    }

    // WSL distros
    if which("wsl").is_ok() {
        let mut wsl_list = std::process::Command::new("wsl");
        wsl_list.args(["-l", "-q"]);
        crate::win_process::hide_console(&mut wsl_list);
        if let Ok(output) = wsl_list.output() {
            let text = String::from_utf16_lossy(
                &output
                    .stdout
                    .chunks(2)
                    .filter_map(|c| {
                        if c.len() == 2 {
                            Some(u16::from_le_bytes([c[0], c[1]]))
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>(),
            );
            // Fallback UTF-8 if not UTF-16
            let text = if text.trim().is_empty() {
                String::from_utf8_lossy(&output.stdout).to_string()
            } else {
                text
            };
            for line in text.lines() {
                let name = line.trim().trim_matches('\0').trim();
                if name.is_empty() {
                    continue;
                }
                shells.push(LocalShellInfo {
                    id: format!("local:wsl:{name}"),
                    name: format!("WSL ({name})"),
                    path: "wsl.exe".into(),
                    args: vec!["-d".into(), name.to_string()],
                    is_default: false,
                });
            }
        }
    }

    shells
}

#[cfg(any(target_os = "macos", all(unix, not(target_os = "macos"))))]
fn mark_default(shells: &mut [LocalShellInfo]) {
    let user_shell = std::env::var("SHELL").unwrap_or_default();
    if let Some(s) = shells.iter_mut().find(|s| s.path == user_shell) {
        s.is_default = true;
    } else if let Some(first) = shells.first_mut() {
        first.is_default = true;
    }
}

#[cfg(target_os = "macos")]
fn list_macos_shells() -> Vec<LocalShellInfo> {
    let mut shells = Vec::new();
    // /etc/shells + 常见 Homebrew / 系统路径
    if let Ok(content) = std::fs::read_to_string("/etc/shells") {
        for line in content.lines() {
            let path = line.trim();
            if path.is_empty() || path.starts_with('#') {
                continue;
            }
            if Path::new(path).exists() {
                let name = Path::new(path)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.to_string());
                if shells.iter().any(|s: &LocalShellInfo| s.path == path) {
                    continue;
                }
                shells.push(LocalShellInfo {
                    id: format!("local:{name}"),
                    name,
                    path: path.to_string(),
                    args: vec![],
                    is_default: false,
                });
            }
        }
    }
    for (name, path) in [
        ("zsh", "/bin/zsh"),
        ("bash", "/bin/bash"),
        ("sh", "/bin/sh"),
        ("fish", "/opt/homebrew/bin/fish"),
        ("fish", "/usr/local/bin/fish"),
        ("bash", "/opt/homebrew/bin/bash"),
        ("bash", "/usr/local/bin/bash"),
        ("zsh", "/opt/homebrew/bin/zsh"),
        ("zsh", "/usr/local/bin/zsh"),
        ("nu", "/opt/homebrew/bin/nu"),
        ("nu", "/usr/local/bin/nu"),
    ] {
        if !Path::new(path).exists() {
            continue;
        }
        if shells.iter().any(|s| s.path == path) {
            continue;
        }
        shells.push(LocalShellInfo {
            id: format!("local:{name}"),
            name: name.into(),
            path: path.into(),
            args: vec![],
            is_default: false,
        });
    }
    // which 补充
    for name in ["zsh", "bash", "fish", "sh", "nu"] {
        if let Ok(p) = which(name) {
            let path = p.to_string_lossy().to_string();
            if shells.iter().any(|s| s.path == path) {
                continue;
            }
            shells.push(LocalShellInfo {
                id: format!("local:{name}"),
                name: name.into(),
                path,
                args: vec![],
                is_default: false,
            });
        }
    }
    mark_default(&mut shells);
    shells
}

#[cfg(all(unix, not(target_os = "macos")))]
fn list_linux_shells() -> Vec<LocalShellInfo> {
    let mut shells = Vec::new();
    if let Ok(content) = std::fs::read_to_string("/etc/shells") {
        for line in content.lines() {
            let path = line.trim();
            if path.is_empty() || path.starts_with('#') {
                continue;
            }
            if Path::new(path).exists() {
                let name = Path::new(path)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.to_string());
                if shells.iter().any(|s: &LocalShellInfo| s.path == path) {
                    continue;
                }
                shells.push(LocalShellInfo {
                    id: format!("local:{name}"),
                    name,
                    path: path.to_string(),
                    args: vec![],
                    is_default: false,
                });
            }
        }
    }
    if shells.is_empty() {
        for (name, path) in [
            ("bash", "/bin/bash"),
            ("zsh", "/bin/zsh"),
            ("sh", "/bin/sh"),
        ] {
            if Path::new(path).exists() {
                shells.push(LocalShellInfo {
                    id: format!("local:{name}"),
                    name: name.into(),
                    path: path.into(),
                    args: vec![],
                    is_default: false,
                });
            }
        }
    }
    mark_default(&mut shells);
    shells
}

pub fn open_local_shell(
    app: AppHandle,
    shell: &LocalShellInfo,
    cols: u16,
    rows: u16,
) -> Result<LocalSession> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("open pty")?;

    let mut cmd = CommandBuilder::new(&shell.path);
    for arg in &shell.args {
        cmd.arg(arg);
    }
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        cmd.cwd(home);
    }

    let _child = pair.slave.spawn_command(cmd).context("spawn shell")?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| anyhow!("clone reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| anyhow!("take writer: {e}"))?;

    let id = uuid::Uuid::new_v4().to_string();
    let alive = Arc::new(AtomicBool::new(true));
    let alive_clone = alive.clone();
    let session_id = id.clone();
    let app_clone = app.clone();

    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while alive_clone.load(Ordering::SeqCst) {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    emit_output(&app_clone, &session_id, &data);
                }
                Err(_) => break,
            }
        }
        emit_closed(&app_clone, &session_id);
    });

    Ok(LocalSession {
        id,
        title: shell.name.clone(),
        shell_id: shell.id.clone(),
        shell_path: shell.path.clone(),
        shell_args: shell.args.clone(),
        writer: MutexWriter {
            inner: parking_lot::Mutex::new(writer),
        },
        master: pair.master,
        alive,
    })
}

fn output_to_string(output: std::process::Output) -> String {
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    text
}

/// 按与交互 Shell 同类的环境执行一次性命令（供 session_exec 使用）。
pub async fn exec_with_shell(
    shell_id: &str,
    shell_path: &str,
    shell_args: &[String],
    command: &str,
) -> Result<String> {
    #[cfg(target_os = "windows")]
    {
        let output = if shell_id.starts_with("local:wsl:") {
            let distro = shell_id.strip_prefix("local:wsl:").unwrap_or("").trim();
            // Prefer distro from shell args (-d Name) when present.
            let distro = shell_args
                .windows(2)
                .find(|w| w[0] == "-d")
                .map(|w| w[1].as_str())
                .unwrap_or(distro);
            let mut cmd = tokio::process::Command::new("wsl.exe");
            // 必须用 --exec：`-- sh -lc` 会经发行版默认 shell 再解析，导致 `$var` / `;` 脚本被吃空
            // （表现为 wsl_list_dir 等返回空列表）。--exec 直接 exec sh。
            cmd.args(["-d", distro, "--exec", "sh", "-lc", command]);
            crate::win_process::hide_console_tokio(&mut cmd);
            cmd.output().await.context("wsl exec")?
        } else if shell_id == "local:git-bash"
            || shell_path.to_ascii_lowercase().contains("bash.exe")
        {
            let mut cmd = tokio::process::Command::new(shell_path);
            cmd.args(["-lc", command]);
            crate::win_process::hide_console_tokio(&mut cmd);
            cmd.output().await.context("git bash exec")?
        } else if shell_id.contains("powershell")
            || shell_id.contains("pwsh")
            || shell_path.to_ascii_lowercase().contains("powershell")
            || shell_path.to_ascii_lowercase().contains("pwsh")
        {
            let mut cmd = tokio::process::Command::new(shell_path);
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", command]);
            crate::win_process::hide_console_tokio(&mut cmd);
            cmd.output().await.context("powershell exec")?
        } else {
            let mut cmd = tokio::process::Command::new("cmd.exe");
            cmd.args(["/C", command]);
            crate::win_process::hide_console_tokio(&mut cmd);
            cmd.output().await.context("cmd exec")?
        };
        Ok(output_to_string(output))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (shell_id, shell_args);
        let output = unix_exec_command(shell_path, command)
            .output()
            .await
            .context("local exec")?;
        Ok(output_to_string(output))
    }
}

#[cfg(not(target_os = "windows"))]
fn unix_exec_command(shell_path: &str, command: &str) -> tokio::process::Command {
    let path_l = shell_path.to_ascii_lowercase();
    let mut cmd = if path_l.ends_with("/fish") || path_l.ends_with("\\fish") {
        let mut c = tokio::process::Command::new(shell_path);
        c.args(["-lc", command]);
        c
    } else if !shell_path.is_empty() && Path::new(shell_path).exists() {
        // bash / zsh / sh / nu：统一 -lc
        let mut c = tokio::process::Command::new(shell_path);
        c.args(["-lc", command]);
        c
    } else {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-lc", command]);
        c
    };
    if let Ok(home) = std::env::var("HOME") {
        cmd.current_dir(home);
    }
    cmd
}

/// 流式本地 exec；cancel 后杀掉子进程。stdout/stderr 合并推送。
pub async fn exec_stream_with_shell(
    shell_id: &str,
    shell_path: &str,
    shell_args: &[String],
    command: &str,
    cancel: Arc<AtomicBool>,
    mut on_chunk: impl FnMut(String),
) -> Result<()> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::sync::mpsc;

    #[cfg(target_os = "windows")]
    let mut child = {
        let mut cmd = if shell_id.starts_with("local:wsl:") {
            let distro = shell_id.strip_prefix("local:wsl:").unwrap_or("").trim();
            let distro = shell_args
                .windows(2)
                .find(|w| w[0] == "-d")
                .map(|w| w[1].as_str())
                .unwrap_or(distro);
            let mut c = tokio::process::Command::new("wsl.exe");
            // 同 exec_with_shell：必须 --exec，避免默认 shell 二次解析破坏脚本
            c.args(["-d", distro, "--exec", "sh", "-lc", command]);
            c
        } else if shell_id == "local:git-bash"
            || shell_path.to_ascii_lowercase().contains("bash.exe")
        {
            let mut c = tokio::process::Command::new(shell_path);
            c.args(["-lc", command]);
            c
        } else if shell_id.contains("powershell")
            || shell_id.contains("pwsh")
            || shell_path.to_ascii_lowercase().contains("powershell")
            || shell_path.to_ascii_lowercase().contains("pwsh")
        {
            let mut c = tokio::process::Command::new(shell_path);
            c.args(["-NoProfile", "-NonInteractive", "-Command", command]);
            c
        } else {
            let mut c = tokio::process::Command::new("cmd.exe");
            c.args(["/C", command]);
            c
        };
        crate::win_process::hide_console_tokio(&mut cmd);
        cmd.stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .context("spawn local stream exec")?
    };

    #[cfg(not(target_os = "windows"))]
    let mut child = {
        let _ = (shell_id, shell_args);
        unix_exec_command(shell_path, command)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .context("spawn local stream exec")?
    };

    let stdout = child.stdout.take().context("stdout")?;
    let stderr = child.stderr.take().context("stderr")?;
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let tx_err = tx.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if tx_err.send(line).is_err() {
                break;
            }
        }
    });

    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill().await;
            break;
        }
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Some(line) => on_chunk(format!("{line}\n")),
                    None => break,
                }
            }
            _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => {}
        }
    }
    let _ = child.wait().await;
    Ok(())
}
