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
        // —— 迁移 v12：AI 供应商 / 模型 / MCP / Agent 会话 ——
        Migration {
            version: 12,
            description: "ai_agent_tables",
            sql: r#"
CREATE TABLE IF NOT EXISTS ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_format TEXT NOT NULL DEFAULT 'openai',
  api_key_enc TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  context_tag TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'http',
  command TEXT,
  args_json TEXT,
  url TEXT,
  env_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL DEFAULT 'local',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  runtime TEXT NOT NULL DEFAULT 'local',
  remote_agent_id TEXT,
  model_ref TEXT,
  permission_mode TEXT NOT NULL DEFAULT 'confirm',
  host_id INTEGER,
  tab_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  parts_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS remote_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_seen TEXT
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('agent.default_runtime', 'local');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('agent.default_permission_mode', 'confirm');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('agent.gateway_port', '18765');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backend.base_url', '');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('backend.token', '');
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v13：模型最大输出 token ——
        Migration {
            version: 13,
            description: "ai_models_max_output_tokens",
            sql: r#"
ALTER TABLE ai_models ADD COLUMN max_output_tokens INTEGER NOT NULL DEFAULT 0;
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v14：命令历史 + 审计 ——
        Migration {
            version: 14,
            description: "cmd_history_audit_events",
            sql: r#"
CREATE TABLE IF NOT EXISTS cmd_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cmd TEXT NOT NULL,
  session_id TEXT,
  host_id INTEGER,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cmd_history_session ON cmd_history(session_id);
CREATE INDEX IF NOT EXISTS idx_cmd_history_created ON cmd_history(created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'user',
  target TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action);
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v15：工作空间 + 部署 + 指标快照 ——
        Migration {
            version: 15,
            description: "workspaces_deploy_metrics",
            sql: r#"
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  local_root TEXT NOT NULL,
  host_id INTEGER NOT NULL,
  remote_root TEXT NOT NULL DEFAULT '/',
  exclude_patterns TEXT,
  deploy_recipe TEXT,
  tab_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deploy_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  host_id INTEGER,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_session ON metric_snapshots(session_id, created_at DESC);
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v16：定时任务 + 告警 ——
        Migration {
            version: 16,
            description: "automation_alerts",
            sql: r#"
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'script',
  script_id INTEGER,
  host_group_id INTEGER,
  host_ids_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  result_json TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  threshold REAL NOT NULL,
  comparison TEXT NOT NULL DEFAULT 'gt',
  host_id INTEGER,
  host_group_id INTEGER,
  session_id TEXT,
  webhook_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT,
  read_flag INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE
);
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v17：主机 SSH 代理字段 ——
        Migration {
            version: 17,
            description: "hosts_proxy_fields",
            sql: r#"
ALTER TABLE hosts ADD COLUMN proxy_type TEXT;
ALTER TABLE hosts ADD COLUMN proxy_host TEXT;
ALTER TABLE hosts ADD COLUMN proxy_port INTEGER;
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v18：字体默认值 + 深色主题 ——
        Migration {
            version: 18,
            description: "settings_defaults_dark",
            sql: r#"
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('term_font_size', '14');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('editor_font_size', '12');
UPDATE app_settings SET value = 'dark' WHERE key = 'theme' AND value = 'light';
"#,
            kind: MigrationKind::Up,
        },
        // —— 迁移 v19：外观跟随系统、编辑器暗色、笔记随系统 ——
        Migration {
            version: 19,
            description: "settings_theme_system_editor_dark",
            sql: r#"
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('editor_theme', 'vs-dark');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('markdown_color_mode', 'follow');
UPDATE app_settings SET value = 'system' WHERE key = 'theme';
"#,
            kind: MigrationKind::Up,
        },
    ]
}
