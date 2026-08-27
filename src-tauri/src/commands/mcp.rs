//! MCP stdio 进程：启动子进程并完成 JSON-RPC 握手。
//!
//! Author: Charlie

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDto {
    pub name: String,
    pub description: String,
    #[serde(default, rename = "inputSchema")]
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpDiscoverResult {
    pub ok: bool,
    pub tools: Vec<McpToolDto>,
    pub error: Option<String>,
}

fn write_message(stdin: &mut impl Write, value: &serde_json::Value) -> Result<(), String> {
    let line = serde_json::to_string(value).map_err(|e| e.to_string())?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|e| e.to_string())
}

fn read_response(
    stdout: &mut impl BufRead,
    expect_id: u64,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() > deadline {
            return Err("MCP stdio timeout".into());
        }
        let mut line = String::new();
        let n = stdout.read_line(&mut line).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("MCP process closed stdout".into());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let msg: serde_json::Value =
            serde_json::from_str(trimmed).map_err(|e| format!("invalid JSON: {e}"))?;
        if msg.get("method").is_some() && msg.get("id").is_none() {
            continue;
        }
        if msg.get("id").and_then(|v| v.as_u64()) == Some(expect_id) {
            if let Some(err) = msg.get("error") {
                return Err(err.to_string());
            }
            return Ok(msg
                .get("result")
                .cloned()
                .unwrap_or(serde_json::Value::Null));
        }
    }
}

fn mcp_stdio_roundtrip(
    command: &str,
    args: &[String],
    requests: Vec<(u64, &str, Option<serde_json::Value>)>,
    timeout: Duration,
) -> Result<Vec<serde_json::Value>, String> {
    let mut cmd = Command::new(command);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    crate::win_process::hide_console(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("stdout unavailable")?;
    let mut reader = BufReader::new(stdout);

    let mut results = Vec::with_capacity(requests.len());
    for (id, method, params) in requests {
        let mut req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
        });
        if let Some(p) = params {
            req["params"] = p;
        }
        write_message(&mut stdin, &req)?;
        results.push(read_response(&mut reader, id, timeout)?);
    }

    let _ = child.kill();
    let _ = child.wait();
    Ok(results)
}

fn parse_tools(result: &serde_json::Value) -> Vec<McpToolDto> {
    result
        .get("tools")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    let name = t.get("name")?.as_str()?.to_string();
                    let description = t
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let input_schema = t
                        .get("inputSchema")
                        .or_else(|| t.get("input_schema"))
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!({"type":"object","properties":{}}));
                    Some(McpToolDto {
                        name,
                        description,
                        input_schema,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn discover_blocking(command: &str, args: &[String]) -> McpDiscoverResult {
    let init_params = serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": { "name": "xuanjian", "version": "1.0.0" }
    });

    let mut cmd = Command::new(command);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    crate::win_process::hide_console(&mut cmd);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return McpDiscoverResult {
                ok: false,
                tools: vec![],
                error: Some(format!("spawn failed: {e}")),
            };
        }
    };

    let mut stdin = match child.stdin.take() {
        Some(s) => s,
        None => {
            return McpDiscoverResult {
                ok: false,
                tools: vec![],
                error: Some("stdin unavailable".into()),
            };
        }
    };
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            return McpDiscoverResult {
                ok: false,
                tools: vec![],
                error: Some("stdout unavailable".into()),
            };
        }
    };
    let mut reader = BufReader::new(stdout);
    let timeout = Duration::from_secs(15);

    let init_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": init_params,
    });
    if write_message(&mut stdin, &init_req).is_err()
        || read_response(&mut reader, 1, timeout).is_err()
    {
        let _ = child.kill();
        return McpDiscoverResult {
            ok: false,
            tools: vec![],
            error: Some("initialize failed".into()),
        };
    }

    let initialized = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
    });
    let _ = write_message(&mut stdin, &initialized);

    let list_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {},
    });
    let result = match write_message(&mut stdin, &list_req)
        .and_then(|_| read_response(&mut reader, 2, timeout))
    {
        Ok(r) => r,
        Err(e) => {
            let _ = child.kill();
            return McpDiscoverResult {
                ok: false,
                tools: vec![],
                error: Some(e),
            };
        }
    };

    let _ = child.kill();
    let _ = child.wait();
    McpDiscoverResult {
        ok: true,
        tools: parse_tools(&result),
        error: None,
    }
}

/// 探测 stdio MCP 服务器并列出工具（一次性进程）。
#[tauri::command]
pub async fn mcp_stdio_discover(
    command: String,
    args: Vec<String>,
) -> Result<McpDiscoverResult, String> {
    tauri::async_runtime::spawn_blocking(move || discover_blocking(&command, &args))
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCallResult {
    pub ok: bool,
    pub content: String,
    pub error: Option<String>,
}

fn content_to_string(result: &serde_json::Value) -> String {
    if let Some(arr) = result.get("content").and_then(|v| v.as_array()) {
        let mut parts = Vec::new();
        for item in arr {
            if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                parts.push(text.to_string());
            } else {
                parts.push(item.to_string());
            }
        }
        return parts.join("\n");
    }
    result.to_string()
}

fn call_blocking(
    command: &str,
    args: &[String],
    tool_name: &str,
    arguments: serde_json::Value,
) -> McpCallResult {
    let init_params = serde_json::json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": { "name": "xuanjian", "version": "1.0.0" }
    });
    let call_params = serde_json::json!({
        "name": tool_name,
        "arguments": arguments,
    });
    match mcp_stdio_roundtrip(
        command,
        args,
        vec![
            (1, "initialize", Some(init_params)),
            (2, "tools/call", Some(call_params)),
        ],
        Duration::from_secs(60),
    ) {
        Ok(results) => McpCallResult {
            ok: true,
            content: content_to_string(&results[1]),
            error: None,
        },
        Err(e) => McpCallResult {
            ok: false,
            content: String::new(),
            error: Some(e),
        },
    }
}

/// 在 stdio MCP 进程上执行 tools/call（一次性进程）。
#[tauri::command]
pub async fn mcp_stdio_call(
    command: String,
    args: Vec<String>,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<McpCallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        call_blocking(&command, &args, &tool_name, arguments)
    })
    .await
    .map_err(|e| e.to_string())
}
