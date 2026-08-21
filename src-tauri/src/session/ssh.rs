//! SSH 客户端会话：连接、交互式通道、一次性 exec。
//!
//! Author: Charlie

use super::{emit_closed, emit_output};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use russh::client::{self, Handle, Msg};
use russh::ChannelMsg;
use russh_keys::key;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};

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
}

pub struct ClientHandler;

#[async_trait]
impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
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

pub async fn connect(app: AppHandle, params: SshConnectParams) -> Result<SshSession> {
    let config = Arc::new(client::Config::default());
    let mut handle = client::connect(config, (params.host.as_str(), params.port), ClientHandler)
        .await
        .context("ssh connect")?;

    let auth_ok = match params.auth_type.as_str() {
        "password" => {
            let password = params
                .password
                .clone()
                .ok_or_else(|| anyhow!("password required"))?;
            handle
                .authenticate_password(&params.username, password)
                .await?
        }
        "privateKey" | "private_key" | "key" => {
            let key_path = params
                .private_key_path
                .clone()
                .ok_or_else(|| anyhow!("private key path required"))?;
            if !Path::new(&key_path).exists() {
                return Err(anyhow!("private key not found: {key_path}"));
            }
            let passphrase = params.passphrase.as_deref();
            let key_pair =
                russh_keys::load_secret_key(&key_path, passphrase).context("load private key")?;
            handle
                .authenticate_publickey(&params.username, Arc::new(key_pair))
                .await?
        }
        other => return Err(anyhow!("unsupported auth type: {other}")),
    };

    if !auth_ok {
        return Err(anyhow!("SSH authentication failed"));
    }

    let mut channel = handle.channel_open_session().await?;
    let cols = params.cols.unwrap_or(120);
    let rows = params.rows.unwrap_or(30);
    let term = params
        .terminal_type
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("xterm-256color");
    channel
        .request_pty(false, term, cols as u32, rows as u32, 0, 0, &[])
        .await?;
    channel.request_shell(false).await?;

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
