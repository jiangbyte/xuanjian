//! SFTP 协议实现：列举、上传下载、读写、权限与路径操作。
//!
//! Author: Charlie

use super::ssh::{open_sftp_channel, ClientHandler};
use super::TransferAbort;
use anyhow::{Context, Result};
use russh::client::Handle;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: Option<String>,
    pub permissions: Option<String>,
}

pub fn format_system_time(time: std::time::SystemTime) -> Option<String> {
    let datetime: chrono::DateTime<chrono::Local> = time.into();
    Some(datetime.format("%Y-%m-%d %H:%M").to_string())
}

pub fn format_local_permissions(meta: &std::fs::Metadata) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = meta.permissions().mode();
        let bits = mode & 0o777;
        let mut s = String::with_capacity(9);
        for shift in [6, 3, 0] {
            let part = (bits >> shift) & 0o7;
            s.push(if part & 0o4 != 0 { 'r' } else { '-' });
            s.push(if part & 0o2 != 0 { 'w' } else { '-' });
            s.push(if part & 0o1 != 0 { 'x' } else { '-' });
        }
        Some(s)
    }
    #[cfg(windows)]
    {
        Some(if meta.permissions().readonly() {
            "r--r--r--".into()
        } else {
            "rw-rw-rw-".into()
        })
    }
}

pub async fn list_dir(
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    path: &str,
) -> Result<Vec<SftpEntry>> {
    let channel = open_sftp_channel(handle).await?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .context("sftp init")?;
    let entries = sftp.read_dir(path).await.context("sftp read_dir")?;
    let mut out = Vec::new();
    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let meta = entry.metadata();
        let full = if path.ends_with('/') {
            format!("{path}{name}")
        } else {
            format!("{path}/{name}")
        };
        let modified_at = meta.modified().ok().and_then(format_system_time);
        let permissions = Some(meta.permissions().to_string());
        out.push(SftpEntry {
            name,
            path: full,
            is_dir: meta.file_type().is_dir(),
            size: meta.len(),
            modified_at,
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

fn check_abort(cancel: &Option<Arc<TransferAbort>>) -> Result<()> {
    if let Some(c) = cancel {
        if c.is_requested() {
            if c.is_pause() {
                anyhow::bail!("transfer paused");
            }
            anyhow::bail!("transfer cancelled");
        }
    }
    Ok(())
}

pub async fn download_file(
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    remote_path: &str,
    local_path: &str,
    app: Option<&tauri::AppHandle>,
    transfer_id: Option<&str>,
    cancel: Option<Arc<TransferAbort>>,
    resume_from: Option<u64>,
) -> Result<()> {
    let channel = open_sftp_channel(handle).await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;
    let meta = sftp.metadata(remote_path).await.ok();
    let total = meta.map(|m| m.len()).unwrap_or(0);

    let hint = resume_from.unwrap_or(0);
    let local_len = tokio::fs::metadata(local_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    let mut resume = if hint > 0 {
        hint.min(local_len)
            .min(if total > 0 { total } else { hint })
    } else {
        0
    };
    if total > 0 && resume >= total {
        resume = 0;
    }

    let mut remote = sftp.open(remote_path).await.context("open remote")?;
    let mut local = if resume > 0 {
        tokio::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(local_path)
            .await
            .context("open local for resume")?
    } else {
        tokio::fs::File::create(local_path)
            .await
            .context("create local")?
    };
    if resume > 0 {
        remote
            .seek(SeekFrom::Start(resume))
            .await
            .context("seek remote")?;
        local
            .seek(SeekFrom::Start(resume))
            .await
            .context("seek local")?;
        // Drop any trailing garbage past the resume point.
        local.set_len(resume).await.context("truncate local")?;
    }

    let mut buf = vec![0u8; 64 * 1024];
    let mut done: u64 = resume;
    let mut last_emit = resume;
    if let (Some(app), Some(id)) = (app, transfer_id) {
        if resume > 0 {
            super::emit_transfer_progress(app, id, done, total.max(done));
        }
    }
    loop {
        check_abort(&cancel)?;
        let n = remote.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        local.write_all(&buf[..n]).await?;
        done += n as u64;
        if let (Some(app), Some(id)) = (app, transfer_id) {
            if done == resume + n as u64 || done - last_emit >= 256 * 1024 || done == total {
                super::emit_transfer_progress(app, id, done, total.max(done));
                last_emit = done;
            }
        }
    }
    if let (Some(app), Some(id)) = (app, transfer_id) {
        super::emit_transfer_progress(app, id, done, total.max(done));
    }
    Ok(())
}

pub async fn upload_file(
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    local_path: &str,
    remote_path: &str,
    app: Option<&tauri::AppHandle>,
    transfer_id: Option<&str>,
    cancel: Option<Arc<TransferAbort>>,
    resume_from: Option<u64>,
) -> Result<()> {
    let channel = open_sftp_channel(handle).await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;
    let meta = tokio::fs::metadata(local_path).await.ok();
    let total = meta.map(|m| m.len()).unwrap_or(0);

    let hint = resume_from.unwrap_or(0);
    let remote_len = sftp
        .metadata(remote_path)
        .await
        .ok()
        .map(|m| m.len())
        .unwrap_or(0);
    let mut resume = if hint > 0 {
        hint.min(remote_len)
            .min(if total > 0 { total } else { hint })
    } else {
        0
    };
    if total > 0 && resume >= total {
        resume = 0;
    }

    let mut local = tokio::fs::File::open(local_path)
        .await
        .context("open local")?;
    let mut remote = if resume > 0 {
        sftp.open_with_flags(remote_path, OpenFlags::WRITE | OpenFlags::CREATE)
            .await
            .context("open remote for resume")?
    } else {
        sftp.create(remote_path).await.context("create remote")?
    };
    if resume > 0 {
        local
            .seek(SeekFrom::Start(resume))
            .await
            .context("seek local")?;
        remote
            .seek(SeekFrom::Start(resume))
            .await
            .context("seek remote")?;
    }

    let mut buf = vec![0u8; 64 * 1024];
    let mut done: u64 = resume;
    let mut last_emit = resume;
    if let (Some(app), Some(id)) = (app, transfer_id) {
        if resume > 0 {
            super::emit_transfer_progress(app, id, done, total.max(done));
        }
    }
    loop {
        check_abort(&cancel)?;
        let n = local.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        remote.write_all(&buf[..n]).await?;
        done += n as u64;
        if let (Some(app), Some(id)) = (app, transfer_id) {
            if done == resume + n as u64 || done - last_emit >= 256 * 1024 || done == total {
                super::emit_transfer_progress(app, id, done, total.max(done));
                last_emit = done;
            }
        }
    }
    if let (Some(app), Some(id)) = (app, transfer_id) {
        super::emit_transfer_progress(app, id, done, total.max(done));
    }
    Ok(())
}

pub async fn remove_path(
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    path: &str,
    is_dir: bool,
) -> Result<()> {
    let channel = open_sftp_channel(handle.clone()).await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;
    if is_dir {
        remove_dir_recursive(&sftp, path).await?;
    } else {
        sftp.remove_file(path).await?;
    }
    Ok(())
}

async fn remove_dir_recursive(sftp: &SftpSession, path: &str) -> Result<()> {
    let entries = sftp
        .read_dir(path)
        .await
        .context("sftp read_dir for remove")?;
    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let child = if path.ends_with('/') {
            format!("{path}{name}")
        } else {
            format!("{path}/{name}")
        };
        if entry.metadata().file_type().is_dir() {
            Box::pin(remove_dir_recursive(sftp, &child)).await?;
        } else {
            sftp.remove_file(&child).await.context("sftp remove_file")?;
        }
    }
    sftp.remove_dir(path).await.context("sftp remove_dir")?;
    Ok(())
}

pub async fn mkdir(handle: Arc<Mutex<Handle<ClientHandler>>>, path: &str) -> Result<()> {
    let channel = open_sftp_channel(handle).await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;
    sftp.create_dir(path).await?;
    Ok(())
}

pub async fn read_file(
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    remote_path: &str,
    max_bytes: u64,
) -> Result<String> {
    let channel = open_sftp_channel(handle).await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;
    let meta = sftp.metadata(remote_path).await.context("stat remote")?;
    if meta.len() > max_bytes {
        anyhow::bail!("file too large to edit (max {} bytes)", max_bytes);
    }
    let mut remote = sftp.open(remote_path).await.context("open remote")?;
    let mut buf = Vec::with_capacity(meta.len() as usize);
    remote.read_to_end(&mut buf).await.context("read remote")?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

pub async fn write_file(
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    remote_path: &str,
    content: &str,
) -> Result<()> {
    let channel = open_sftp_channel(handle).await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;
    let mut remote = sftp.create(remote_path).await.context("create remote")?;
    remote
        .write_all(content.as_bytes())
        .await
        .context("write remote")?;
    Ok(())
}

pub async fn rename(
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    old_path: &str,
    new_path: &str,
) -> Result<()> {
    let channel = open_sftp_channel(handle).await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;
    sftp.rename(old_path, new_path)
        .await
        .context("sftp rename")?;
    Ok(())
}

pub async fn set_permissions(
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    path: &str,
    mode: u32,
) -> Result<()> {
    use russh_sftp::protocol::FileAttributes;
    let channel = open_sftp_channel(handle).await?;
    let sftp = SftpSession::new(channel.into_stream()).await?;
    let mut attrs = FileAttributes::default();
    attrs.permissions = Some(mode);
    sftp.set_metadata(path, attrs)
        .await
        .context("sftp set_metadata")?;
    Ok(())
}
