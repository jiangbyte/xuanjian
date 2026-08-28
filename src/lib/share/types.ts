/**
 * @file 分享导入导出类型（xuanjian-export v1）
 * @author Charlie
 */

export const EXPORT_FORMAT = "xuanjian-export" as const;
export const EXPORT_VERSION = 2 as const;

export type ExportHostGroup = {
  name: string;
  sort_order?: number;
};

export type ExportHostItem = {
  name: string;
  host: string;
  port?: number;
  username?: string;
  auth_type?: string;
  group?: string | null;
  tags?: string[];
  remark?: string | null;
  color?: string | null;
  connect_timeout?: number | null;
  keepalive_interval?: number | null;
  terminal_type?: string | null;
  startup_cmd?: string | null;
  remote_path?: string | null;
  jump_host?: string | null;
  private_key_path?: string | null;
  /** 明文口令；仅在显式勾选导出时出现 */
  password?: string | null;
  passphrase?: string | null;
};

export type ExportScriptPackage = {
  name: string;
  sort_order?: number;
};

export type ExportScriptItem = {
  name: string;
  description?: string | null;
  kind?: string;
  body: string;
  package?: string | null;
  paste_only?: boolean;
  send_mode?: "once" | "line";
};

export type ExportNoteCategory = {
  name: string;
  sort_order?: number;
};

export type ExportNoteItem = {
  title: string;
  body?: string;
  pinned?: boolean;
  category?: string | null;
};

export type ExportWorkspaceItem = {
  name: string;
  local_root: string;
  host_name: string;
  remote_root?: string;
  exclude_patterns?: string | null;
  deploy_recipe?: string | null;
};

export type ExportAlertRule = {
  name: string;
  metric_type: string;
  threshold: number;
  comparison?: string;
  host_name?: string | null;
  webhook_url?: string | null;
  enabled?: boolean;
};

export type ExportAuditSummary = {
  total: number;
  byAction: Record<string, number>;
  recent: Array<{
    action: string;
    target: string | null;
    created_at: string;
  }>;
};

export type XuanjianExport = {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  /** 整包 AES 加密（encrypt_secret）；同机导入可解密 */
  encryptedPayload?: string;
  hosts?: {
    groups?: ExportHostGroup[];
    items?: ExportHostItem[];
  };
  scripts?: {
    packages?: ExportScriptPackage[];
    items?: ExportScriptItem[];
  };
  notes?: {
    categories?: ExportNoteCategory[];
    items?: ExportNoteItem[];
  };
  workspaces?: ExportWorkspaceItem[];
  alertRules?: ExportAlertRule[];
  auditSummary?: ExportAuditSummary;
};

export type ImportResult = {
  created: number;
  skipped: number;
  errors: string[];
};
