//! 数据目录相关 Tauri 命令。
//!
//! Author: Charlie

use crate::data_dir::{self, DataDirInfo};

#[tauri::command]
pub fn get_data_dir_info() -> Result<DataDirInfo, String> {
    data_dir::info().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_db_url() -> Result<String, String> {
    data_dir::db_url().map_err(|e| e.to_string())
}

/// `path` 为 `None` 或空字符串时恢复默认目录。
#[tauri::command]
pub fn set_data_dir(path: Option<String>, copy_data: bool) -> Result<DataDirInfo, String> {
    data_dir::set_data_dir(path, copy_data).map_err(|e| e.to_string())
}
