//! Windows 子进程辅助：在 GUI（windows_subsystem）应用中隐藏控制台窗口。
//! 非 Windows 平台不提供这些符号；调用方须置于 `#[cfg(windows)]` 内。
//!
//! Author: Charlie

/// `CREATE_NO_WINDOW` — 不创建控制台窗口。
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 为 `std::process::Command` 设置无窗口标志。
#[cfg(windows)]
pub fn hide_console(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

/// 为 `tokio::process::Command` 设置无窗口标志。
#[cfg(windows)]
pub fn hide_console_tokio(cmd: &mut tokio::process::Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}
