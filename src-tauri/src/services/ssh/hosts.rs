//! hosts 表读取（跳板机解析等）。
//!
//! Author: Charlie

use anyhow::{Context, Result};
use rusqlite::{params, Connection};

use crate::data_dir;

#[derive(Debug, Clone)]
#[allow(dead_code)] // id/name/jump_host_id reserved for multi-hop jumps and diagnostics
pub struct HostRecord {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password_enc: Option<String>,
    pub private_key_path: Option<String>,
    pub passphrase_enc: Option<String>,
    pub proxy_type: Option<String>,
    pub proxy_host: Option<String>,
    pub proxy_port: Option<u16>,
    pub jump_host_id: Option<i64>,
}

fn open_db() -> Result<Connection> {
    let path = data_dir::db_path()?;
    Connection::open(path).context("open sqlite db")
}

pub fn load_host(id: i64) -> Result<Option<HostRecord>> {
    let conn = open_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, host, port, username, auth_type, password_enc, private_key_path,
                passphrase_enc, proxy_type, proxy_host, proxy_port, jump_host_id
         FROM hosts WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![id])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    let proxy_port: Option<i64> = row.get(11)?;
    Ok(Some(HostRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get::<_, i64>(3)? as u16,
        username: row.get(4)?,
        auth_type: row.get(5)?,
        password_enc: row.get(6)?,
        private_key_path: row.get(7)?,
        passphrase_enc: row.get(8)?,
        proxy_type: row.get(9)?,
        proxy_host: row.get(10)?,
        proxy_port: proxy_port.map(|p| p as u16),
        jump_host_id: row.get(12)?,
    }))
}
