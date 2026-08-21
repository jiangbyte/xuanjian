//! 玄鉴桌面端可执行入口。
//!
//! Release 构建在 Windows 上禁用额外控制台窗口（请勿删除 cfg_attr）。
//!
//! Author: Charlie

// 防止 Windows Release 额外弹出控制台窗口，请勿删除！
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    xuanjian_lib::run()
}
