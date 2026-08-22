//! 玄鉴后端库入口：注册插件、共享状态与全部 Tauri 命令。
//!
//! 业务命令见 `commands`；协议实现见 `session` / `network`；迁移见 `db`。
//!
//! Author: Charlie

mod ai;
mod commands;
mod crypto;
mod data_dir;
mod db;
mod network;
mod scheduler;
mod services;
mod session;
mod win_process;

use ai::AiState;
use commands::*;
use network::NetworkState;
use session::{AppState, SharedState};
use std::sync::Arc;

/// 构建 prevent-default 插件；Windows 额外关闭 WebView2 加速键与默认菜单。
fn build_prevent_default_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_prevent_default::Flags;
    let flags = Flags::CONTEXT_MENU
        | Flags::PRINT
        | Flags::DOWNLOADS
        | Flags::FIND
        | Flags::RELOAD
        | Flags::SOURCE
        | Flags::OPEN
        | Flags::DEV_TOOLS
        | Flags::CARET_BROWSING;

    #[cfg(windows)]
    {
        tauri_plugin_prevent_default::Builder::new()
            .with_flags(flags)
            .platform(
                tauri_plugin_prevent_default::PlatformOptions::new()
                    .browser_accelerator_keys(false)
                    .dev_tools(false)
                    .default_context_menus(false),
            )
            .build()
    }
    #[cfg(not(windows))]
    {
        tauri_plugin_prevent_default::Builder::new()
            .with_flags(flags)
            .build()
    }
}

/// 启动 Tauri 应用：挂载插件、注入状态、注册 invoke handler。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: SharedState = Arc::new(AppState::new());
    let network_state = Arc::new(NetworkState::new());
    let ai_state = Arc::new(AiState::new());
    let db_url = data_dir::db_url().expect("resolve sqlite url");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // 拦截部分浏览器快捷键；刻意不拦截 Ctrl+Shift+C/V，保证终端复制粘贴可用
        .plugin(build_prevent_default_plugin())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(&db_url, db::migrations())
                .build(),
        )
        .manage(state)
        .manage(network_state)
        .manage(ai_state)
        .setup(|app| {
            scheduler::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_local_shells,
            host_platform,
            local_shell_open,
            ssh_connect,
            session_write,
            session_resize,
            session_close,
            session_exec,
            session_exec_stream,
            session_exec_cancel,
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
            decrypt_secret,
            get_home_dir,
            get_temp_dir,
            list_local_dir,
            create_local_dir,
            read_local_file,
            write_local_file,
            rename_local_path,
            chmod_local_path,
            remove_local_path,
            wsl_home_dir,
            wsl_list_dir,
            wsl_read_file,
            wsl_write_file,
            wsl_mkdir,
            wsl_rename,
            wsl_chmod,
            wsl_remove,
            get_data_dir_info,
            get_db_url,
            set_data_dir,
            network::network_list_interfaces,
            network::network_ping,
            network::network_traceroute,
            network::network_dns_lookup,
            network::network_tcp_probe,
            network::network_cancel,
            network::network_http_request,
            network::network_tls_cert,
            network::network_whois,
            network::speed::network_speed_test,
            network::speed_server::network_speed_server_start,
            network::speed_server::network_speed_server_stop,
            network::speed_server::network_speed_server_status,
            ai::proxy::ai_chat_completion,
            ai::proxy::ai_chat_stream,
            ai::proxy::ai_chat_cancel,
            list_known_hosts_cmd,
            add_known_host_cmd,
            remove_known_host_cmd,
            mcp_stdio_discover,
            mcp_stdio_call,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
