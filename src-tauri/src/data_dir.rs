//! 应用数据目录解析：外部 `data-dir.json` 指针 + DB / secret.key 同目录。
//!
//! Author: Charlie

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use anyhow::Context;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::path::Path;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
const APP_ID: &str = "io.github.jiangbyte.xuanjian";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const CONFIG_FILE: &str = "data-dir.json";
pub const DB_FILE: &str = "xuanjian.db";
pub const KEY_FILE: &str = "secret.key";

/// Android：由 `run()` setup 注入 `app.path().app_config_dir()`，与 plugin-sql 相对路径对齐。
static RUNTIME_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// plugin-sql / 前端使用的相对连接串（相对 AppConfig）。
#[cfg(any(target_os = "android", target_os = "ios"))]
pub const MOBILE_DB_URL: &str = "sqlite:xuanjian.db";

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DataDirFile {
    /// 自定义数据目录；`null` / 缺省表示使用默认 AppConfig 目录。
    data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirInfo {
    pub data_dir: String,
    pub is_custom: bool,
    pub db_path: String,
    pub key_path: String,
    pub default_dir: String,
    pub db_url: String,
}

/// 注入运行时数据目录（移动端 setup 必调）。
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn set_runtime_data_dir(dir: PathBuf) {
    let _ = RUNTIME_DATA_DIR.set(dir);
}

/// 默认 AppConfig 目录（与 tauri `app_config_dir` 对齐）。
pub fn default_config_dir() -> Result<PathBuf> {
    if let Some(dir) = RUNTIME_DATA_DIR.get() {
        return Ok(dir.clone());
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        // setup 之前不应依赖 dirs；返回明确错误避免写到不可写 cwd
        return Err(anyhow!(
            "mobile data dir not initialized (call set_runtime_data_dir in setup)"
        ));
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let base = dirs::config_dir().ok_or_else(|| anyhow!("no config dir"))?;
        Ok(base.join(APP_ID))
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn config_file_path() -> Result<PathBuf> {
    Ok(default_config_dir()?.join(CONFIG_FILE))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn read_config() -> DataDirFile {
    let Ok(path) = config_file_path() else {
        return DataDirFile::default();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return DataDirFile::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn write_config(cfg: &DataDirFile) -> Result<()> {
    let dir = default_config_dir()?;
    fs::create_dir_all(&dir)?;
    let path = dir.join(CONFIG_FILE);
    let raw = serde_json::to_string_pretty(cfg)?;
    fs::write(path, raw)?;
    Ok(())
}

/// 解析当前数据目录（确保存在）。
pub fn resolve_data_dir() -> Result<PathBuf> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let dir = default_config_dir()?;
        fs::create_dir_all(&dir)?;
        return Ok(dir);
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let cfg = read_config();
        let dir = if let Some(custom) = cfg.data_dir.as_ref().filter(|s| !s.trim().is_empty()) {
            PathBuf::from(custom)
        } else {
            default_config_dir()?
        };
        fs::create_dir_all(&dir)?;
        migrate_legacy_key_if_needed(&dir)?;
        Ok(dir)
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn legacy_key_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("xuanjian").join(KEY_FILE))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn migrate_legacy_key_if_needed(data_dir: &Path) -> Result<()> {
    let new_key = data_dir.join(KEY_FILE);
    if new_key.exists() {
        return Ok(());
    }
    if let Some(old) = legacy_key_path() {
        if old.exists() {
            fs::copy(&old, &new_key).with_context(|| {
                format!("copy legacy key {} -> {}", old.display(), new_key.display())
            })?;
        }
    }
    Ok(())
}

pub fn db_path() -> Result<PathBuf> {
    Ok(resolve_data_dir()?.join(DB_FILE))
}

pub fn key_path() -> Result<PathBuf> {
    let dir = resolve_data_dir()?;
    Ok(dir.join(KEY_FILE))
}

/// `sqlite:` 连接串。移动端用相对 AppConfig 路径（plugin-sql 约定）。
pub fn db_url() -> Result<String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return Ok(MOBILE_DB_URL.to_string());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let path = db_path()?;
        let s = path.to_string_lossy().replace('\\', "/");
        Ok(format!("sqlite:{s}"))
    }
}

pub fn info() -> Result<DataDirInfo> {
    let default_dir = default_config_dir()?;
    let data_dir = resolve_data_dir()?;
    let is_custom = data_dir != default_dir;
    let db = data_dir.join(DB_FILE);
    let key = data_dir.join(KEY_FILE);
    Ok(DataDirInfo {
        data_dir: data_dir.to_string_lossy().to_string(),
        is_custom,
        db_path: db.to_string_lossy().to_string(),
        key_path: key.to_string_lossy().to_string(),
        default_dir: default_dir.to_string_lossy().to_string(),
        db_url: db_url()?,
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn copy_if_exists(src: &Path, dst: &Path) -> Result<()> {
    if src.exists() {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dst)
            .with_context(|| format!("copy {} -> {}", src.display(), dst.display()))?;
    }
    Ok(())
}

/// 设置数据目录；`copy_data` 为 true 时从当前目录复制 db/key。
pub fn set_data_dir(path: Option<String>, copy_data: bool) -> Result<DataDirInfo> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (path, copy_data);
        return info();
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let current = resolve_data_dir()?;
        let default_dir = default_config_dir()?;

        let (next, is_custom) = match &path {
            None => (default_dir.clone(), false),
            Some(p) if p.trim().is_empty() => (default_dir.clone(), false),
            Some(p) => {
                let pb = PathBuf::from(p.trim());
                fs::create_dir_all(&pb)?;
                (pb, true)
            }
        };

        if copy_data && next != current {
            copy_if_exists(&current.join(DB_FILE), &next.join(DB_FILE))?;
            copy_if_exists(&current.join(KEY_FILE), &next.join(KEY_FILE))?;
            if !next.join(KEY_FILE).exists() {
                if let Some(old) = legacy_key_path() {
                    copy_if_exists(&old, &next.join(KEY_FILE))?;
                }
            }
        }

        let cfg = DataDirFile {
            data_dir: if is_custom {
                Some(next.to_string_lossy().to_string())
            } else {
                None
            },
        };
        write_config(&cfg)?;
        info()
    }
}
