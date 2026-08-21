//! 本机平台信息命令。
//!
//! Author: Charlie

/// 返回 `std::env::consts::OS`（windows / macos / linux …），供前端三端适配。
#[tauri::command]
pub fn host_platform() -> String {
    std::env::consts::OS.to_string()
}
