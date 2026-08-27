//! LibreSpeed 国内高校测速节点（稳定、可预期）。
//!
//! 采用各高校自建的 LibreSpeed / speedtest 服务，替代不稳定的测速网节点。
//! 测速方法参考 YD/T 2400-2022：多连接下载/上传、多轮中位数。
//!
//! Author: Charlie

use futures::future::join_all;
use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedNode {
    pub id: String,
    pub name: String,
    pub location: String,
    pub ipv6: bool,
    pub ping_url: String,
    pub download_url: String,
    pub upload_url: String,
}

struct ProviderDef {
    id: &'static str,
    name: &'static str,
    location: &'static str,
    ipv6: bool,
    ping_url: &'static str,
    download_url: &'static str,
    upload_url: &'static str,
}

/// 内置国内 LibreSpeed 测速站（经连通性验证）
const PROVIDERS: &[ProviderDef] = &[
    ProviderDef {
        id: "nju-v4",
        name: "南京大学",
        location: "江苏 · 南京",
        ipv6: false,
        ping_url: "https://test.nju.edu.cn/empty.php",
        download_url: "https://test.nju.edu.cn/garbage.php?ck={bytes}",
        upload_url: "https://test.nju.edu.cn/empty.php",
    },
    ProviderDef {
        id: "nju-v6",
        name: "南京大学",
        location: "江苏 · 南京",
        ipv6: true,
        ping_url: "https://test6.nju.edu.cn/empty.php",
        download_url: "https://test6.nju.edu.cn/garbage.php?ck={bytes}",
        upload_url: "https://test6.nju.edu.cn/empty.php",
    },
    ProviderDef {
        id: "zju",
        name: "浙江大学",
        location: "浙江 · 杭州",
        ipv6: false,
        ping_url: "http://speedtest.zju.edu.cn/empty.php",
        download_url: "http://speedtest.zju.edu.cn/garbage.php?ck={bytes}",
        upload_url: "http://speedtest.zju.edu.cn/empty.php",
    },
    ProviderDef {
        id: "nuaa",
        name: "南京航空航天大学",
        location: "江苏 · 南京",
        ipv6: false,
        ping_url: "http://speed.nuaa.edu.cn/backend/empty.php",
        download_url: "http://speed.nuaa.edu.cn/backend/garbage.php?ck={bytes}",
        upload_url: "http://speed.nuaa.edu.cn/backend/empty.php",
    },
    ProviderDef {
        id: "seu",
        name: "东南大学",
        location: "江苏 · 南京",
        ipv6: false,
        ping_url: "https://xnfz.seu.edu.cn/speed/empty.php",
        download_url: "https://xnfz.seu.edu.cn/speed/garbage.php?ck={bytes}",
        upload_url: "https://xnfz.seu.edu.cn/speed/empty.php",
    },
];

fn to_node(p: &ProviderDef) -> SpeedNode {
    SpeedNode {
        id: p.id.to_string(),
        name: p.name.to_string(),
        location: p.location.to_string(),
        ipv6: p.ipv6,
        ping_url: p.ping_url.to_string(),
        download_url: p.download_url.to_string(),
        upload_url: p.upload_url.to_string(),
    }
}

fn filter_providers(ipv6: Option<bool>) -> Vec<&'static ProviderDef> {
    PROVIDERS
        .iter()
        .filter(|p| match ipv6 {
            Some(true) => p.ipv6,
            Some(false) => !p.ipv6,
            None => true,
        })
        .collect()
}

async fn probe_ping(client: &reqwest::Client, url: &str) -> Option<f64> {
    let start = Instant::now();
    let resp = client.get(url).send().await.ok()?;
    let _ = resp.bytes().await.ok()?;
    Some(start.elapsed().as_secs_f64() * 1000.0)
}

#[tauri::command]
pub async fn network_speed_list_nodes(ipv6: Option<bool>) -> Result<Vec<SpeedNode>, String> {
    Ok(filter_providers(ipv6).into_iter().map(to_node).collect())
}

#[tauri::command]
pub async fn network_speed_pick_node(
    ipv6: Option<bool>,
    node_id: Option<String>,
) -> Result<SpeedNode, String> {
    let candidates = filter_providers(ipv6);
    if candidates.is_empty() {
        return Err("当前协议无可用测速节点".into());
    }

    if let Some(id) = node_id.filter(|s| !s.is_empty() && s != "auto") {
        if let Some(p) = candidates.iter().find(|p| p.id == id) {
            return Ok(to_node(p));
        }
        return Err("所选测速节点不可用".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let probes: Vec<_> = candidates
        .iter()
        .map(|p| {
            let client = client.clone();
            let url = p.ping_url.to_string();
            let node = to_node(p);
            async move {
                let ms = probe_ping(&client, &url).await?;
                Some((ms, node))
            }
        })
        .collect();

    let results = join_all(probes).await;
    let mut ranked: Vec<(f64, SpeedNode)> = results.into_iter().flatten().collect();
    ranked.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    ranked
        .into_iter()
        .next()
        .map(|(_, n)| n)
        .ok_or_else(|| "测速节点探测失败，请检查网络后重试".into())
}
