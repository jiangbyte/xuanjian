//! 本机文件系统相关 Tauri 命令（与 SFTP 面板本地侧共用）。
//!
//! Author: Charlie

use crate::session::sftp;

/// 本地文本编辑体积上限，与 SFTP 读文件保持一致。
const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

/// 获取用户主目录路径。
#[tauri::command]
pub fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "home directory not found".into())
}

/// 获取系统临时目录路径。
#[tauri::command]
pub fn get_temp_dir() -> Result<String, String> {
    Ok(std::env::temp_dir().to_string_lossy().to_string())
}

/// 列举本地目录，返回与 SFTP 条目结构兼容的列表（目录优先、名称排序）。
#[tauri::command]
pub fn list_local_dir(path: String) -> Result<Vec<sftp::SftpEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let full = entry.path().to_string_lossy().to_string();
        let modified_at = meta.modified().ok().and_then(sftp::format_system_time);
        out.push(sftp::SftpEntry {
            name,
            path: full,
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified_at,
            permissions: sftp::format_local_permissions(&meta),
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

/// 递归创建本地目录。
#[tauri::command]
pub fn create_local_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// 读取本地文本文件（受体积上限限制）。
#[tauri::command]
pub fn read_local_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_EDIT_BYTES {
        return Err(format!(
            "file too large to edit (max {} bytes)",
            MAX_EDIT_BYTES
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// 写入本地文本文件；必要时创建父目录。
#[tauri::command]
pub fn write_local_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

/// 重命名或移动本地路径。
#[tauri::command]
pub fn rename_local_path(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

/// 设置本地文件权限；Windows 上明确返回不支持。
#[tauri::command]
pub fn chmod_local_path(path: String, mode: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(mode);
        std::fs::set_permissions(&path, perms).map_err(|e| e.to_string())
    }
    #[cfg(windows)]
    {
        let _ = (path, mode);
        Err("chmod is not supported on Windows local files".into())
    }
}

/// 删除本地文件或递归删除目录。
#[tauri::command]
pub fn remove_local_path(path: String) -> Result<(), String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    }
}
