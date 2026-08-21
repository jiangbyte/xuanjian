//! 应用数据目录解析：外部 `data-dir.json` 指针 + DB / secret.key 同目录。
//!
//! Author: Charlie

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const APP_ID: &str = "io.github.jiangbyte.xuanjian";
const CONFIG_FILE: &str = "data-dir.json";
pub const DB_FILE: &str = "xuanjian.db";
pub const KEY_FILE: &str = "secret.key";

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

/// 默认 AppConfig 目录（与 tauri `app_config_dir` 对齐）。
pub fn default_config_dir() -> Result<PathBuf> {
    let base = dirs::config_dir().ok_or_else(|| anyhow!("no config dir"))?;
    Ok(base.join(APP_ID))
}

fn config_file_path() -> Result<PathBuf> {
    Ok(default_config_dir()?.join(CONFIG_FILE))
}

fn read_config() -> DataDirFile {
    let Ok(path) = config_file_path() else {
        return DataDirFile::default();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return DataDirFile::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

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
    let cfg = read_config();
    let dir = if let Some(custom) = cfg.data_dir.as_ref().filter(|s| !s.trim().is_empty()) {
        PathBuf::from(custom)
    } else {
        default_config_dir()?
    };
    fs::create_dir_all(&dir)?;
    // 首次：若新目录无 key，尝试从旧 Local\xuanjian\secret.key 迁移
    migrate_legacy_key_if_needed(&dir)?;
    Ok(dir)
}

fn legacy_key_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("xuanjian").join(KEY_FILE))
}

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

/// `sqlite:` 连接串（绝对路径，反斜杠转正斜杠）。
pub fn db_url() -> Result<String> {
    let path = db_path()?;
    let s = path.to_string_lossy().replace('\\', "/");
    Ok(format!("sqlite:{s}"))
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
        // 也尝试旧 key 位置
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
