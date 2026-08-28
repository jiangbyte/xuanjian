//! 本地伪终端会话：桌面走 PTY；移动端为占位实现。
//!
//! Author: Charlie

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[path = "local_desktop.rs"]
mod imp;

#[cfg(any(target_os = "android", target_os = "ios"))]
#[path = "local_mobile.rs"]
mod imp;

pub use imp::*;
