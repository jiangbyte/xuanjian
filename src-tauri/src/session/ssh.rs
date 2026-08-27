//! SSH 客户端会话：连接、交互式通道、一次性 exec。
//!
//! Author: Charlie

use super::{emit_closed, emit_output};
use crate::crypto;
use crate::services::ssh::{self as ssh_service, HostRecord, ProxyConfig};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use russh::client::{self, Handle, Msg};
use russh::ChannelMsg;
use russh_keys::key;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, Mutex};

pub const ERR_HOST_KEY_UNKNOWN: &str = "SSH_HOST_KEY_UNKNOWN";
pub const ERR_HOST_KEY_MISMATCH: &str = "SSH_HOST_KEY_MISMATCH";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
    pub title: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub terminal_type: Option<String>,
    pub proxy_type: Option<String>,
    pub proxy_host: Option<String>,
    pub proxy_port: Option<u16>,
    pub jump_host_id: Option<i64>,
}

#[derive(Debug, thiserror::Error)]
pub enum SshClientError {
    #[error(transparent)]
    Russh(#[from] russh::Error),
    #[error("{code}:{host}:{port}:{detail}")]
    HostKey {
        code: &'static str,
        host: String,
        port: u16,
        detail: String,
    },
    #[error("{0}")]
    Other(#[from] anyhow::Error),
}

pub struct ClientHandler {
    host: String,
    port: u16,
}

#[async_trait]
impl client::Handler for ClientHandler {
    type Error = SshClientError;

    async fn check_server_key(
        &mut self,
        server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint();
        match ssh_service::lookup_fingerprint(&self.host, self.port)
            .map_err(SshClientError::Other)?
        {
            Some(stored) if stored == fingerprint => Ok(true),
            Some(stored) => Err(SshClientError::HostKey {
                code: ERR_HOST_KEY_MISMATCH,
                host: self.host.clone(),
                port: self.port,
                detail: format!("expected={stored};actual={fingerprint}"),
            }),
            None => Err(SshClientError::HostKey {
                code: ERR_HOST_KEY_UNKNOWN,
                host: self.host.clone(),
                port: self.port,
                detail: fingerprint,
            }),
        }
    }
}

enum ChannelCommand {
    Write(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

pub struct SshSession {
    pub id: String,
    pub title: String,
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    tx: mpsc::UnboundedSender<ChannelCommand>,
}

impl SshSession {
    pub fn write(&self, data: &[u8]) -> Result<()> {
        self.tx
            .send(ChannelCommand::Write(data.to_vec()))
            .map_err(|_| anyhow!("ssh session closed"))?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.tx
            .send(ChannelCommand::Resize { cols, rows })
            .map_err(|_| anyhow!("ssh session closed"))?;
        Ok(())
    }

    pub fn close(&self) -> Result<()> {
        let _ = self.tx.send(ChannelCommand::Close);
        Ok(())
    }

    pub fn handle(&self) -> Arc<Mutex<Handle<ClientHandler>>> {
        self.handle.clone()
    }
}

#[derive(Clone)]
struct AuthParams {
    username: String,
    auth_type: String,
    password: Option<String>,
    private_key_path: Option<String>,
    passphrase: Option<String>,
}

fn proxy_from_params(params: &SshConnectParams) -> Option<ProxyConfig> {
    let proxy_type = params.proxy_type.as_ref()?.trim();
    if proxy_type.is_empty() {
        return None;
    }
    let proxy_host = params.proxy_host.as_ref()?.trim();
    if proxy_host.is_empty() {
        return None;
    }
    Some(ProxyConfig {
        proxy_type: proxy_type.to_string(),
        proxy_host: proxy_host.to_string(),
        proxy_port: params.proxy_port.unwrap_or(1080),
    })
}

fn auth_from_params(params: &SshConnectParams) -> AuthParams {
    AuthParams {
        username: params.username.clone(),
        auth_type: params.auth_type.clone(),
        password: params.password.clone(),
        private_key_path: params.private_key_path.clone(),
        passphrase: params.passphrase.clone(),
    }
}

fn resolve_secret(value: Option<String>) -> Option<String> {
    value.map(|v| crypto::decrypt_password(&v).unwrap_or(v))
}

fn auth_from_host(host: &HostRecord) -> AuthParams {
    AuthParams {
        username: host.username.clone(),
        auth_type: host.auth_type.clone(),
        password: resolve_secret(host.password_enc.clone()),
        private_key_path: host.private_key_path.clone(),
        passphrase: resolve_secret(host.passphrase_enc.clone()),
    }
}

fn proxy_from_host(host: &HostRecord) -> Option<ProxyConfig> {
    let proxy_type = host.proxy_type.as_ref()?.trim();
    if proxy_type.is_empty() {
        return None;
    }
    let proxy_host = host.proxy_host.as_ref()?.trim();
    if proxy_host.is_empty() {
        return None;
    }
    Some(ProxyConfig {
        proxy_type: proxy_type.to_string(),
        proxy_host: proxy_host.to_string(),
        proxy_port: host.proxy_port.unwrap_or(1080),
    })
}

async fn authenticate(
    handle: &mut Handle<ClientHandler>,
    auth: &AuthParams,
) -> Result<bool, SshClientError> {
    let auth_ok = match auth.auth_type.as_str() {
        "password" => {
            let password = auth
                .password
                .clone()
                .ok_or_else(|| SshClientError::Other(anyhow!("password required")))?;
            handle
                .authenticate_password(&auth.username, password)
                .await?
        }
        "privateKey" | "private_key" | "key" => {
            let key_path = auth
                .private_key_path
                .clone()
                .ok_or_else(|| SshClientError::Other(anyhow!("private key path required")))?;
            if !Path::new(&key_path).exists() {
                return Err(SshClientError::Other(anyhow!(
                    "private key not found: {key_path}"
                )));
            }
            let passphrase = auth.passphrase.as_deref();
            let key_pair = russh_keys::load_secret_key(&key_path, passphrase)
                .map_err(|e| SshClientError::Other(anyhow!("load private key: {e}")))?;
            handle
                .authenticate_publickey(&auth.username, Arc::new(key_pair))
                .await?
        }
        other => {
            return Err(SshClientError::Other(anyhow!(
                "unsupported auth type: {other}"
            )))
        }
    };
    Ok(auth_ok)
}

async fn connect_handle_over_stream<R>(
    stream: R,
    host: &str,
    port: u16,
    auth: &AuthParams,
) -> Result<Handle<ClientHandler>, SshClientError>
where
    R: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let config = Arc::new(client::Config::default());
    let handler = ClientHandler {
        host: host.to_string(),
        port,
    };
    let mut handle = client::connect_stream(config, stream, handler).await?;
    if !authenticate(&mut handle, auth).await? {
        return Err(SshClientError::Other(anyhow!("SSH authentication failed")));
    }
    Ok(handle)
}

async fn connect_handle_direct(
    host: &str,
    port: u16,
    auth: &AuthParams,
    proxy: Option<&ProxyConfig>,
) -> Result<Handle<ClientHandler>, SshClientError> {
    let stream = ssh_service::open_tcp(host, port, proxy)
        .await
        .map_err(SshClientError::Other)?;
    connect_handle_over_stream(stream, host, port, auth).await
}

async fn connect_via_jump(
    jump: &HostRecord,
    target_host: &str,
    target_port: u16,
    target_auth: &AuthParams,
    proxy: Option<&ProxyConfig>,
) -> Result<Handle<ClientHandler>, SshClientError> {
    let jump_auth = auth_from_host(jump);
    let jump_proxy_cfg = proxy_from_host(jump);
    let jump_proxy = proxy.or(jump_proxy_cfg.as_ref());
    let jump_handle = connect_handle_direct(&jump.host, jump.port, &jump_auth, jump_proxy).await?;

    let channel = jump_handle
        .channel_open_direct_tcpip(target_host, u32::from(target_port), "127.0.0.1", 0)
        .await
        .map_err(SshClientError::Russh)?;
    let stream = channel.into_stream();
    connect_handle_over_stream(stream, target_host, target_port, target_auth).await
}

pub async fn connect(app: AppHandle, params: SshConnectParams) -> Result<SshSession> {
    let auth = auth_from_params(&params);
    let proxy = proxy_from_params(&params);

    let handle = if let Some(jump_id) = params.jump_host_id {
        let jump = ssh_service::load_host(jump_id)
            .map_err(SshClientError::Other)?
            .ok_or_else(|| SshClientError::Other(anyhow!("jump host #{jump_id} not found")))?;
        connect_via_jump(&jump, &params.host, params.port, &auth, proxy.as_ref()).await?
    } else {
        connect_handle_direct(&params.host, params.port, &auth, proxy.as_ref()).await?
    };

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| SshClientError::Russh(e))?;
    let cols = params.cols.unwrap_or(120);
    let rows = params.rows.unwrap_or(30);
    let term = params
        .terminal_type
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("xterm-256color");
    channel
        .request_pty(false, term, cols as u32, rows as u32, 0, 0, &[])
        .await
        .map_err(SshClientError::Russh)?;
    channel
        .request_shell(false)
        .await
        .map_err(SshClientError::Russh)?;

    let id = uuid::Uuid::new_v4().to_string();
    let title = params
        .title
        .clone()
        .unwrap_or_else(|| format!("{}@{}", params.username, params.host));

    let (tx, mut rx) = mpsc::unbounded_channel::<ChannelCommand>();
    let session_id = id.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { ref data }) => {
                            let text = String::from_utf8_lossy(data).to_string();
                            emit_output(&app_clone, &session_id, &text);
                        }
                        Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                            let text = String::from_utf8_lossy(data).to_string();
                            emit_output(&app_clone, &session_id, &text);
                        }
                        Some(ChannelMsg::Eof) | None => {
                            emit_closed(&app_clone, &session_id);
                            break;
                        }
                        _ => {}
                    }
                }
                cmd = rx.recv() => {
                    match cmd {
                        Some(ChannelCommand::Write(data)) => {
                            if channel.data(&data[..]).await.is_err() {
                                emit_closed(&app_clone, &session_id);
                                break;
                            }
                        }
                        Some(ChannelCommand::Resize { cols, rows }) => {
                            let _ = channel.window_change(cols as u32, rows as u32, 0, 0).await;
                        }
                        Some(ChannelCommand::Close) | None => {
                            let _ = channel.close().await;
                            emit_closed(&app_clone, &session_id);
                            break;
                        }
                    }
                }
            }
        }
    });

    let _unused: Option<Msg> = None;
    let _ = _unused;

    Ok(SshSession {
        id,
        title,
        handle: Arc::new(Mutex::new(handle)),
        tx,
    })
}

pub async fn open_sftp_channel(
    handle: Arc<Mutex<Handle<ClientHandler>>>,
) -> Result<russh::Channel<Msg>> {
    let h = handle.lock().await;
    let channel = h.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;
    Ok(channel)
}

pub async fn exec(handle: Arc<Mutex<Handle<ClientHandler>>>, command: &str) -> Result<String> {
    let mut channel = {
        let h = handle.lock().await;
        h.channel_open_session().await?
    };
    channel.exec(true, command).await?;
    let mut out = Vec::new();
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { ref data }) => out.extend_from_slice(data),
            Some(ChannelMsg::ExtendedData { ref data, .. }) => out.extend_from_slice(data),
            Some(ChannelMsg::Eof) | None => break,
            _ => {}
        }
    }
    Ok(String::from_utf8_lossy(&out).to_string())
}

/// 流式执行命令；cancel 为 true 时关闭通道。通过 on_chunk 推送 UTF-8 文本块。
pub async fn exec_stream(
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    command: &str,
    cancel: Arc<std::sync::atomic::AtomicBool>,
    mut on_chunk: impl FnMut(String),
) -> Result<()> {
    use std::sync::atomic::Ordering;
    let mut channel = {
        let h = handle.lock().await;
        h.channel_open_session().await?
    };
    channel.exec(true, command).await?;
    let mut pending = String::new();
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = channel.close().await;
            break;
        }
        match tokio::time::timeout(std::time::Duration::from_millis(200), channel.wait()).await {
            Ok(Some(ChannelMsg::Data { ref data }))
            | Ok(Some(ChannelMsg::ExtendedData { ref data, .. })) => {
                pending.push_str(&String::from_utf8_lossy(data));
                while let Some(pos) = pending.find('\n') {
                    let mut line = pending[..pos + 1].to_string();
                    pending = pending[pos + 1..].to_string();
                    on_chunk(std::mem::take(&mut line));
                }
                if pending.len() > 16 * 1024 {
                    on_chunk(std::mem::take(&mut pending));
                }
            }
            Ok(Some(ChannelMsg::Eof)) | Ok(None) => break,
            Ok(Some(_)) => {}
            Err(_) => continue,
        }
    }
    if !pending.is_empty() {
        on_chunk(pending);
    }
    Ok(())
}
