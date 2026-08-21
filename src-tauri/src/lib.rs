//! 玄鉴后端库入口：注册插件、共享状态与全部 Tauri 命令。
//!
//! 业务命令见 `commands`；协议实现见 `session` / `network`；迁移见 `db`。
//!
//! Author: Charlie

mod commands;
mod crypto;
mod db;
mod network;
mod session;

use commands::*;
use network::NetworkState;
use session::{AppState, SharedState};
use std::sync::Arc;

/// 启动 Tauri 应用：挂载插件、注入状态、注册 invoke handler。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: SharedState = Arc::new(AppState::new());
    let network_state = Arc::new(NetworkState::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            // 拦截部分浏览器快捷键；刻意不拦截 Ctrl+Shift+C/V，保证终端复制粘贴可用
            tauri_plugin_prevent_default::Builder::new()
                .with_flags({
                    use tauri_plugin_prevent_default::Flags;
                    Flags::CONTEXT_MENU
                        | Flags::PRINT
                        | Flags::DOWNLOADS
                        | Flags::FIND
                        | Flags::RELOAD
                        | Flags::SOURCE
                        | Flags::OPEN
                        | Flags::DEV_TOOLS
                        | Flags::CARET_BROWSING
                })
                .platform(
                    tauri_plugin_prevent_default::PlatformOptions::new()
                        .browser_accelerator_keys(false)
                        .dev_tools(false)
                        .default_context_menus(false),
                )
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:xuanjian.db", db::migrations())
                .build(),
        )
        .manage(state)
        .manage(network_state)
        .invoke_handler(tauri::generate_handler![
            list_local_shells,
            local_shell_open,
            ssh_connect,
            session_write,
            session_resize,
            session_close,
            session_exec,
            sftp_list,
            sftp_upload,
            sftp_download,
            sftp_transfer_cancel,
            sftp_remove,
            sftp_mkdir,
            sftp_read,
            sftp_write,
            sftp_rename,
            sftp_chmod,
            encrypt_secret,
            get_home_dir,
            get_temp_dir,
            list_local_dir,
            create_local_dir,
            read_local_file,
            write_local_file,
            rename_local_path,
            chmod_local_path,
            remove_local_path,
            network::network_list_interfaces,
            network::network_ping,
            network::network_traceroute,
            network::network_dns_lookup,
            network::network_tcp_probe,
            network::network_cancel,
            network::network_detect_capture_tools,
            network::network_capture_start,
            network::network_capture_stop,
            network::network_pcap_summary,
            network::network_http_request,
            network::network_tls_cert,
            network::network_whois,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
