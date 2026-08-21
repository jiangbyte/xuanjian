//! 内网测速 HTTP 服务：兼容 Cloudflare 风格 `/__down` `/__up`。
//!
//! Author: Charlie

use crate::network::NetworkState;
use axum::body::{to_bytes, Body};
use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use bytes::Bytes;
use futures::stream;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::JoinHandle;

const MAX_DOWN_BYTES: u64 = 100 * 1024 * 1024;
const CHUNK: usize = 64 * 1024;

#[derive(Default)]
pub struct SpeedServerState {
    pub running: AsyncMutex<Option<RunningServer>>,
}

pub struct RunningServer {
    pub port: u16,
    pub abort: Arc<AtomicBool>,
    pub handle: JoinHandle<()>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedServerInfo {
    pub port: u16,
    pub base_urls: Vec<String>,
    pub download_path: String,
    pub upload_path: String,
}

#[derive(Deserialize)]
struct DownQuery {
    bytes: Option<u64>,
}

async fn handle_down(Query(q): Query<DownQuery>) -> Response {
    let n = q.bytes.unwrap_or(0).min(MAX_DOWN_BYTES);
    if n == 0 {
        return (
            StatusCode::OK,
            [
                ("content-type", "application/octet-stream"),
                ("access-control-allow-origin", "*"),
            ],
            Bytes::new(),
        )
            .into_response();
    }
    let stream = stream::unfold(n, |rem| async move {
        if rem == 0 {
            return None;
        }
        let take = (rem as usize).min(CHUNK);
        Some((
            Ok::<_, std::io::Error>(Bytes::from(vec![0u8; take])),
            rem - take as u64,
        ))
    });
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/octet-stream")
        .header("content-length", n.to_string())
        .header("access-control-allow-origin", "*")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn handle_up(body: Body) -> impl IntoResponse {
    let _ = to_bytes(body, usize::MAX).await;
    (
        StatusCode::OK,
        [
            ("content-type", "text/plain"),
            ("access-control-allow-origin", "*"),
        ],
        "ok",
    )
}

async fn handle_options() -> impl IntoResponse {
    (
        StatusCode::NO_CONTENT,
        [
            ("access-control-allow-origin", "*"),
            ("access-control-allow-methods", "GET, POST, OPTIONS"),
            ("access-control-allow-headers", "*"),
        ],
    )
}

fn lan_base_urls(port: u16) -> Vec<String> {
    let mut urls = vec![format!("http://127.0.0.1:{port}")];
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            if let std::net::IpAddr::V4(v4) = iface.ip() {
                urls.push(format!("http://{v4}:{port}"));
            }
        }
    }
    urls.sort();
    urls.dedup();
    urls
}

fn info_for(port: u16) -> SpeedServerInfo {
    SpeedServerInfo {
        port,
        base_urls: lan_base_urls(port),
        download_path: "/__down?bytes={bytes}".into(),
        upload_path: "/__up".into(),
    }
}

/// 启动本机内网测速服务（0.0.0.0）
#[tauri::command]
pub async fn network_speed_server_start(
    state: State<'_, Arc<NetworkState>>,
    port: Option<u16>,
) -> Result<SpeedServerInfo, String> {
    let port = port.unwrap_or(19888).clamp(1024, 65535);
    let mut guard = state.speed_server.running.lock().await;
    if let Some(running) = guard.as_ref() {
        return Ok(info_for(running.port));
    }

    let abort = Arc::new(AtomicBool::new(false));
    let app = Router::new()
        .route("/__down", get(handle_down).options(handle_options))
        .route("/__up", post(handle_up).options(handle_options))
        .route("/", get(|| async { "xuanjian speed server" }));

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("bind {addr}: {e}"))?;
    let bound = listener.local_addr().map_err(|e| e.to_string())?.port();

    let abort_c = abort.clone();
    let handle = tokio::spawn(async move {
        let server = axum::serve(listener, app).with_graceful_shutdown(async move {
            while !abort_c.load(Ordering::SeqCst) {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
        });
        let _ = server.await;
    });

    *guard = Some(RunningServer {
        port: bound,
        abort,
        handle,
    });

    Ok(info_for(bound))
}

/// 停止本机内网测速服务
#[tauri::command]
pub async fn network_speed_server_stop(
    state: State<'_, Arc<NetworkState>>,
) -> Result<(), String> {
    let mut guard = state.speed_server.running.lock().await;
    if let Some(running) = guard.take() {
        running.abort.store(true, Ordering::SeqCst);
        running.handle.abort();
    }
    Ok(())
}

/// 查询测速服务状态
#[tauri::command]
pub async fn network_speed_server_status(
    state: State<'_, Arc<NetworkState>>,
) -> Result<Option<SpeedServerInfo>, String> {
    let guard = state.speed_server.running.lock().await;
    Ok(guard.as_ref().map(|r| info_for(r.port)))
}
