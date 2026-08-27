//! 网卡流量统计（sysinfo）。
//!
//! Author: Charlie

use serde::Serialize;
use sysinfo::Networks;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceTraffic {
    pub name: String,
    pub received_bytes: u64,
    pub transmitted_bytes: u64,
    pub received_packets: u64,
    pub transmitted_packets: u64,
}

#[tauri::command]
pub fn network_interface_traffic() -> Result<Vec<InterfaceTraffic>, String> {
    let mut networks = Networks::new_with_refreshed_list();
    networks.refresh(true);

    let mut out: Vec<InterfaceTraffic> = networks
        .iter()
        .map(|(name, data)| InterfaceTraffic {
            name: name.clone(),
            received_bytes: data.total_received(),
            transmitted_bytes: data.total_transmitted(),
            received_packets: data.total_packets_received(),
            transmitted_packets: data.total_packets_transmitted(),
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}
