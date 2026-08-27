/**
 * @file 告警引擎
 * @author Charlie
 * @description 将指标快照与 alert_rules 比对，触发时写入 alert_events。
 */

import {
  createAlertEvent,
  listAlertRules,
  type AlertRuleRow,
} from "@/lib/db/automation";
import { listHosts } from "@/lib/db/hosts";

export type MetricPayload = {
  session_id?: string;
  host_id?: number | null;
  cpuPct?: number;
  memPct?: number;
  diskPct?: number;
  memUsed?: number;
  memTotal?: number;
  diskUsed?: number;
  diskTotal?: number;
};

function pct(used: number, total: number): number {
  if (total <= 0) return 0;
  return (used / total) * 100;
}

function metricValue(
  rule: AlertRuleRow,
  payload: MetricPayload,
): number | null {
  switch (rule.metric_type) {
    case "cpu":
    case "cpuPct":
      return payload.cpuPct ?? null;
    case "mem":
    case "memPct":
      return payload.memPct ?? pct(payload.memUsed ?? 0, payload.memTotal ?? 0);
    case "disk":
    case "diskPct":
      return (
        payload.diskPct ?? pct(payload.diskUsed ?? 0, payload.diskTotal ?? 0)
      );
    default:
      return null;
  }
}

function compare(
  value: number,
  threshold: number,
  comparison: string,
): boolean {
  switch (comparison) {
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
    case "gte":
      return value >= threshold;
    default:
      return value > threshold;
  }
}

function ruleMatchesScope(
  rule: AlertRuleRow,
  payload: MetricPayload,
  hostGroupByHostId: Map<number, number | null>,
): boolean {
  if (rule.session_id && payload.session_id !== rule.session_id) return false;
  if (rule.host_id != null && payload.host_id !== rule.host_id) return false;
  if (rule.host_group_id != null) {
    const gid = payload.host_id ? hostGroupByHostId.get(payload.host_id) : null;
    if (gid !== rule.host_group_id) return false;
  }
  return true;
}

export type AlertCheckResult = {
  triggered: number;
  events: { rule_id: number; message: string }[];
};

/**
 * 检查全部启用规则；命中则写入 alert_events。
 */
export async function checkAlertRules(
  payload: MetricPayload,
): Promise<AlertCheckResult> {
  const rules = (await listAlertRules()).filter((r) => r.enabled === 1);
  if (!rules.length) return { triggered: 0, events: [] };

  const hosts = await listHosts();
  const hostGroupByHostId = new Map(
    hosts.map((h) => [h.id, h.group_id ?? null]),
  );

  const enriched: MetricPayload = {
    ...payload,
    memPct: payload.memPct ?? pct(payload.memUsed ?? 0, payload.memTotal ?? 0),
    diskPct:
      payload.diskPct ?? pct(payload.diskUsed ?? 0, payload.diskTotal ?? 0),
  };

  const events: { rule_id: number; message: string }[] = [];

  for (const rule of rules) {
    if (!ruleMatchesScope(rule, enriched, hostGroupByHostId)) continue;
    const value = metricValue(rule, enriched);
    if (value == null) continue;
    if (!compare(value, rule.threshold, rule.comparison)) continue;

    const message = `${rule.name}: ${rule.metric_type}=${value.toFixed(1)} ${rule.comparison} ${rule.threshold}`;
    await createAlertEvent({
      rule_id: rule.id,
      message,
      payload_json: JSON.stringify({ ...enriched, value }),
    });
    events.push({ rule_id: rule.id, message });

    if (rule.webhook_url?.trim()) {
      void fetch(rule.webhook_url.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule: rule.name, message, payload: enriched }),
      }).catch(() => undefined);
    }
  }

  return { triggered: events.length, events };
}
