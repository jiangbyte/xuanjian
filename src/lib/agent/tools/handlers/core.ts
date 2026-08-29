/**
 * @file Agent 工具 switch 处理器
 * @author Charlie
 */

import { stripAnsi } from "@/lib/agent/ansi";
import { waitForTerminalIdle } from "@/lib/agent/tools/terminalIdleWait";
import { runDeployToolHandler } from "@/lib/agent/tools/handlers/deploy";
import { runReadToolHandler } from "@/lib/agent/tools/handlers/read";
import {
  getHost,
  getScript,
  listCmdHistory,
  listHosts,
  listScriptPackages,
  listScripts,
} from "@/lib/db";
import { runBatchScript, resolveBatchHostIds } from "@/lib/automation/batch";
import { connectSshHost } from "@/lib/session/connect";
import { metricsCmd, resolveProbeEnv } from "@/lib/session/probeEnv";
import { sendScriptToSession } from "@/lib/session/runScript";
import { applyScriptVars, extractScriptVars } from "@/lib/session/scriptVars";
import { getTranscriptTail } from "@/lib/session/recorder";
import { api } from "@/lib/tauri";
import { getHostOs } from "@/lib/core/platform";
import {
  serializeSessionsForAgent,
  describePlane,
} from "@/lib/agent/runtime/executionContext";
import {
  activeAgentSessionIdAsync,
  activeSessionIdAsync,
  activeTabHostId,
  formatResolveError,
  resolveTabForExecution,
  tabIdFromArgs,
} from "@/lib/agent/tools/helpers";
import { asNum } from "@/lib/agent/tools/types";
import { useCmdHistory } from "@/stores/cmdHistory";

async function runVisibleAgentCommand(
  args: Record<string, unknown>,
  cmd: string,
  opts?: { defaultWaitMs?: number; historyLabel?: string },
): Promise<string> {
  const target = await activeAgentSessionIdAsync(args);
  if (!target) return formatResolveError(args);
  const { sessionId: sid, tab, parentTab, provisioned } = target;
  const before = await getTranscriptTail(sid, 2000);
  await api.sessionWrite(sid, `${cmd}\n`);
  useCmdHistory.getState().push({
    cmd,
    sessionId: sid,
    label: opts?.historyLabel,
  });
  const wait =
    asNum(args.wait_ms) != null
      ? Math.min(Math.max(asNum(args.wait_ms)!, 200), 600_000)
      : (opts?.defaultWaitMs ?? 900);
  const waited = await waitForTerminalIdle({
    sessionId: sid,
    maxChars: 12_000,
    waitMs: wait,
    quietMs: 1200,
  });
  const after = waited.output;
  let delta = after;
  if (before && after.startsWith(before)) delta = after.slice(before.length);
  return JSON.stringify({
    ok: true,
    visible_in_terminal: true,
    terminal_plane: "agent_bottom_panel",
    tab_id: parentTab.id,
    agent_tab_id: tab.id,
    plane: describePlane(parentTab),
    auto_opened: provisioned,
    command: cmd,
    waited_ms: waited.waited_ms,
    requested_wait_ms: waited.requested_wait_ms,
    finish_reason: waited.finish_reason,
    likely_finished: waited.likely_finished,
    still_running: waited.still_running,
    progress_digest: waited.progress_digest,
    suggested_next_wait_ms: waited.suggested_next_wait_ms,
    effective_quiet_ms: waited.effective_quiet_ms,
    output: stripAnsi((delta || after).slice(0, 16_000)),
  });
}

function parseProbeMetrics(raw: string) {
  let cpuPct = 0;
  let memUsed = 0;
  let memTotal = 0;
  let diskUsed = 0;
  let diskTotal = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("CPU ")) cpuPct = Number(line.slice(4).trim()) || 0;
    if (line.startsWith("MEM ")) {
      const parts = line.slice(4).trim().split(/\s+/);
      memTotal = Number(parts[0]) || 0;
      memUsed = Number(parts[1]) || 0;
    }
    if (line.startsWith("DISK ")) {
      const parts = line.slice(5).trim().split(/\s+/);
      diskTotal = Number(parts[0]) || 0;
      diskUsed = Number(parts[1]) || 0;
    }
  }
  const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
  const diskPct = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;
  return { cpuPct, memPct, diskPct };
}

function resolveScriptVars(
  body: string,
  varsArg: unknown,
):
  | { ok: true; body: string; values: Record<string, string> }
  | {
      ok: false;
      need_vars: string[];
      vars: ReturnType<typeof extractScriptVars>;
    } {
  const needed = extractScriptVars(body);
  const provided =
    varsArg && typeof varsArg === "object" && !Array.isArray(varsArg)
      ? (varsArg as Record<string, unknown>)
      : {};
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const v of needed) {
    const raw = provided[v.name];
    if (raw != null && String(raw).length > 0) {
      values[v.name] = String(raw);
    } else if (v.defaultValue != null) {
      values[v.name] = v.defaultValue;
    } else {
      missing.push(v.name);
    }
  }
  if (missing.length) {
    return { ok: false, need_vars: missing, vars: needed };
  }
  return { ok: true, body: applyScriptVars(body, values), values };
}

export async function runToolHandler(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const cmd = typeof args.command === "string" ? args.command.trim() : "";

  switch (name) {
    case "terminal_tail": {
      const target = await activeAgentSessionIdAsync(args);
      if (!target)
        return formatResolveError(args, "No active agent terminal session");
      const maxCharsRaw = asNum(args.max_chars);
      const maxChars =
        maxCharsRaw != null
          ? Math.min(Math.max(maxCharsRaw, 256), 32_000)
          : 12_000;
      const waitRaw = asNum(args.wait_ms);
      const waitMs =
        waitRaw != null ? Math.min(Math.max(waitRaw, 0), 600_000) : 0;
      const stableRaw = asNum(args.stable_ms);
      const stableMs =
        stableRaw != null
          ? Math.min(Math.max(stableRaw, 500), 30_000)
          : 1500;

      const waited = await waitForTerminalIdle({
        sessionId: target.sessionId,
        maxChars,
        waitMs,
        quietMs: stableMs,
      });

      return JSON.stringify({
        ok: true,
        visible_in_terminal: true,
        terminal_plane: "agent_bottom_panel",
        tab_id: target.parentTab.id,
        agent_tab_id: target.tab.id,
        waited_ms: waited.waited_ms,
        requested_wait_ms: waited.requested_wait_ms,
        finish_reason: waited.finish_reason,
        likely_finished: waited.likely_finished,
        still_running: waited.still_running,
        progress_digest: waited.progress_digest,
        suggested_next_wait_ms: waited.suggested_next_wait_ms,
        effective_quiet_ms: waited.effective_quiet_ms,
        chars: waited.output.length,
        output: waited.output || "(empty transcript)",
      });
    }
    case "host_info": {
      let hostId = typeof args.host_id === "number" ? args.host_id : undefined;
      if (hostId == null) {
        const resolved = await resolveTabForExecution(args);
        hostId = resolved?.tab.hostId ?? activeTabHostId(tabIdFromArgs(args));
      }
      if (hostId == null) return "No host bound to active tab";
      const h = await getHost(hostId);
      if (!h) return "Host not found";
      return JSON.stringify(
        {
          id: h.id,
          name: h.name,
          host: h.host,
          port: h.port,
          username: h.username,
          group: h.group_name,
          tags: h.tags,
          remark: h.remark,
          remote_path: h.remote_path,
        },
        null,
        2,
      );
    }
    case "list_hosts": {
      const rows = await listHosts();
      return JSON.stringify(
        rows.map((h) => ({
          id: h.id,
          name: h.name,
          host: h.host,
          port: h.port,
          username: h.username,
          tags: h.tags,
        })),
        null,
        2,
      );
    }
    case "list_sessions": {
      const rows = await serializeSessionsForAgent();
      return JSON.stringify(rows, null, 2);
    }
    case "list_scripts": {
      const packages = await listScriptPackages();
      let rows = await listScripts();
      const packageId = asNum(args.package_id);
      if (packageId != null) {
        rows = rows.filter((r) => r.package_id === packageId);
      }
      const q =
        typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      if (q) {
        rows = rows.filter((r) => {
          const hay = [r.name, r.description ?? "", r.package_name ?? ""]
            .join("\n")
            .toLowerCase();
          return hay.includes(q);
        });
      }
      const includeBody = args.include_body === true;
      return JSON.stringify(
        {
          packages: packages.map((p) => ({ id: p.id, name: p.name })),
          scripts: rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            kind: r.kind,
            package_id: r.package_id,
            package_name: r.package_name ?? null,
            vars: extractScriptVars(r.body).map((v) => v.name),
            ...(includeBody
              ? {
                  body_preview: r.body.slice(0, 240),
                  body_chars: r.body.length,
                }
              : {}),
          })),
          count: rows.length,
        },
        null,
        2,
      );
    }
    case "get_script": {
      const scriptId = asNum(args.script_id);
      if (scriptId == null) {
        return JSON.stringify({ ok: false, error: "script_id required" });
      }
      const script = await getScript(scriptId);
      if (!script) {
        return JSON.stringify({ ok: false, error: "script not found" });
      }
      return JSON.stringify(
        {
          id: script.id,
          name: script.name,
          body: script.body,
          vars: extractScriptVars(script.body),
        },
        null,
        2,
      );
    }
    case "list_cmd_history": {
      const sid =
        typeof args.session_id === "string" && args.session_id.trim()
          ? args.session_id.trim()
          : null;
      const q = typeof args.query === "string" ? args.query : undefined;
      const limitRaw = asNum(args.limit);
      const rows = await listCmdHistory({
        sessionId: sid,
        query: q,
        limit: limitRaw ?? 40,
      });
      return JSON.stringify(
        {
          scope: sid ? "session" : "global",
          count: rows.length,
          items: rows.map((r) => ({
            id: r.id,
            cmd: r.cmd,
            session_id: r.session_id,
            label: r.label,
            created_at: r.created_at,
          })),
        },
        null,
        2,
      );
    }
    case "terminal_run": {
      if (!cmd) return "command required";
      return runVisibleAgentCommand(args, cmd);
    }
    case "run_script": {
      const scriptId = asNum(args.script_id);
      if (scriptId == null) {
        return JSON.stringify({ ok: false, error: "script_id required" });
      }
      const script = await getScript(scriptId);
      if (!script) {
        return JSON.stringify({ ok: false, error: "script not found" });
      }
      const resolved = resolveScriptVars(script.body, args.vars);
      if (!resolved.ok) {
        return JSON.stringify({
          ok: false,
          error: "missing script vars",
          need_vars: resolved.need_vars,
          vars: resolved.vars,
        });
      }
      const target = await activeAgentSessionIdAsync(args);
      if (!target) return formatResolveError(args);
      const { sessionId: sid } = target;
      const before = await getTranscriptTail(sid, 2000);
      await sendScriptToSession(sid, resolved.body, {
        pasteOnly: Boolean(script.paste_only),
        sendMode: script.send_mode === "line" ? "line" : "once",
      });
      useCmdHistory.getState().push({
        cmd: resolved.body.split("\n")[0] || script.name,
        sessionId: sid,
        label: script.name,
      });
      const waitRaw = asNum(args.wait_ms);
      const wait =
        waitRaw != null
          ? Math.min(Math.max(waitRaw, 200), 600_000)
          : 3000;
      const waited = await waitForTerminalIdle({
        sessionId: sid,
        maxChars: 12_000,
        waitMs: wait,
        quietMs: 1200,
      });
      const after = waited.output;
      let delta = after;
      if (before && after.startsWith(before))
        delta = after.slice(before.length);
      return JSON.stringify({
        ok: true,
        visible_in_terminal: true,
        terminal_plane: "agent_bottom_panel",
        script_id: script.id,
        script_name: script.name,
        waited_ms: waited.waited_ms,
        requested_wait_ms: waited.requested_wait_ms,
        finish_reason: waited.finish_reason,
        likely_finished: waited.likely_finished,
        still_running: waited.still_running,
        progress_digest: waited.progress_digest,
        suggested_next_wait_ms: waited.suggested_next_wait_ms,
        effective_quiet_ms: waited.effective_quiet_ms,
        output: stripAnsi((delta || after).slice(0, 16_000)),
      });
    }
    case "host_metrics": {
      const resolved = await resolveTabForExecution(args);
      if (!resolved?.tab.sessionId) return formatResolveError(args);
      const { tab } = resolved;
      const sid = tab.sessionId!;
      const env = resolveProbeEnv(
        tab.kind ?? "local",
        tab.shellId,
        getHostOs(),
      );
      const out = await api.sessionExec(sid, metricsCmd(env, tab.shellId));
      return out.slice(0, 12_000);
    }
    case "session_exec": {
      if (!cmd) return "command required";
      return runVisibleAgentCommand(args, cmd, { defaultWaitMs: 1200 });
    }
    case "run_batch": {
      const scriptId = asNum(args.script_id);
      if (scriptId == null) return "script_id required";
      const hostIds = Array.isArray(args.host_ids)
        ? args.host_ids.filter((x): x is number => typeof x === "number")
        : undefined;
      const hostGroupId = asNum(args.host_group_id);
      const vars =
        args.vars && typeof args.vars === "object" && !Array.isArray(args.vars)
          ? (args.vars as Record<string, string>)
          : undefined;
      const result = await runBatchScript({
        script_id: scriptId,
        host_ids: hostIds,
        host_group_id: hostGroupId,
        vars,
      });
      return JSON.stringify({ ok: true, ...result }, null, 2);
    }
    case "create_inspection_report": {
      const hostIds = Array.isArray(args.host_ids)
        ? args.host_ids.filter((x): x is number => typeof x === "number")
        : undefined;
      const hostGroupId = asNum(args.host_group_id);
      const ids = await resolveBatchHostIds({
        host_ids: hostIds,
        host_group_id: hostGroupId,
      });
      if (!ids.length) return "No target hosts";
      const allHosts = await listHosts();
      const hostMap = new Map(allHosts.map((h) => [h.id, h]));
      const env = resolveProbeEnv("ssh", null);
      const cmd = metricsCmd(env);
      const lines: string[] = ["# Inspection Report", ""];
      for (const id of ids) {
        const host = hostMap.get(id);
        if (!host) continue;
        lines.push(`## ${host.name} (${host.host})`);
        try {
          const { session } = await connectSshHost(host.id, {
            runStartup: false,
          });
          try {
            const raw = await api.sessionExec(session.id, cmd);
            const m = parseProbeMetrics(raw);
            lines.push(
              `- CPU: ${m.cpuPct.toFixed(1)}%`,
              `- Memory: ${m.memPct.toFixed(1)}%`,
              `- Disk: ${m.diskPct.toFixed(1)}%`,
              "",
            );
          } finally {
            await api.sessionClose(session.id).catch(() => undefined);
          }
        } catch (e) {
          lines.push(`- Error: ${String(e)}`, "");
        }
      }
      return lines.join("\n");
    }
    case "docker_compose_up": {
      const target = await activeSessionIdAsync(args);
      if (!target) return formatResolveError(args);
      const sid = target.sessionId;
      const composeFile =
        typeof args.compose_file === "string" && args.compose_file.trim()
          ? args.compose_file.trim()
          : null;
      const detach = args.detach !== false;
      const parts = ["docker compose"];
      if (composeFile) parts.push("-f", composeFile);
      parts.push("up");
      if (detach) parts.push("-d");
      const command = parts.join(" ");
      const out = await api.sessionExec(sid, command);
      return JSON.stringify({
        ok: true,
        command,
        output: stripAnsi(out.slice(0, 20_000)),
      });
    }
    default: {
      const readResult = await runReadToolHandler(name, args);
      if (readResult != null) return readResult;
      const deployResult = await runDeployToolHandler(name, args);
      if (deployResult != null) return deployResult;
      return `Unknown tool: ${name}`;
    }
  }
}
