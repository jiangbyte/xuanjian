use super::{emit_closed, emit_output, LocalShellInfo};
use anyhow::{anyhow, Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::AppHandle;
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
        list_unix_shells(&[
            ("zsh", "/bin/zsh"),
            ("bash", "/bin/bash"),
            ("fish", "/opt/homebrew/bin/fish"),
            ("fish", "/usr/local/bin/fish"),
        ])
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
        if let Ok(output) = std::process::Command::new("wsl")
            .args(["-l", "-q"])
            .output()
        {
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
fn list_unix_shells(candidates: &[(&str, &str)]) -> Vec<LocalShellInfo> {
    let mut shells = Vec::new();
    for (name, path) in candidates {
        if Path::new(path).exists() {
            shells.push(LocalShellInfo {
                id: format!("local:{name}"),
                name: name.to_string(),
                path: path.to_string(),
                args: vec![],
                is_default: false,
            });
        } else if let Ok(p) = which(name) {
            shells.push(LocalShellInfo {
                id: format!("local:{name}"),
                name: name.to_string(),
                path: p.to_string_lossy().to_string(),
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
        for (name, path) in [("bash", "/bin/bash"), ("zsh", "/bin/zsh"), ("sh", "/bin/sh")] {
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

/// Run a command in the same environment family as the interactive shell.
pub async fn exec_for_session(session: &LocalSession, command: &str) -> Result<String> {
    exec_with_shell(
        &session.shell_id,
        &session.shell_path,
        &session.shell_args,
        command,
    )
    .await
}

pub async fn exec_with_shell(
    shell_id: &str,
    shell_path: &str,
    shell_args: &[String],
    command: &str,
) -> Result<String> {
    #[cfg(target_os = "windows")]
    {
        let output = if shell_id.starts_with("local:wsl:") {
            let distro = shell_id
                .strip_prefix("local:wsl:")
                .unwrap_or("")
                .trim();
            // Prefer distro from shell args (-d Name) when present.
            let distro = shell_args
                .windows(2)
                .find(|w| w[0] == "-d")
                .map(|w| w[1].as_str())
                .unwrap_or(distro);
            tokio::process::Command::new("wsl.exe")
                .args(["-d", distro, "--", "sh", "-lc", command])
                .output()
                .await
                .context("wsl exec")?
        } else if shell_id == "local:git-bash"
            || shell_path.to_ascii_lowercase().contains("bash.exe")
        {
            tokio::process::Command::new(shell_path)
                .args(["-lc", command])
                .output()
                .await
                .context("git bash exec")?
        } else if shell_id.contains("powershell")
            || shell_id.contains("pwsh")
            || shell_path.to_ascii_lowercase().contains("powershell")
            || shell_path.to_ascii_lowercase().contains("pwsh")
        {
            tokio::process::Command::new(shell_path)
                .args(["-NoProfile", "-NonInteractive", "-Command", command])
                .output()
                .await
                .context("powershell exec")?
        } else {
            tokio::process::Command::new("cmd.exe")
                .args(["/C", command])
                .output()
                .await
                .context("cmd exec")?
        };
        Ok(output_to_string(output))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (shell_id, shell_path, shell_args);
        let output = tokio::process::Command::new("sh")
            .args(["-lc", command])
            .output()
            .await
            .context("local exec")?;
        Ok(output_to_string(output))
    }
}

pub async fn exec(command: &str) -> Result<String> {
    #[cfg(target_os = "windows")]
    {
        let output = tokio::process::Command::new("cmd.exe")
            .args(["/C", command])
            .output()
            .await
            .context("local exec")?;
        Ok(output_to_string(output))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = tokio::process::Command::new("sh")
            .args(["-lc", command])
            .output()
            .await
            .context("local exec")?;
        Ok(output_to_string(output))
    }
}
