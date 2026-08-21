//! Tauri 构建脚本：生成上下文与资源绑定。
//!
//! Author: Charlie

fn main() {
    // 图标变更时必须重跑，否则 Windows exe 仍嵌入旧 ICO（任务栏黑角）
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    tauri_build::build()
}
