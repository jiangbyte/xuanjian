//! SQLite 数据库迁移定义。
//!
//! 由 Tauri SQL 插件在应用启动时按 version 顺序执行。
//! 禁止在命令层直接改表结构；新增 schema 请追加新的 Migration。
//!
//! Author: Charlie

use tauri_plugin_sql::{Migration, MigrationKind};

/// 返回全部向上迁移（Up）列表，version 必须单调递增且不可改写历史版本内容。
pub fn migrations() -> Vec<Migration> {
    vec![
        // —— 迁移 v1：基础主机 / 分组 / 标签 / 设置 ——
        Migration {
            version: 1,
            description: "init_schema",
            sql: r#"
CREATE TABLE IF NOT EXISTS host_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL DEFAULT 'root',
  auth_type TEXT NOT NULL DEFAULT 'password',
  password_enc TEXT,
  private_key_path TEXT,
  group_id INTEGER,
  last_connected_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(group_id) REFERENCES host_groups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS host_tags (
  host_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (host_id, tag_id),
  FOREIGN KEY(host_id) REFERENCES hosts(id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS known_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  fingerprint TEXT NOT NULL,
  UNIQUE(host, port)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO host_groups (id, name, sort_order) VALUES (1, '默认', 0);
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('theme', 'dark');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('locale', 'zh-CN');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_local_shell', '');
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v2：主机扩展字段（备注、颜色、跳板等） ——
        Migration {
            version: 2,
            description: "host_rich_fields",
            sql: r#"
ALTER TABLE hosts ADD COLUMN remark TEXT;
ALTER TABLE hosts ADD COLUMN color TEXT;
ALTER TABLE hosts ADD COLUMN passphrase_enc TEXT;
ALTER TABLE hosts ADD COLUMN connect_timeout INTEGER NOT NULL DEFAULT 30;
ALTER TABLE hosts ADD COLUMN keepalive_interval INTEGER NOT NULL DEFAULT 60;
ALTER TABLE hosts ADD COLUMN terminal_type TEXT NOT NULL DEFAULT 'xterm-256color';
ALTER TABLE hosts ADD COLUMN startup_cmd TEXT;
ALTER TABLE hosts ADD COLUMN remote_path TEXT;
ALTER TABLE hosts ADD COLUMN jump_host_id INTEGER;
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v3：脚本包与脚本 ——
        Migration {
            version: 3,
            description: "scripts",
            sql: r#"
CREATE TABLE IF NOT EXISTS script_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'snippet',
  body TEXT NOT NULL,
  package_id INTEGER,
  paste_only INTEGER NOT NULL DEFAULT 0,
  send_mode TEXT NOT NULL DEFAULT 'once',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(package_id) REFERENCES script_packages(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO script_packages (id, name, sort_order) VALUES (1, '常用', 0);

INSERT OR IGNORE INTO scripts (id, name, description, kind, body, package_id, paste_only, send_mode)
VALUES
  (1, '磁盘空间', '查看磁盘占用', 'snippet', 'df -h', 1, 0, 'once'),
  (2, '系统日志', '跟踪系统日志', 'snippet', 'tail -f /var/log/syslog', 1, 0, 'once'),
  (3, '监听端口', '查看监听端口', 'snippet', 'ss -lntup', 1, 0, 'once');
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v4：笔记 ——
        Migration {
            version: 4,
            description: "notes",
            sql: r#"
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v5：笔记分类 ——
        Migration {
            version: 5,
            description: "note_categories",
            sql: r#"
CREATE TABLE IF NOT EXISTS note_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE notes ADD COLUMN category_id INTEGER REFERENCES note_categories(id) ON DELETE SET NULL;

INSERT OR IGNORE INTO note_categories (id, name, sort_order) VALUES (1, '默认', 0);
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v6：会话录制日志 ——
        Migration {
            version: 6,
            description: "session_logs",
            sql: r#"
CREATE TABLE IF NOT EXISTS session_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tab_id TEXT,
  session_id TEXT,
  kind TEXT NOT NULL,
  host_id INTEGER,
  shell_id TEXT,
  title TEXT NOT NULL,
  remote_user TEXT,
  remote_host TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  bytes_out INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_log_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  direction TEXT NOT NULL,
  t_ms INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(log_id) REFERENCES session_logs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_log_chunks_log ON session_log_chunks(log_id, seq);
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v7：网络工具历史 ——
        Migration {
            version: 7,
            description: "network_tool_history",
            sql: r#"
CREATE TABLE IF NOT EXISTS network_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_network_history_created ON network_history(created_at DESC);
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v8：Docker 编排项目 ——
        Migration {
            version: 8,
            description: "docker_projects",
            sql: r#"
CREATE TABLE IF NOT EXISTS docker_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  compose_json TEXT NOT NULL DEFAULT '{}',
  dockerfiles_json TEXT NOT NULL DEFAULT '{}',
  layout_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docker_projects_updated ON docker_projects(updated_at DESC);
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v9：移除 v3 预置样例脚本（保留空「常用」包） ——
        Migration {
            version: 9,
            description: "remove_sample_scripts",
            sql: r#"
DELETE FROM scripts WHERE
  (name = '磁盘空间' AND body = 'df -h')
  OR (name = '系统日志' AND body = 'tail -f /var/log/syslog')
  OR (name = '监听端口' AND body = 'ss -lntup');
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v10：默认主题改为明亮 ——
        Migration {
            version: 10,
            description: "default_theme_light",
            sql: r#"
UPDATE app_settings SET value = 'light' WHERE key = 'theme' AND value = 'dark';
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('theme', 'light');
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v11：Docker 项目类型（compose / dockerfile / full） ——
        Migration {
            version: 11,
            description: "docker_project_kind",
            sql: r#"
ALTER TABLE docker_projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'full';
"#,
            kind: MigrationKind::Up,
        },
    ]
}
