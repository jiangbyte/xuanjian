//! known_hosts 表读写。
//!
//! Author: Charlie

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::data_dir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostRow {
    pub id: i64,
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
}

fn open_db() -> Result<Connection> {
    let path = data_dir::db_path()?;
    Connection::open(path).context("open sqlite db")
}

pub fn lookup_fingerprint(host: &str, port: u16) -> Result<Option<String>> {
    let conn = open_db()?;
    let mut stmt =
        conn.prepare("SELECT fingerprint FROM known_hosts WHERE host = ?1 AND port = ?2 LIMIT 1")?;
    let mut rows = stmt.query(params![host, i64::from(port)])?;
    if let Some(row) = rows.next()? {
        return Ok(Some(row.get(0)?));
    }
    Ok(None)
}

pub fn list_known_hosts() -> Result<Vec<KnownHostRow>> {
    let conn = open_db()?;
    let mut stmt =
        conn.prepare("SELECT id, host, port, fingerprint FROM known_hosts ORDER BY host, port")?;
    let rows = stmt.query_map([], |row| {
        Ok(KnownHostRow {
            id: row.get(0)?,
            host: row.get(1)?,
            port: row.get::<_, i64>(2)? as u16,
            fingerprint: row.get(3)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .context("list known_hosts")
}

pub fn add_known_host(host: &str, port: u16, fingerprint: &str) -> Result<i64> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO known_hosts (host, port, fingerprint) VALUES (?1, ?2, ?3)
         ON CONFLICT(host, port) DO UPDATE SET fingerprint = excluded.fingerprint",
        params![host.trim(), i64::from(port), fingerprint.trim()],
    )
    .context("upsert known_hosts")?;
    Ok(conn.last_insert_rowid())
}

pub fn remove_known_host(id: i64) -> Result<()> {
    let conn = open_db()?;
    conn.execute("DELETE FROM known_hosts WHERE id = ?1", params![id])
        .context("delete known_hosts")?;
    Ok(())
}
