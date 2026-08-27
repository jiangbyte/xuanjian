//! Ping / traceroute 输出解析：尽量从系统 CLI 原文抽出结构化字段。
//!
//! Author: Charlie

use serde::Serialize;

/// 发给前端的结构化事件（可选字段按 kind 填充）
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkToolEvent {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seq: Option<u32>,
    /// `Some(None)` 在 serde 里不好表达超时；用 `rtt_ms: Option<f64>` + `lost: bool`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtt_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lost: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hop: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtts: Option<Vec<Option<f64>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loss_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recv: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_ms: Option<f64>,
}

fn ping_sample(seq: u32, rtt_ms: Option<f64>, lost: bool, ttl: Option<u32>) -> NetworkToolEvent {
    NetworkToolEvent {
        kind: "ping_sample".into(),
        seq: Some(seq),
        rtt_ms,
        lost: Some(lost),
        ttl,
        hop: None,
        host: None,
        ip: None,
        rtts: None,
        loss_pct: None,
        sent: None,
        recv: None,
        min_ms: None,
        avg_ms: None,
        max_ms: None,
    }
}

/// 解析一行 ping / traceroute 输出；无法识别则返回 None。
pub fn parse_tool_line(line: &str, mode: ToolMode, seq_hint: &mut u32) -> Option<NetworkToolEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    match mode {
        ToolMode::Ping => parse_ping_line(trimmed, seq_hint),
        ToolMode::Traceroute => parse_trace_line(trimmed),
    }
}

#[derive(Clone, Copy)]
pub enum ToolMode {
    Ping,
    Traceroute,
}

fn parse_ping_line(line: &str, seq_hint: &mut u32) -> Option<NetworkToolEvent> {
    let lower = line.to_ascii_lowercase();

    if looks_like_ping_timeout(line) {
        *seq_hint += 1;
        return Some(ping_sample(*seq_hint, None, true, None));
    }

    // Reply with RTT (Win / Unix / 中文)
    if let Some(rtt) = extract_time_ms(line) {
        let ttl = extract_ttl(line);
        let seq = extract_icmp_seq(line).unwrap_or_else(|| {
            *seq_hint += 1;
            *seq_hint
        });
        if let Some(s) = extract_icmp_seq(line) {
            *seq_hint = (*seq_hint).max(s);
        }
        return Some(ping_sample(seq, Some(rtt), false, ttl));
    }

    if let Some(ev) = parse_ping_summary_win(line) {
        return Some(ev);
    }
    if let Some(ev) = parse_ping_summary_unix(line) {
        return Some(ev);
    }
    if let Some(ev) = parse_rtt_stats_unix(line) {
        return Some(ev);
    }
    if let Some(ev) = parse_rtt_stats_win(line) {
        return Some(ev);
    }

    let _ = lower;
    None
}

fn looks_like_ping_timeout(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("request timed out")
        || line.contains("请求超时")
        || (lower.contains("timed out")
            && !lower.contains("packets")
            && !lower.contains("statistics"))
}

fn extract_time_ms(line: &str) -> Option<f64> {
    // time=12.3 ms | time=12ms | time<1ms | 时间=12ms | 时间=12毫秒
    let patterns = [
        r"(?i)time[=<>]\s*([\d.]+)\s*ms",
        r"时间[=<>]\s*([\d.]+)\s*(?:ms|毫秒)?",
        r"(?i)time[=<>]\s*([\d.]+)",
    ];
    for p in patterns {
        if let Ok(re) = regex::Regex::new(p) {
            if let Some(c) = re.captures(line) {
                if let Ok(v) = c[1].parse::<f64>() {
                    return Some(v);
                }
            }
        }
    }
    None
}

fn extract_ttl(line: &str) -> Option<u32> {
    let re = regex::Regex::new(r"(?i)ttl[=:]?\s*(\d+)").ok()?;
    re.captures(line).and_then(|c| c[1].parse().ok())
}

fn extract_icmp_seq(line: &str) -> Option<u32> {
    let re = regex::Regex::new(r"(?i)icmp_seq[=:]?\s*(\d+)").ok()?;
    re.captures(line).and_then(|c| c[1].parse().ok())
}

fn parse_ping_summary_win(line: &str) -> Option<NetworkToolEvent> {
    let sent_re = regex::Regex::new(r"(?i)(?:sent|已发送)\s*=\s*(\d+)").ok()?;
    let recv_re = regex::Regex::new(r"(?i)(?:received|已接收)\s*=\s*(\d+)").ok()?;
    let loss_re = regex::Regex::new(r"(?i)(?:lost|丢失)\s*=\s*(\d+)\s*\((\d+(?:\.\d+)?)%").ok()?;
    let sent_c = sent_re.captures(line)?;
    let sent: u32 = sent_c[1].parse().ok()?;
    let recv: u32 = recv_re
        .captures(line)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0);
    let loss_pct = loss_re.captures(line).and_then(|c| c[2].parse().ok());
    Some(NetworkToolEvent {
        kind: "ping_summary".into(),
        seq: None,
        rtt_ms: None,
        lost: None,
        ttl: None,
        hop: None,
        host: None,
        ip: None,
        rtts: None,
        loss_pct,
        sent: Some(sent),
        recv: Some(recv),
        min_ms: None,
        avg_ms: None,
        max_ms: None,
    })
}

fn parse_ping_summary_unix(line: &str) -> Option<NetworkToolEvent> {
    let re = regex::Regex::new(
        r"(?i)(\d+)\s+packets?\s+transmitted,\s+(\d+)\s+(?:packets?\s+)?received.*?(\d+(?:\.\d+)?)%\s+packet\s+loss",
    )
    .ok()?;
    let c = re.captures(line)?;
    Some(NetworkToolEvent {
        kind: "ping_summary".into(),
        seq: None,
        rtt_ms: None,
        lost: None,
        ttl: None,
        hop: None,
        host: None,
        ip: None,
        rtts: None,
        loss_pct: c[3].parse().ok(),
        sent: c[1].parse().ok(),
        recv: c[2].parse().ok(),
        min_ms: None,
        avg_ms: None,
        max_ms: None,
    })
}

fn parse_rtt_stats_unix(line: &str) -> Option<NetworkToolEvent> {
    let re = regex::Regex::new(
        r"(?i)(?:rtt|round-trip)\s+min/avg/max(?:/[^=]+)?\s*=\s*([\d.]+)/([\d.]+)/([\d.]+)",
    )
    .ok()?;
    let c = re.captures(line)?;
    Some(NetworkToolEvent {
        kind: "ping_summary".into(),
        seq: None,
        rtt_ms: None,
        lost: None,
        ttl: None,
        hop: None,
        host: None,
        ip: None,
        rtts: None,
        loss_pct: None,
        sent: None,
        recv: None,
        min_ms: c[1].parse().ok(),
        avg_ms: c[2].parse().ok(),
        max_ms: c[3].parse().ok(),
    })
}

fn parse_rtt_stats_win(line: &str) -> Option<NetworkToolEvent> {
    let min_re = regex::Regex::new(r"(?i)(?:minimum|最短)\s*=\s*([\d.]+)\s*ms").ok()?;
    let max_re = regex::Regex::new(r"(?i)(?:maximum|最长)\s*=\s*([\d.]+)\s*ms").ok()?;
    let avg_re = regex::Regex::new(r"(?i)(?:average|平均)\s*=\s*([\d.]+)\s*ms").ok()?;
    let min_ms = min_re.captures(line)?.get(1)?.as_str().parse().ok()?;
    let max_ms = max_re.captures(line).and_then(|c| c[1].parse().ok());
    let avg_ms = avg_re.captures(line).and_then(|c| c[1].parse().ok());
    if max_ms.is_none() && avg_ms.is_none() {
        return None;
    }
    Some(NetworkToolEvent {
        kind: "ping_summary".into(),
        seq: None,
        rtt_ms: None,
        lost: None,
        ttl: None,
        hop: None,
        host: None,
        ip: None,
        rtts: None,
        loss_pct: None,
        sent: None,
        recv: None,
        min_ms: Some(min_ms),
        avg_ms,
        max_ms,
    })
}

fn parse_trace_line(line: &str) -> Option<NetworkToolEvent> {
    let trimmed = line.trim();
    // skip headers
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("tracing")
        || lower.starts_with("traceroute")
        || trimmed.starts_with("通过最多")
        || trimmed.contains("的路由")
        || lower.contains("hop") && lower.contains("rtt")
    {
        return None;
    }

    // Windows tracert: "  1    <1 ms    <1 ms    <1 ms  router [192.168.1.1]"
    // or "  2     *        *        *     请求超时。"
    if let Some(ev) = parse_tracert_win(trimmed) {
        return Some(ev);
    }
    // Unix: " 1  gateway (192.168.1.1)  1.234 ms  1.1 ms  1.0 ms"
    // or " 2  * * *"
    parse_traceroute_unix(trimmed)
}

fn parse_ms_token(tok: &str) -> Option<Option<f64>> {
    let t = tok.trim();
    if t == "*" {
        return Some(None);
    }
    // <1 ms / 1 ms / 1.2ms
    let re = regex::Regex::new(r"^<?([\d.]+)\s*ms$").ok()?;
    if let Some(c) = re.captures(t) {
        return c[1].parse().ok().map(Some);
    }
    None
}

fn parse_tracert_win(line: &str) -> Option<NetworkToolEvent> {
    let re = regex::Regex::new(r"(?i)^\s*(\d+)\s+(?:(<\d+\s*ms|\d+\s*ms|\*)\s+){1,3}(.*)$").ok()?;
    let c = re.captures(line)?;
    let hop: u32 = c[1].parse().ok()?;

    // Collect up to 3 RTT tokens after hop number
    let rest_after_hop = line.trim_start();
    let after_num = rest_after_hop
        .strip_prefix(&c[1])
        .unwrap_or(rest_after_hop)
        .trim_start();
    let mut rtts: Vec<Option<f64>> = Vec::new();
    let mut remaining = after_num;
    for _ in 0..3 {
        let tok = if remaining.starts_with('*') {
            let t = "*";
            remaining = remaining[1..].trim_start();
            t.to_string()
        } else if let Some(m) = regex::Regex::new(r"(?i)^<?\d+\s*ms")
            .ok()
            .and_then(|r| r.find(remaining))
        {
            let t = m.as_str().to_string();
            remaining = remaining[m.end()..].trim_start();
            t
        } else {
            break;
        };
        if let Some(v) = parse_ms_token(&tok) {
            rtts.push(v);
        } else if tok == "*" {
            rtts.push(None);
        } else {
            break;
        }
    }
    if rtts.is_empty() {
        return None;
    }

    let host_part = remaining.trim();
    let (host, ip) = split_host_ip(host_part);

    Some(NetworkToolEvent {
        kind: "trace_hop".into(),
        seq: None,
        rtt_ms: rtts.iter().flatten().copied().next(),
        lost: Some(rtts.iter().all(|x| x.is_none())),
        ttl: None,
        hop: Some(hop),
        host,
        ip,
        rtts: Some(rtts),
        loss_pct: None,
        sent: None,
        recv: None,
        min_ms: None,
        avg_ms: None,
        max_ms: None,
    })
}

fn parse_traceroute_unix(line: &str) -> Option<NetworkToolEvent> {
    let re = regex::Regex::new(r"^\s*(\d+)\s+(.*)$").ok()?;
    let c = re.captures(line)?;
    let hop: u32 = c[1].parse().ok()?;
    let rest = c[2].trim();

    // * * *
    if rest.chars().filter(|ch| *ch == '*').count() >= 1
        && !rest.contains('(')
        && !regex::Regex::new(r"\d+\s*ms")
            .ok()
            .map(|r| r.is_match(rest))
            .unwrap_or(false)
    {
        let stars = rest.matches('*').count().min(3);
        let rtts = vec![None; stars.max(1)];
        return Some(NetworkToolEvent {
            kind: "trace_hop".into(),
            seq: None,
            rtt_ms: None,
            lost: Some(true),
            ttl: None,
            hop: Some(hop),
            host: None,
            ip: None,
            rtts: Some(rtts),
            loss_pct: None,
            sent: None,
            recv: None,
            min_ms: None,
            avg_ms: None,
            max_ms: None,
        });
    }

    // host (ip) 1.2 ms 1.3 ms ...
    let host_re = regex::Regex::new(r"^(\S+)\s+\(([^)]+)\)\s+(.*)$").ok()?;
    let (host, ip, rtt_part) = if let Some(hc) = host_re.captures(rest) {
        (
            Some(hc[1].to_string()),
            Some(hc[2].to_string()),
            hc[3].to_string(),
        )
    } else {
        // ip only then ms
        let ip_re = regex::Regex::new(r"^(\d+\.\d+\.\d+\.\d+|\S+)\s+(.*)$").ok()?;
        let ic = ip_re.captures(rest)?;
        let name = ic[1].to_string();
        let looks_ip = name.contains('.');
        (
            if looks_ip { None } else { Some(name.clone()) },
            if looks_ip { Some(name) } else { None },
            ic[2].to_string(),
        )
    };

    let mut rtts = Vec::new();
    for m in regex::Regex::new(r"(?i)(?:\*\s*|\d+(?:\.\d+)?\s*ms)")
        .ok()?
        .find_iter(&rtt_part)
    {
        let t = m.as_str().trim();
        if t.starts_with('*') {
            rtts.push(None);
        } else if let Some(v) = parse_ms_token(t) {
            rtts.push(v);
        }
        if rtts.len() >= 3 {
            break;
        }
    }
    if rtts.is_empty() {
        return None;
    }

    Some(NetworkToolEvent {
        kind: "trace_hop".into(),
        seq: None,
        rtt_ms: rtts.iter().flatten().copied().next(),
        lost: Some(rtts.iter().all(|x| x.is_none())),
        ttl: None,
        hop: Some(hop),
        host,
        ip,
        rtts: Some(rtts),
        loss_pct: None,
        sent: None,
        recv: None,
        min_ms: None,
        avg_ms: None,
        max_ms: None,
    })
}

fn split_host_ip(part: &str) -> (Option<String>, Option<String>) {
    let p = part.trim();
    if p.is_empty() || p.contains("超时") || p.to_ascii_lowercase().contains("timed out") {
        return (None, None);
    }
    // name [ip]
    if let Ok(re) = regex::Regex::new(r"^(.+?)\s*\[([^\]]+)\]\s*$") {
        if let Some(c) = re.captures(p) {
            return (Some(c[1].trim().to_string()), Some(c[2].trim().to_string()));
        }
    }
    // bare ip
    if regex::Regex::new(r"^\d+\.\d+\.\d+\.\d+$")
        .ok()
        .map(|r| r.is_match(p))
        .unwrap_or(false)
    {
        return (None, Some(p.to_string()));
    }
    (Some(p.to_string()), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn win_ping_reply() {
        let mut seq = 0;
        let ev = parse_tool_line(
            "来自 1.1.1.1 的回复: 字节=32 时间=23ms TTL=56",
            ToolMode::Ping,
            &mut seq,
        )
        .unwrap();
        assert_eq!(ev.kind, "ping_sample");
        assert_eq!(ev.rtt_ms, Some(23.0));
        assert_eq!(ev.lost, Some(false));
    }

    #[test]
    fn win_ping_timeout() {
        let mut seq = 0;
        let ev = parse_tool_line("请求超时。", ToolMode::Ping, &mut seq).unwrap();
        assert_eq!(ev.lost, Some(true));
    }

    #[test]
    fn unix_ping_reply() {
        let mut seq = 0;
        let ev = parse_tool_line(
            "64 bytes from 1.1.1.1: icmp_seq=1 ttl=56 time=12.3 ms",
            ToolMode::Ping,
            &mut seq,
        )
        .unwrap();
        assert_eq!(ev.rtt_ms, Some(12.3));
        assert_eq!(ev.seq, Some(1));
    }

    #[test]
    fn win_tracert_hop() {
        let mut seq = 0;
        let ev = parse_tool_line(
            "  1    <1 ms    <1 ms    <1 ms  router [192.168.1.1]",
            ToolMode::Traceroute,
            &mut seq,
        )
        .unwrap();
        assert_eq!(ev.kind, "trace_hop");
        assert_eq!(ev.hop, Some(1));
        assert_eq!(ev.ip.as_deref(), Some("192.168.1.1"));
    }
}
