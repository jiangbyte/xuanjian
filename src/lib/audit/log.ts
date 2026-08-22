/**
 * @file 审计统一入口
 * @author Charlie
 */

import {
  insertAuditEvent,
  type AuditAction,
} from "@/lib/db/audit";

export type AuditInput = {
  action: AuditAction | string;
  actor?: string;
  target?: string | null;
  detail?: Record<string, unknown> | null;
};

/** 追加审计记录（失败静默，不阻断主流程） */
export async function auditLog(input: AuditInput): Promise<void> {
  try {
    await insertAuditEvent(input);
  } catch (e) {
    console.warn("[audit]", input.action, e);
  }
}
