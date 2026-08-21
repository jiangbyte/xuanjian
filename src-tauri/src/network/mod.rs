//! 本机网络运维工具：ping、DNS、TCP 探测、HTTP/TLS/WHOIS 等。
//!
//! 长时间任务通过事件流式输出，并可用 job_id 取消。
//!
//! Author: Charlie

mod parse;
pub mod speed;
pub mod speed_server;

use parse::{parse_tool_line, ToolMode};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::ToSocketAddrs;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub struct NetworkState {
    pub cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub speed_server: speed_server::SpeedServerState,
}

impl NetworkState {
    pub fn new() -> Self {
        Self {
            cancels: Mutex::new(HashMap::new()),
            speed_server: speed_server::SpeedServerState::default(),
        }
    }
}

impl Default for NetworkState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkOutputPayload {
    pub job_id: String,
    pub line: String,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<parse::NetworkToolEvent>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetInterface {
    pub name: String,
    pub addrs: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TcpProbeResult {
    pub host: String,
    pub port: u16,
    pub open: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub elapsed_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TlsCertInfo {
    pub subject: String,
    pub issuer: String,
    pub not_before: String,
    pub not_after: String,
    pub san: Vec<String>,
    pub raw: String,
}

fn emit_line(app: &AppHandle, job_id: &str, line: &str, done: bool) {
    emit_parsed(app, job_id, line, done, None);
}

fn emit_parsed(
    app: &AppHandle,
    job_id: &str,
    line: &str,
    done: bool,
    event: Option<parse::NetworkToolEvent>,
) {
    let _ = app.emit(
        "network-tool-output",
        NetworkOutputPayload {
            job_id: job_id.to_string(),
            line: line.to_string(),
            done,
            event,
        },
    );
}

fn which_bin(name: &str) -> Option<String> {
    which::which(name)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn network_list_interfaces() -> Result<Vec<NetInterface>, String> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for iface in if_addrs::get_if_addrs().map_err(|e| e.to_string())? {
        if iface.is_loopback() {
            continue;
        }
        map.entry(iface.name.clone())
            .or_default()
            .push(iface.ip().to_string());
    }
    let mut out: Vec<_> = map
        .into_iter()
        .map(|(name, addrs)| NetInterface { name, addrs })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub async fn network_ping(
    app: AppHandle,
    state: State<'_, Arc<NetworkState>>,
    target: String,
    count: Option<u32>,
) -> Result<String, String> {
    let job_id = Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    state.cancels.lock().insert(job_id.clone(), cancel.clone());

    let continuous = matches!(count, Some(0));
    let n = count
        .filter(|&c| c > 0)
        .unwrap_or(4)
        .clamp(1, 100);
    let job = job_id.clone();
    let target_c = target.clone();
    let st = state.inner().clone();

    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        let mut cmd = {
            let mut c = Command::new("ping");
            if continuous {
                c.args(["-t", &target_c]);
            } else {
                c.args(["-n", &n.to_string(), &target_c]);
            }
            crate::win_process::hide_console(&mut c);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = Command::new("ping");
            if continuous {
                c.arg(&target_c);
            } else {
                c.args(["-c", &n.to_string(), &target_c]);
            }
            c
        };
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        let mut seq_hint: u32 = 0;
        match cmd.spawn() {
            Ok(mut child) => {
                if let Some(stdout) = child.stdout.take() {
                    use std::io::{BufRead, BufReader as StdBuf};
                    let reader = StdBuf::new(stdout);
                    for line in reader.lines().flatten() {
                        if cancel.load(Ordering::SeqCst) {
                            let _ = child.kill();
                            emit_line(&app, &job, "[cancelled]", true);
                            st.cancels.lock().remove(&job);
                            return;
                        }
                        let event = parse_tool_line(&line, ToolMode::Ping, &mut seq_hint);
                        emit_parsed(&app, &job, &line, false, event);
                    }
                }
                let _ = child.wait();
                emit_line(&app, &job, "", true);
            }
            Err(e) => {
                emit_line(&app, &job, &format!("error: {e}"), true);
            }
        }
        st.cancels.lock().remove(&job);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn network_traceroute(
    app: AppHandle,
    state: State<'_, Arc<NetworkState>>,
    target: String,
) -> Result<String, String> {
    let job_id = Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    state.cancels.lock().insert(job_id.clone(), cancel.clone());
    let job = job_id.clone();
    let target_c = target.clone();
    let st = state.inner().clone();

    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        let mut cmd = {
            let mut c = Command::new("tracert");
            crate::win_process::hide_console(&mut c);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            // macOS / Linux：优先 traceroute，缺省时尝试 tracepath
            let bin = if which::which("traceroute").is_ok() {
                "traceroute"
            } else if which::which("tracepath").is_ok() {
                "tracepath"
            } else {
                "traceroute"
            };
            Command::new(bin)
        };
        cmd.arg(&target_c)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        let mut seq_hint: u32 = 0;
        match cmd.spawn() {
            Ok(mut child) => {
                if let Some(stdout) = child.stdout.take() {
                    use std::io::{BufRead, BufReader as StdBuf};
                    let reader = StdBuf::new(stdout);
                    for line in reader.lines().flatten() {
                        if cancel.load(Ordering::SeqCst) {
                            let _ = child.kill();
                            emit_line(&app, &job, "[cancelled]", true);
                            st.cancels.lock().remove(&job);
                            return;
                        }
                        let event =
                            parse_tool_line(&line, ToolMode::Traceroute, &mut seq_hint);
                        emit_parsed(&app, &job, &line, false, event);
                    }
                }
                let _ = child.wait();
                emit_line(&app, &job, "", true);
            }
            Err(e) => {
                emit_line(&app, &job, &format!("error: {e}"), true);
            }
        }
        st.cancels.lock().remove(&job);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn network_dns_lookup(host: String, record_type: String) -> Result<String, String> {
    let rtype = record_type.to_uppercase();
    tokio::task::spawn_blocking(move || {
        if rtype == "A" || rtype == "AAAA" {
            let addrs: Vec<_> = format!("{host}:0")
                .to_socket_addrs()
                .map_err(|e| e.to_string())?
                .map(|a| a.ip().to_string())
                .collect();
            if addrs.is_empty() {
                return Err("no addresses".into());
            }
            return Ok(addrs.join("\n"));
        }
        #[cfg(windows)]
        {
            let mut cmd = Command::new("nslookup");
            cmd.args(["-type", &rtype, &host]);
            crate::win_process::hide_console(&mut cmd);
            let output = cmd.output().map_err(|e| e.to_string())?;
            let text = String::from_utf8_lossy(&output.stdout);
            let err = String::from_utf8_lossy(&output.stderr);
            Ok(format!("{text}{err}"))
        }
        #[cfg(not(windows))]
        {
            let output = Command::new("dig")
                .args([&format!("+short"), &rtype, &host])
                .output()
                .or_else(|_| {
                    Command::new("nslookup")
                        .args(["-type", &rtype, &host])
                        .output()
                })
                .map_err(|e| e.to_string())?;
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn network_tcp_probe(
    host: String,
    ports: Vec<u16>,
    timeout_ms: Option<u64>,
) -> Result<Vec<TcpProbeResult>, String> {
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(800).clamp(100, 10_000));
    let mut out = Vec::new();
    for port in ports {
        let addr = format!("{host}:{port}");
        let start = std::time::Instant::now();
        let res = tokio::time::timeout(timeout, tokio::net::TcpStream::connect(&addr)).await;
        match res {
            Ok(Ok(_stream)) => {
                out.push(TcpProbeResult {
                    host: host.clone(),
                    port,
                    open: true,
                    latency_ms: Some(start.elapsed().as_millis() as u64),
                    error: None,
                });
            }
            Ok(Err(e)) => {
                out.push(TcpProbeResult {
                    host: host.clone(),
                    port,
                    open: false,
                    latency_ms: None,
                    error: Some(e.to_string()),
                });
            }
            Err(_) => {
                out.push(TcpProbeResult {
                    host: host.clone(),
                    port,
                    open: false,
                    latency_ms: None,
                    error: Some("timeout".into()),
                });
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn network_cancel(state: State<'_, Arc<NetworkState>>, job_id: String) -> Result<(), String> {
    if let Some(flag) = state.cancels.lock().get(&job_id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub async fn network_http_request(
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    follow_redirect: Option<bool>,
) -> Result<HttpResponse, String> {
    let follow = follow_redirect.unwrap_or(true);
    let client = reqwest::Client::builder()
        .redirect(if follow {
            reqwest::redirect::Policy::limited(10)
        } else {
            reqwest::redirect::Policy::none()
        })
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client.request(method, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let start = std::time::Instant::now();
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let headers: Vec<_> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let mut body = resp.text().await.map_err(|e| e.to_string())?;
    if body.len() > 512 * 1024 {
        body.truncate(512 * 1024);
        body.push_str("\n…[truncated]");
    }
    Ok(HttpResponse {
        status,
        headers,
        body,
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn network_tls_cert(host_port: String) -> Result<TlsCertInfo, String> {
    let target = if host_port.contains(':') {
        host_port.clone()
    } else {
        format!("{host_port}:443")
    };
    tokio::task::spawn_blocking(move || {
        // Prefer openssl if available
        if let Some(openssl) = which_bin("openssl") {
            let mut cmd = Command::new(openssl);
            cmd.args([
                "s_client",
                "-connect",
                &target,
                "-servername",
                target.split(':').next().unwrap_or(&target),
                "-showcerts",
            ])
            .stdin(Stdio::null());
            crate::win_process::hide_console(&mut cmd);
            let output = cmd.output().map_err(|e| e.to_string())?;
            let raw = String::from_utf8_lossy(&output.stdout);
            let subject = extract_field(&raw, "subject=").unwrap_or_default();
            let issuer = extract_field(&raw, "issuer=").unwrap_or_default();
            return Ok(TlsCertInfo {
                subject,
                issuer,
                not_before: String::new(),
                not_after: String::new(),
                san: vec![],
                raw: raw.chars().take(8000).collect(),
            });
        }
        Err("openssl not found; install OpenSSL or Wireshark tools for cert inspect".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn extract_field(raw: &str, prefix: &str) -> Option<String> {
    raw.lines()
        .find(|l| l.trim_start().starts_with(prefix))
        .map(|l| l.trim().trim_start_matches(prefix).to_string())
}

#[tauri::command]
pub async fn network_whois(query: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        if let Some(bin) = which_bin("whois") {
            let mut cmd = Command::new(bin);
            cmd.arg(&query);
            crate::win_process::hide_console(&mut cmd);
            let output = cmd.output().map_err(|e| e.to_string())?;
            return Ok(String::from_utf8_lossy(&output.stdout).to_string());
        }
        // Minimal WHOIS over TCP 43 to whois.iana.org then follow
        use std::io::{Read, Write};
        use std::net::TcpStream;
        let mut stream = TcpStream::connect_timeout(
            &"whois.iana.org:43"
                .to_socket_addrs()
                .map_err(|e| e.to_string())?
                .next()
                .ok_or("resolve failed")?,
            std::time::Duration::from_secs(8),
        )
        .map_err(|e| e.to_string())?;
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(8)))
            .ok();
        writeln!(stream, "{query}").map_err(|e| e.to_string())?;
        let mut buf = String::new();
        stream.read_to_string(&mut buf).map_err(|e| e.to_string())?;
        Ok(buf)
    })
    .await
    .map_err(|e| e.to_string())?
}
