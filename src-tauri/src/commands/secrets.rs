//! 密钥加密相关 Tauri 命令。
//!
//! Author: Charlie

use crate::crypto;

/// 将明文口令加密为可入库的密文字符串。
#[tauri::command]
pub fn encrypt_secret(plain: String) -> Result<String, String> {
    crypto::encrypt_password(&plain).map_err(|e| e.to_string())
}
