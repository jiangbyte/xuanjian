//! 密钥加解密相关 Tauri 命令。
//!
//! Author: Charlie

use crate::crypto;

/// 将明文口令加密为可入库的密文字符串。
#[tauri::command]
pub fn encrypt_secret(plain: String) -> Result<String, String> {
    crypto::encrypt_password(&plain).map_err(|e| e.to_string())
}

/// 解密入库密文（仅用于可信导出）。
#[tauri::command]
pub fn decrypt_secret(encoded: String) -> Result<String, String> {
    crypto::decrypt_password(&encoded).map_err(|e| e.to_string())
}
