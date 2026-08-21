use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

fn key_path() -> Result<PathBuf> {
    let dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| anyhow!("no data dir"))?
        .join("xuanjian");
    fs::create_dir_all(&dir)?;
    Ok(dir.join("secret.key"))
}

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

pub fn fingerprint(host: &str, key_bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(host.as_bytes());
    hasher.update(key_bytes);
    format!("{:x}", hasher.finalize())
}
