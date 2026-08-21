//! 主机口令加解密（AES-256-GCM）。
//!
//! 密钥存放于应用数据目录 `secret.key`（与 SQLite 同目录），首次使用时自动生成。
//! 密文格式：Base64(nonce || ciphertext)。
//!
//! Author: Charlie

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use std::fs;
use std::path::PathBuf;

use crate::data_dir;

/// 返回密钥文件路径（确保目录存在）。
fn key_path() -> Result<PathBuf> {
    let path = data_dir::key_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(path)
}

/// 加载或创建 32 字节主密钥。
fn load_or_create_key() -> Result<[u8; 32]> {
    let path = key_path()?;
    if path.exists() {
        let bytes = fs::read(&path)?;
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    fs::write(&path, key)?;
    Ok(key)
}

/// 加密明文口令，返回 Base64 密文。
pub fn encrypt_password(plain: &str) -> Result<String> {
    let key_bytes = load_or_create_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|e| anyhow!("encrypt: {e}"))?;
    let mut out = nonce_bytes.to_vec();
    out.extend(ciphertext);
    Ok(B64.encode(out))
}

/// 解密 Base64 密文；格式非法时返回错误。
pub fn decrypt_password(encoded: &str) -> Result<String> {
    let raw = B64.decode(encoded)?;
    if raw.len() < 13 {
        return Err(anyhow!("invalid ciphertext"));
    }
    let key_bytes = load_or_create_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&raw[..12]);
    let plain = cipher
        .decrypt(nonce, &raw[12..])
        .map_err(|e| anyhow!("decrypt: {e}"))?;
    Ok(String::from_utf8(plain)?)
}
