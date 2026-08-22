//! known_hosts 表 Tauri 命令。
//!
//! Author: Charlie

use crate::services::ssh::known_hosts::{self, KnownHostRow};

#[tauri::command]
pub fn list_known_hosts_cmd() -> Result<Vec<KnownHostRow>, String> {
    known_hosts::list_known_hosts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_known_host_cmd(host: String, port: u16, fingerprint: String) -> Result<i64, String> {
    known_hosts::add_known_host(&host, port, &fingerprint).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_known_host_cmd(id: i64) -> Result<(), String> {
    known_hosts::remove_known_host(id).map_err(|e| e.to_string())
}
