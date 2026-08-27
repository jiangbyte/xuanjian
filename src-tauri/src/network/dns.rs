//! 基于 hickory-resolver 的结构化 DNS 查询。
//!
//! Author: Charlie

use hickory_resolver::config::{NameServerConfig, Protocol, ResolverConfig, ResolverOpts};
use hickory_resolver::proto::rr::RecordType;
use hickory_resolver::TokioAsyncResolver;
use serde::Serialize;
use std::net::SocketAddr;
use std::str::FromStr;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsRecordRow {
    pub record_type: String,
    pub name: String,
    pub value: String,
    pub ttl: Option<u32>,
    pub priority: Option<u16>,
}

fn record_type_from_str(s: &str) -> Result<RecordType, String> {
    match s.to_uppercase().as_str() {
        "A" => Ok(RecordType::A),
        "AAAA" => Ok(RecordType::AAAA),
        "MX" => Ok(RecordType::MX),
        "TXT" => Ok(RecordType::TXT),
        "PTR" => Ok(RecordType::PTR),
        "NS" => Ok(RecordType::NS),
        "CNAME" => Ok(RecordType::CNAME),
        "SOA" => Ok(RecordType::SOA),
        "SRV" => Ok(RecordType::SRV),
        "CAA" => Ok(RecordType::CAA),
        other => Err(format!("不支持的记录类型: {other}")),
    }
}

async fn build_resolver(nameserver: Option<&str>) -> Result<TokioAsyncResolver, String> {
    let opts = ResolverOpts::default();
    if let Some(ns) = nameserver.filter(|s| !s.trim().is_empty()) {
        let ip = ns.trim();
        let addr: SocketAddr = format!("{ip}:53")
            .parse()
            .map_err(|e| format!("无效 DNS 服务器: {e}"))?;
        let mut cfg = ResolverConfig::new();
        cfg.add_name_server(NameServerConfig {
            socket_addr: addr,
            protocol: Protocol::Udp,
            tls_dns_name: None,
            trust_negative_responses: false,
            bind_addr: None,
        });
        Ok(TokioAsyncResolver::tokio(cfg, opts))
    } else {
        TokioAsyncResolver::tokio_from_system_conf().map_err(|e| e.to_string())
    }
}

fn record_to_rows(
    rtype: &RecordType,
    record: &hickory_resolver::proto::rr::Record,
) -> Vec<DnsRecordRow> {
    let name = record.name().to_utf8();
    let ttl = Some(record.ttl());
    let rdata = record.data();
    let mut rows = Vec::new();

    match rdata {
        Some(d) if d.as_a().is_some() => {
            rows.push(DnsRecordRow {
                record_type: "A".into(),
                name,
                value: d.as_a().unwrap().to_string(),
                ttl,
                priority: None,
            });
        }
        Some(d) if d.as_aaaa().is_some() => {
            rows.push(DnsRecordRow {
                record_type: "AAAA".into(),
                name,
                value: d.as_aaaa().unwrap().to_string(),
                ttl,
                priority: None,
            });
        }
        Some(d) if d.as_mx().is_some() => {
            let mx = d.as_mx().unwrap();
            rows.push(DnsRecordRow {
                record_type: "MX".into(),
                name,
                value: mx.exchange().to_utf8(),
                ttl,
                priority: Some(mx.preference()),
            });
        }
        Some(d) if d.as_txt().is_some() => {
            let txt = d
                .as_txt()
                .unwrap()
                .txt_data()
                .iter()
                .map(|b| String::from_utf8_lossy(b).into_owned())
                .collect::<Vec<_>>()
                .join("");
            rows.push(DnsRecordRow {
                record_type: "TXT".into(),
                name,
                value: txt,
                ttl,
                priority: None,
            });
        }
        Some(d) if d.as_ptr().is_some() => {
            rows.push(DnsRecordRow {
                record_type: "PTR".into(),
                name,
                value: d.as_ptr().unwrap().to_string(),
                ttl,
                priority: None,
            });
        }
        Some(d) if d.as_ns().is_some() => {
            rows.push(DnsRecordRow {
                record_type: "NS".into(),
                name,
                value: d.as_ns().unwrap().to_utf8(),
                ttl,
                priority: None,
            });
        }
        Some(d) if d.as_cname().is_some() => {
            rows.push(DnsRecordRow {
                record_type: "CNAME".into(),
                name,
                value: d.as_cname().unwrap().to_utf8(),
                ttl,
                priority: None,
            });
        }
        Some(d) if d.as_soa().is_some() => {
            let soa = d.as_soa().unwrap();
            rows.push(DnsRecordRow {
                record_type: "SOA".into(),
                name,
                value: format!(
                    "{} {} {} {} {} {} {}",
                    soa.mname(),
                    soa.rname(),
                    soa.serial(),
                    soa.refresh(),
                    soa.retry(),
                    soa.expire(),
                    soa.minimum()
                ),
                ttl,
                priority: None,
            });
        }
        Some(d) if d.as_srv().is_some() => {
            let srv = d.as_srv().unwrap();
            rows.push(DnsRecordRow {
                record_type: "SRV".into(),
                name,
                value: format!(
                    "{}:{} priority={} weight={}",
                    srv.target(),
                    srv.port(),
                    srv.priority(),
                    srv.weight()
                ),
                ttl,
                priority: Some(srv.priority()),
            });
        }
        Some(_) => {
            rows.push(DnsRecordRow {
                record_type: rtype.to_string(),
                name,
                value: format!("{record:?}"),
                ttl,
                priority: None,
            });
        }
        None => {}
    }
    rows
}

#[tauri::command]
pub async fn network_dns_resolve(
    host: String,
    record_type: String,
    nameserver: Option<String>,
) -> Result<Vec<DnsRecordRow>, String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("请输入域名或 IP".into());
    }
    let rtype = record_type_from_str(&record_type)?;
    let resolver = build_resolver(nameserver.as_deref()).await?;

    let lookup_name = if rtype == RecordType::PTR && !host.ends_with('.') {
        let parts: Vec<&str> = host.split('.').collect();
        if parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok()) {
            format!(
                "{}.{}.{}.{}.in-addr.arpa",
                parts[3], parts[2], parts[1], parts[0]
            )
        } else {
            host.clone()
        }
    } else {
        host.clone()
    };

    let name =
        hickory_resolver::Name::from_str(&lookup_name).map_err(|e| format!("无效查询名: {e}"))?;

    let response = resolver
        .lookup(name, rtype)
        .await
        .map_err(|e| e.to_string())?;

    let mut rows = Vec::new();
    for record in response.records() {
        rows.extend(record_to_rows(&rtype, record));
    }
    if rows.is_empty() {
        return Err("无记录".into());
    }
    Ok(rows)
}
