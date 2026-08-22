//! 定时任务调度：轮询 scheduled_jobs，到期时向前端 emit 事件。
//!
//! Author: Charlie

use anyhow::{Context, Result};
use chrono::{Datelike, Local, Timelike};
use cron::Schedule;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::data_dir;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerJobEvent {
    pub job_id: i64,
    pub name: String,
    pub job_type: String,
    pub script_id: Option<i64>,
    pub host_group_id: Option<i64>,
    pub host_ids_json: Option<String>,
    pub cron_expr: String,
}

#[derive(Debug)]
struct JobRow {
    id: i64,
    name: String,
    cron_expr: String,
    job_type: String,
    script_id: Option<i64>,
    host_group_id: Option<i64>,
    host_ids_json: Option<String>,
    last_run_at: Option<String>,
}

fn open_db() -> Result<Connection> {
    let path = data_dir::db_path()?;
    Connection::open(path).context("open sqlite db for scheduler")
}

fn load_enabled_jobs(conn: &Connection) -> Result<Vec<JobRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, cron_expr, job_type, script_id, host_group_id,
                host_ids_json, last_run_at
         FROM scheduled_jobs WHERE enabled = 1 ORDER BY id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(JobRow {
            id: row.get(0)?,
            name: row.get(1)?,
            cron_expr: row.get(2)?,
            job_type: row.get(3)?,
            script_id: row.get(4)?,
            host_group_id: row.get(5)?,
            host_ids_json: row.get(6)?,
            last_run_at: row.get(7)?,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .context("read scheduled_jobs")
}

fn cron_due_now(expr: &str, last_run_at: Option<&str>) -> Result<bool> {
    let schedule = Schedule::from_str(expr).context("parse cron expression")?;
    let now = Local::now();
    let start = now - chrono::Duration::minutes(2);
    for dt in schedule.after(&start).take(4) {
        if dt.minute() != now.minute() || dt.hour() != now.hour() {
            continue;
        }
        if dt.date_naive() != now.date_naive() {
            continue;
        }
        if let Some(last) = last_run_at {
            if last.starts_with(&format!(
                "{:04}-{:02}-{:02} {:02}:{:02}",
                now.year(),
                now.month(),
                now.day(),
                now.hour(),
                now.minute()
            )) {
                return Ok(false);
            }
        }
        return Ok(true);
    }
    Ok(false)
}

fn touch_last_run(conn: &Connection, job_id: i64) -> Result<()> {
    conn.execute(
        "UPDATE scheduled_jobs SET last_run_at = datetime('now') WHERE id = ?1",
        params![job_id],
    )?;
    Ok(())
}

fn tick(app: &AppHandle) -> Result<()> {
    let conn = open_db()?;
    let jobs = load_enabled_jobs(&conn)?;
    for job in jobs {
        if !cron_due_now(&job.cron_expr, job.last_run_at.as_deref())? {
            continue;
        }
        let payload = SchedulerJobEvent {
            job_id: job.id,
            name: job.name.clone(),
            job_type: job.job_type.clone(),
            script_id: job.script_id,
            host_group_id: job.host_group_id,
            host_ids_json: job.host_ids_json.clone(),
            cron_expr: job.cron_expr.clone(),
        };
        touch_last_run(&conn, job.id)?;
        let _ = app.emit("scheduler-job-due", payload);
    }
    Ok(())
}

/// 启动后台调度循环（30 秒 tick）。
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let handle = Arc::new(app);
        loop {
            if let Err(e) = tick(&handle) {
                eprintln!("scheduler tick error: {e:#}");
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn cron_expression_parses() {
        // cron crate uses 6-field expressions: sec min hour day month weekday
        assert!(Schedule::from_str("0 0 * * * *").is_ok());
        assert!(Schedule::from_str("0 * * * * *").is_ok());
        assert!(Schedule::from_str("not a cron").is_err());
    }
}
