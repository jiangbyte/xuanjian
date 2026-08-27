//! 聊天补全代理：非流式与 SSE 流式，经 Tauri 事件回传前端。
//!
//! Author: Charlie

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use super::AiState;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatProxyParams {
    pub base_url: String,
    pub api_format: String,
    pub api_key: String,
    pub model: String,
    pub messages: Value,
    pub tools: Option<Value>,
    pub stream: Option<bool>,
    /// off | high | max — 思考/推理强度
    pub thinking_mode: Option<String>,
    /// 最大输出 token；缺省按协议默认
    pub max_tokens: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatChunk {
    pub job_id: String,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Value>,
}

/// 按 API 协议标准拼接补全端点。
///
/// - OpenAI 兼容：`{base}/v1/chat/completions`
/// - Anthropic：`{base}/v1/messages`
///
/// `base` 可为根地址（如 `https://api.example.com`）、已含 `/v1`，
/// 或已是完整 path（`…/chat/completions` / `…/messages`）。不按供应商特例改写路径。
fn join_endpoint(base: &str, kind: &str) -> String {
    let b = base.trim().trim_end_matches('/').to_string();
    match kind {
        "anthropic" => {
            if b.ends_with("/messages") {
                b
            } else if b.ends_with("/v1") {
                format!("{b}/messages")
            } else {
                format!("{b}/v1/messages")
            }
        }
        // openai / responses / 其它：统一走 chat/completions
        _ => {
            if b.ends_with("/chat/completions") {
                b
            } else if b.ends_with("/v1") {
                format!("{b}/chat/completions")
            } else {
                format!("{b}/v1/chat/completions")
            }
        }
    }
}

fn openai_url(base: &str) -> String {
    join_endpoint(base, "openai")
}

fn anthropic_url(base: &str) -> String {
    join_endpoint(base, "anthropic")
}

fn http_err(kind: &str, url: &str, status: reqwest::StatusCode, body: &str) -> String {
    let hint = if status.as_u16() == 404 {
        "（请核对 Base URL 与 API 格式是否匹配：OpenAI 兼容用根地址；Anthropic 用对应 Messages 入口）"
    } else {
        ""
    };
    let truncated = if body.len() > 400 {
        format!("{}…", &body[..400])
    } else {
        body.to_string()
    };
    format!("{kind} {status} @ {url}: {truncated}{hint}")
}

#[derive(Default, Clone)]
struct OpenAiToolCallAcc {
    id: String,
    name: String,
    arguments: String,
}

fn merge_openai_tool_delta(acc: &mut BTreeMap<usize, OpenAiToolCallAcc>, delta: &Value) {
    let Some(arr) = delta.as_array() else {
        return;
    };
    for item in arr {
        let idx = item.get("index").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
        let entry = acc.entry(idx).or_default();
        if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
            entry.id.push_str(id);
        }
        if let Some(name) = item.pointer("/function/name").and_then(|x| x.as_str()) {
            entry.name.push_str(name);
        }
        if let Some(args) = item.pointer("/function/arguments").and_then(|x| x.as_str()) {
            entry.arguments.push_str(args);
        }
    }
}

fn openai_tool_acc_to_json(acc: &BTreeMap<usize, OpenAiToolCallAcc>) -> Value {
    let calls: Vec<Value> = acc
        .values()
        .map(|t| {
            let arguments = if t.arguments.is_empty() {
                "{}".to_string()
            } else {
                t.arguments.clone()
            };
            json!({
                "id": t.id,
                "type": "function",
                "function": {
                    "name": t.name,
                    "arguments": arguments,
                }
            })
        })
        .collect();
    Value::Array(calls)
}

#[derive(Clone)]
struct AnthropicToolBlock {
    id: String,
    name: String,
    arguments: String,
}

fn anthropic_tools_to_openai_json(blocks: &[AnthropicToolBlock]) -> Value {
    let calls: Vec<Value> = blocks
        .iter()
        .map(|t| {
            let arguments = if t.arguments.is_empty() {
                "{}".to_string()
            } else {
                t.arguments.clone()
            };
            json!({
                "id": t.id,
                "type": "function",
                "function": {
                    "name": t.name,
                    "arguments": arguments,
                }
            })
        })
        .collect();
    Value::Array(calls)
}

fn apply_thinking_mode(body: &mut Value, api_format: &str, mode: &str) {
    let mode = mode.trim().to_lowercase();
    if api_format == "anthropic" {
        // Anthropic Messages：thinking.enabled / disabled + 可选 budget
        match mode.as_str() {
            "off" => {
                body["thinking"] = json!({ "type": "disabled" });
            }
            "max" => {
                body["thinking"] = json!({
                    "type": "enabled",
                    "budget_tokens": 16000
                });
                body["output_config"] = json!({ "effort": "max" });
            }
            _ => {
                body["thinking"] = json!({
                    "type": "enabled",
                    "budget_tokens": 8000
                });
                body["output_config"] = json!({ "effort": "high" });
            }
        }
        return;
    }
    // OpenAI 兼容：thinking + reasoning_effort（不支持的供应商会忽略未知字段）
    match mode.as_str() {
        "off" => {
            body["thinking"] = json!({ "type": "disabled" });
            body.as_object_mut().map(|o| o.remove("reasoning_effort"));
        }
        "max" => {
            body["thinking"] = json!({ "type": "enabled" });
            body["reasoning_effort"] = json!("max");
        }
        _ => {
            body["thinking"] = json!({ "type": "enabled" });
            body["reasoning_effort"] = json!("high");
        }
    }
}

/// 一次性聊天（非流式），返回完整 JSON
#[tauri::command]
pub async fn ai_chat_completion(params: ChatProxyParams) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;
    let thinking = params
        .thinking_mode
        .as_deref()
        .unwrap_or("high")
        .to_string();
    if params.api_format == "anthropic" {
        let url = anthropic_url(&params.base_url);
        let mut body = openai_messages_to_anthropic(&params)?;
        apply_thinking_mode(&mut body, "anthropic", &thinking);
        if let Some(mt) = params.max_tokens.filter(|n| *n > 0) {
            body["max_tokens"] = json!(mt);
        }
        let resp = client
            .post(&url)
            .header("x-api-key", &params.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("请求失败 {url}: {e}"))?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(http_err("anthropic", &url, status, &text));
        }
        serde_json::from_str(&text).map_err(|e| e.to_string())
    } else {
        let url = openai_url(&params.base_url);
        let mut body = json!({
            "model": params.model,
            "messages": params.messages,
            "stream": false,
        });
        if let Some(tools) = params.tools.clone() {
            body["tools"] = tools;
        }
        if let Some(mt) = params.max_tokens.filter(|n| *n > 0) {
            body["max_tokens"] = json!(mt);
        }
        apply_thinking_mode(&mut body, &params.api_format, &thinking);
        let resp = client
            .post(&url)
            .bearer_auth(&params.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("请求失败 {url}: {e}"))?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(http_err("openai", &url, status, &text));
        }
        serde_json::from_str(&text).map_err(|e| e.to_string())
    }
}

fn openai_messages_to_anthropic(params: &ChatProxyParams) -> Result<Value, String> {
    let msgs = params
        .messages
        .as_array()
        .ok_or_else(|| "messages must be array".to_string())?;
    let mut system = String::new();
    let mut out = Vec::new();

    for m in msgs {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("user");

        if role == "system" {
            let content = content_as_string(m.get("content"));
            if !system.is_empty() {
                system.push('\n');
            }
            system.push_str(&content);
            continue;
        }

        // 已是 Anthropic content blocks（前端归一后回传）
        if let Some(blocks) = m.get("anthropic_content").and_then(|c| c.as_array()) {
            let ar = if role == "assistant" { "assistant" } else { "user" };
            out.push(json!({ "role": ar, "content": blocks }));
            continue;
        }

        if role == "assistant" {
            let mut blocks = Vec::new();
            let text = content_as_string(m.get("content"));
            if !text.is_empty() {
                blocks.push(json!({ "type": "text", "text": text }));
            }
            if let Some(tcs) = m.get("tool_calls").and_then(|t| t.as_array()) {
                for tc in tcs {
                    let id = tc.get("id").and_then(|x| x.as_str()).unwrap_or("");
                    let name = tc
                        .pointer("/function/name")
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    let args_str = tc
                        .pointer("/function/arguments")
                        .and_then(|x| x.as_str())
                        .unwrap_or("{}");
                    let input: Value =
                        serde_json::from_str(args_str).unwrap_or_else(|_| json!({}));
                    blocks.push(json!({
                        "type": "tool_use",
                        "id": id,
                        "name": name,
                        "input": input,
                    }));
                }
            }
            if blocks.is_empty() {
                blocks.push(json!({ "type": "text", "text": "" }));
            }
            out.push(json!({ "role": "assistant", "content": blocks }));
            continue;
        }

        if role == "tool" {
            let tool_use_id = m
                .get("tool_call_id")
                .and_then(|x| x.as_str())
                .unwrap_or("");
            let content = content_as_string(m.get("content"));
            // Anthropic：tool_result 必须挂在 user 消息上；合并相邻 tool 结果
            let block = json!({
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": content,
            });
            if let Some(last) = out.last_mut() {
                if last.get("role").and_then(|r| r.as_str()) == Some("user") {
                    if let Some(arr) = last.get_mut("content").and_then(|c| c.as_array_mut()) {
                        if arr.iter().any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result")) {
                            arr.push(block);
                            continue;
                        }
                    }
                }
            }
            out.push(json!({ "role": "user", "content": [block] }));
            continue;
        }

        // user
        if let Some(arr) = m.get("content").and_then(|c| c.as_array()) {
            out.push(json!({ "role": "user", "content": arr }));
        } else {
            out.push(json!({
                "role": "user",
                "content": content_as_string(m.get("content")),
            }));
        }
    }

    let max_tokens = params
        .max_tokens
        .filter(|n| *n > 0)
        .unwrap_or(4096);
    let mut body = json!({
        "model": params.model,
        "max_tokens": max_tokens,
        "messages": out,
    });
    if !system.is_empty() {
        body["system"] = json!(system);
    }

    // tools：支持 OpenAI 风格或已是 Anthropic 风格
    if let Some(tools) = &params.tools {
        body["tools"] = openai_tools_to_anthropic(tools);
    }
    Ok(body)
}

fn content_as_string(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.as_str().unwrap_or("").to_string(),
        None => String::new(),
    }
}

fn openai_tools_to_anthropic(tools: &Value) -> Value {
    let Some(arr) = tools.as_array() else {
        return tools.clone();
    };
    // 已是 Anthropic：带 input_schema
    if arr.first().and_then(|t| t.get("input_schema")).is_some() {
        return tools.clone();
    }
    let mapped: Vec<Value> = arr
        .iter()
        .filter_map(|t| {
            let f = t.get("function")?;
            Some(json!({
                "name": f.get("name")?,
                "description": f.get("description").cloned().unwrap_or(json!("")),
                "input_schema": f.get("parameters").cloned().unwrap_or(json!({
                    "type": "object",
                    "properties": {},
                })),
            }))
        })
        .collect();
    Value::Array(mapped)
}

/// 流式聊天：返回 job_id，块经 `ai-chat-chunk` 事件推送
#[tauri::command]
pub async fn ai_chat_stream(
    app: AppHandle,
    state: State<'_, Arc<AiState>>,
    params: ChatProxyParams,
) -> Result<String, String> {
    let job_id = Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .stream_cancels
        .lock()
        .insert(job_id.clone(), cancel.clone());

    let job = job_id.clone();
    tokio::spawn(async move {
        let result = run_stream(&app, &job, &params, cancel.clone()).await;
        if let Err(e) = result {
            let _ = app.emit(
                "ai-chat-chunk",
                AiChatChunk {
                    job_id: job.clone(),
                    done: true,
                    delta: None,
                    thinking: None,
                    tool_calls: None,
                    error: Some(e),
                    raw: None,
                    usage: None,
                },
            );
        }
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn ai_chat_cancel(
    state: State<'_, Arc<AiState>>,
    job_id: String,
) -> Result<(), String> {
    if let Some(c) = state.stream_cancels.lock().remove(&job_id) {
        c.store(true, Ordering::SeqCst);
    }
    Ok(())
}

async fn run_stream(
    app: &AppHandle,
    job_id: &str,
    params: &ChatProxyParams,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;
    let use_stream = params.stream.unwrap_or(true);
    let thinking = params
        .thinking_mode
        .as_deref()
        .unwrap_or("high")
        .to_string();

    if !use_stream {
        let mut p = params.clone();
        p.stream = Some(false);
        let raw = ai_chat_completion(p).await?;
        let (text, thinking, tools) = extract_from_response(&params.api_format, &raw);
        if let Some(t) = thinking {
            let _ = app.emit(
                "ai-chat-chunk",
                AiChatChunk {
                    job_id: job_id.into(),
                    done: false,
                    delta: None,
                    thinking: Some(t),
                    tool_calls: None,
                    error: None,
                    raw: None,
                    usage: None,
                },
            );
        }
        if !text.is_empty() {
            let _ = app.emit(
                "ai-chat-chunk",
                AiChatChunk {
                    job_id: job_id.into(),
                    done: false,
                    delta: Some(text),
                    thinking: None,
                    tool_calls: None,
                    error: None,
                    raw: None,
                    usage: None,
                },
            );
        }
        let usage = raw.get("usage").cloned();
        let _ = app.emit(
            "ai-chat-chunk",
            AiChatChunk {
                job_id: job_id.into(),
                done: true,
                delta: None,
                thinking: None,
                tool_calls: tools,
                error: None,
                raw: Some(raw),
                usage,
            },
        );
        return Ok(());
    }

    if params.api_format == "anthropic" {
        return run_anthropic_stream(app, job_id, params, &client, &thinking, cancel).await;
    }

    run_openai_stream(app, job_id, params, &client, &thinking, cancel).await
}

async fn run_openai_stream(
    app: &AppHandle,
    job_id: &str,
    params: &ChatProxyParams,
    client: &reqwest::Client,
    thinking: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let url = openai_url(&params.base_url);
    let mut body = json!({
        "model": params.model,
        "messages": params.messages,
        "stream": true,
        "stream_options": { "include_usage": true },
    });
    if let Some(tools) = &params.tools {
        body["tools"] = tools.clone();
    }
    if let Some(mt) = params.max_tokens.filter(|n| *n > 0) {
        body["max_tokens"] = json!(mt);
    }
    apply_thinking_mode(&mut body, &params.api_format, thinking);

    let resp = client
        .post(&url)
        .bearer_auth(&params.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("openai {status}: {text}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut tool_acc: BTreeMap<usize, OpenAiToolCallAcc> = BTreeMap::new();
    let mut last_usage: Option<Value> = None;

    while let Some(item) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let chunk = item.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf = buf[pos + 1..].to_string();
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            let data = line.strip_prefix("data:").map(str::trim).unwrap_or(&line);
            if data == "[DONE]" {
                let tools = if tool_acc.is_empty() {
                    None
                } else {
                    Some(openai_tool_acc_to_json(&tool_acc))
                };
                let _ = app.emit(
                    "ai-chat-chunk",
                    AiChatChunk {
                        job_id: job_id.into(),
                        done: true,
                        delta: None,
                        thinking: None,
                        tool_calls: tools,
                        error: None,
                        raw: None,
                        usage: last_usage.clone(),
                    },
                );
                return Ok(());
            }
            if let Ok(v) = serde_json::from_str::<Value>(data) {
                if let Some(u) = v.get("usage") {
                    if !u.is_null() {
                        last_usage = Some(u.clone());
                    }
                }
                if let Some(delta) = v
                    .pointer("/choices/0/delta/content")
                    .and_then(|c| c.as_str())
                {
                    if !delta.is_empty() {
                        let _ = app.emit(
                            "ai-chat-chunk",
                            AiChatChunk {
                                job_id: job_id.into(),
                                done: false,
                                delta: Some(delta.to_string()),
                                thinking: None,
                                tool_calls: None,
                                error: None,
                                raw: None,
                                usage: None,
                            },
                        );
                    }
                }
                if let Some(reasoning) = v
                    .pointer("/choices/0/delta/reasoning_content")
                    .and_then(|c| c.as_str())
                    .or_else(|| {
                        v.pointer("/choices/0/delta/thinking")
                            .and_then(|c| c.as_str())
                    })
                {
                    if !reasoning.is_empty() {
                        let _ = app.emit(
                            "ai-chat-chunk",
                            AiChatChunk {
                                job_id: job_id.into(),
                                done: false,
                                delta: None,
                                thinking: Some(reasoning.to_string()),
                                tool_calls: None,
                                error: None,
                                raw: None,
                                usage: None,
                            },
                        );
                    }
                }
                if let Some(tc) = v.pointer("/choices/0/delta/tool_calls") {
                    merge_openai_tool_delta(&mut tool_acc, tc);
                }
            }
        }
    }

    let tools = if tool_acc.is_empty() {
        None
    } else {
        Some(openai_tool_acc_to_json(&tool_acc))
    };
    let _ = app.emit(
        "ai-chat-chunk",
        AiChatChunk {
            job_id: job_id.into(),
            done: true,
            delta: None,
            thinking: None,
            tool_calls: tools,
            error: None,
            raw: None,
            usage: last_usage,
        },
    );
    Ok(())
}

async fn run_anthropic_stream(
    app: &AppHandle,
    job_id: &str,
    params: &ChatProxyParams,
    client: &reqwest::Client,
    thinking: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let url = anthropic_url(&params.base_url);
    let mut body = openai_messages_to_anthropic(params)?;
    apply_thinking_mode(&mut body, "anthropic", thinking);
    body["stream"] = json!(true);

    let resp = client
        .post(&url)
        .header("x-api-key", &params.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(http_err("anthropic", &url, status, &text));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut tool_blocks: Vec<AnthropicToolBlock> = Vec::new();
    let mut current_tool_idx: Option<usize> = None;
    let mut last_usage: Option<Value> = None;

    while let Some(item) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let chunk = item.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf = buf[pos + 1..].to_string();
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            if !line.starts_with("data:") {
                continue;
            }
            let data = line.strip_prefix("data:").map(str::trim).unwrap_or("");
            if data.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            let ev_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

            match ev_type {
                "message_start" => {
                    if let Some(u) = v.pointer("/message/usage") {
                        last_usage = Some(u.clone());
                    }
                }
                "content_block_start" => {
                    if let Some(block) = v.get("content_block") {
                        let bt = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        if bt == "tool_use" {
                            tool_blocks.push(AnthropicToolBlock {
                                id: block
                                    .get("id")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                name: block
                                    .get("name")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                arguments: String::new(),
                            });
                            current_tool_idx = Some(tool_blocks.len() - 1);
                        }
                    }
                }
                "content_block_delta" => {
                    if let Some(delta) = v.get("delta") {
                        let dt = delta.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        if dt == "thinking_delta" {
                            if let Some(t) = delta.get("thinking").and_then(|x| x.as_str()) {
                                if !t.is_empty() {
                                    let _ = app.emit(
                                        "ai-chat-chunk",
                                        AiChatChunk {
                                            job_id: job_id.into(),
                                            done: false,
                                            delta: None,
                                            thinking: Some(t.to_string()),
                                            tool_calls: None,
                                            error: None,
                                            raw: None,
                                            usage: None,
                                        },
                                    );
                                }
                            }
                        } else if dt == "text_delta" {
                            if let Some(t) = delta.get("text").and_then(|x| x.as_str()) {
                                if !t.is_empty() {
                                    let _ = app.emit(
                                        "ai-chat-chunk",
                                        AiChatChunk {
                                            job_id: job_id.into(),
                                            done: false,
                                            delta: Some(t.to_string()),
                                            thinking: None,
                                            tool_calls: None,
                                            error: None,
                                            raw: None,
                                            usage: None,
                                        },
                                    );
                                }
                            }
                        } else if dt == "input_json_delta" {
                            if let (Some(idx), Some(partial)) = (
                                current_tool_idx,
                                delta.get("partial_json").and_then(|x| x.as_str()),
                            ) {
                                if let Some(tb) = tool_blocks.get_mut(idx) {
                                    tb.arguments.push_str(partial);
                                }
                            }
                        }
                    }
                }
                "message_delta" => {
                    if let Some(u) = v.get("usage") {
                        last_usage = Some(u.clone());
                    }
                }
                "message_stop" => {
                    let tools = if tool_blocks.is_empty() {
                        None
                    } else {
                        Some(anthropic_tools_to_openai_json(&tool_blocks))
                    };
                    let _ = app.emit(
                        "ai-chat-chunk",
                        AiChatChunk {
                            job_id: job_id.into(),
                            done: true,
                            delta: None,
                            thinking: None,
                            tool_calls: tools,
                            error: None,
                            raw: None,
                            usage: last_usage.clone(),
                        },
                    );
                    return Ok(());
                }
                _ => {}
            }
        }
    }

    let tools = if tool_blocks.is_empty() {
        None
    } else {
        Some(anthropic_tools_to_openai_json(&tool_blocks))
    };
    let _ = app.emit(
        "ai-chat-chunk",
        AiChatChunk {
            job_id: job_id.into(),
            done: true,
            delta: None,
            thinking: None,
            tool_calls: tools,
            error: None,
            raw: None,
            usage: last_usage,
        },
    );
    Ok(())
}

fn extract_from_response(format: &str, raw: &Value) -> (String, Option<String>, Option<Value>) {
    if format == "anthropic" {
        let mut text = String::new();
        let mut thinking = None;
        if let Some(arr) = raw.get("content").and_then(|c| c.as_array()) {
            for block in arr {
                let t = block.get("type").and_then(|x| x.as_str()).unwrap_or("");
                let c = block
                    .get("text")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                if t == "thinking" || t == "reasoning" {
                    thinking = Some(c);
                } else if t == "text" || t.is_empty() {
                    text.push_str(&c);
                }
            }
        }
        return (text, thinking, raw.get("tool_use").cloned());
    }
    let text = raw
        .pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    let thinking = raw
        .pointer("/choices/0/message/reasoning_content")
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());
    let tools = raw.pointer("/choices/0/message/tool_calls").cloned();
    (text, thinking, tools)
}
