//! 本机套接字 / 连接列表（netstat2）。
//!
//! Author: Charlie

use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo};
use serde::Serialize;
use std::net::IpAddr;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketRow {
    pub protocol: String,
    pub local_addr: String,
    pub remote_addr: String,
    pub state: String,
    pub pid: Option<u32>,
}

fn fmt_ip_port(addr: IpAddr, port: u16) -> String {
    if port == 0 {
        addr.to_string()
    } else {
        format!("{addr}:{port}")
    }
}

#[tauri::command]
pub fn network_list_connections(protocol: Option<String>) -> Result<Vec<SocketRow>, String> {
    let proto = protocol.unwrap_or_else(|| "all".into()).to_lowercase();
    let proto_flags = match proto.as_str() {
        "tcp" => ProtocolFlags::TCP,
        "udp" => ProtocolFlags::UDP,
        _ => ProtocolFlags::TCP | ProtocolFlags::UDP,
    };

    let sockets = get_sockets_info(
        AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6,
        proto_flags,
    )
    .map_err(|e| e.to_string())?;

    let mut rows: Vec<SocketRow> = sockets
        .into_iter()
        .map(|s| {
            let (protocol, local, remote, state) = match &s.protocol_socket_info {
                ProtocolSocketInfo::Tcp(tcp) => (
                    "TCP".into(),
                    fmt_ip_port(tcp.local_addr, tcp.local_port),
                    fmt_ip_port(tcp.remote_addr, tcp.remote_port),
                    format!("{:?}", tcp.state),
                ),
                ProtocolSocketInfo::Udp(udp) => (
                    "UDP".into(),
                    fmt_ip_port(udp.local_addr, udp.local_port),
                    String::new(),
                    "UDP".into(),
                ),
            };
            SocketRow {
                protocol,
                local_addr: local,
                remote_addr: remote,
                state,
                pid: s.associated_pids.first().copied(),
            }
        })
        .collect();

    rows.sort_by(|a, b| {
        a.protocol
            .cmp(&b.protocol)
            .then_with(|| a.local_addr.cmp(&b.local_addr))
    });
    Ok(rows)
}
