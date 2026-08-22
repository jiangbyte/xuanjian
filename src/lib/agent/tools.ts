/**
 * @file 本地 Agent 运维工具（xuanjian-local）— ReAct Action 层
 * @author Charlie
 */

import { stripAnsi } from "@/lib/agent/ansi";
import {
  getHost,
  getScript,
  listHosts,
  listScriptPackages,
  listScripts,
} from "@/lib/db";
import { metricsCmd, resolveProbeEnv } from "@/lib/probeEnv";
import { sendScriptToSession } from "@/lib/runScript";
import { applyScriptVars, extractScriptVars } from "@/lib/scriptVars";
import { getTranscriptTail } from "@/lib/sessionRecorder";
import { api } from "@/lib/tauri";
import { useCmdHistory } from "@/stores/cmdHistory";
import { useUiStore } from "@/stores/ui";
import { getHostOs } from "@/lib/platform";

export type AgentToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** 只读工具：plan / confirm / full 均可直接执行 */
export const READ_TOOLS = new Set([
  "terminal_tail",
  "host_info",
  "list_hosts",
  "list_sessions",
  "host_metrics",
  "list_scripts",
  "get_script",
  "list_cmd_history",
]);

/** 会改动终端或执行命令的工具 */
export const WRITE_TOOLS = new Set([
  "terminal_run",
  "session_exec",
  "run_script",
]);

export const LOCAL_TOOLS: AgentToolDef[] = [
  {
    type: "function",
    function: {
      name: "terminal_tail",
      description:
        "读取当前（或指定）交互终端的最近输出。先观察再行动时必用。",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "可选，默认活动会话" },
          max_chars: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_sessions",
      description: "列出打开的终端标签与 session_id",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "host_info",
      description: "查询主机库存信息（默认当前标签绑定主机）",
      parameters: {
        type: "object",
        properties: { host_id: { type: "number" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_hosts",
      description: "列出已保存主机",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_scripts",
      description:
        "列出本地脚本库（包/名称/描述）。需要正文时再用 get_script。运维可复用库内脚本，勿重复手写。",
      parameters: {
        type: "object",
        properties: {
          package_id: {
            type: "number",
            description: "按脚本包 id 过滤；省略则全部",
          },
          query: {
            type: "string",
            description: "按名称/描述/包名模糊搜索",
          },
          include_body: {
            type: "boolean",
            description: "是否附带正文预览（默认 false）",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_script",
      description:
        "读取脚本库中某条脚本的完整正文与变量占位符（{{name}} / {{name|默认}}）。执行前先看清内容。",
      parameters: {
        type: "object",
        properties: {
          script_id: { type: "number", description: "脚本 id" },
        },
        required: ["script_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_cmd_history",
      description:
        "读取本机终端历史命令（用户曾执行过的命令）。可按会话或关键词筛选，便于复用或排查。",
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "仅该会话；省略则全局",
          },
          query: {
            type: "string",
            description: "命令文本模糊匹配",
          },
          limit: {
            type: "number",
            description: "返回条数，默认 40，最大 120",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "terminal_run",
      description:
        "在【可见交互终端】中执行命令（写入 PTY，用户能看到）。优先用此工具代替 session_exec。不要编造输出。",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          command: { type: "string", description: "单行 shell 命令" },
          wait_ms: {
            type: "number",
            description: "写入后等待输出的毫秒数，默认 900",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "session_exec",
      description:
        "旁路一次性执行（不显示在交互终端）。仅用于静默探测；用户要看到命令时请用 terminal_run。",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          command: { type: "string" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_script",
      description:
        "将脚本库中的脚本写入可见终端执行。有 {{var}} 时用 vars 传入；缺省用模板默认值。优先复用库内脚本而非手写命令。",
      parameters: {
        type: "object",
        properties: {
          script_id: { type: "number" },
          session_id: { type: "string" },
          vars: {
            type: "object",
            description: "变量名 → 取值，如 {\"host\":\"1.2.3.4\"}",
            additionalProperties: { type: "string" },
          },
          wait_ms: {
            type: "number",
            description: "写入后等待输出的毫秒数，默认 1200",
          },
        },
        required: ["script_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "host_metrics",
      description: "对活动会话做 CPU/内存/磁盘探测（旁路执行）",
      parameters: {
        type: "object",
        properties: { session_id: { type: "string" } },
      },
    },
  },
];

const DANGEROUS =
  /\b(rm\s+-rf|mkfs|dd\s+if=|shutdown|reboot|passwd|userdel|DROP\s+TABLE|TRUNCATE)\b/i;

export type ToolExecContext = {
  permissionMode: "confirm" | "plan" | "full";
  /** confirm / 危险命令时由 ReAct 层注入 */
  confirmTool?: (info: {
    name: string;
    args: Record<string, unknown>;
    dangerous: boolean;
  }) => Promise<boolean>;
};

export function isWriteTool(name: string) {
  return WRITE_TOOLS.has(name);
}

export function isDangerousCommand(cmd: string) {
  return DANGEROUS.test(cmd);
}

function activeSessionId(explicit?: string): string | null {
  if (explicit) return explicit;
  const { tabs, activeTabId } = useUiStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  return tab?.sessionId ?? null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function resolveScriptVars(
  body: string,
  varsArg: unknown,
): { ok: true; body: string; values: Record<string, string> } | {
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

export async function executeLocalTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<string> {
  // —— 权限门：plan 禁写 ——
  if (ctx.permissionMode === "plan" && isWriteTool(name)) {
    return JSON.stringify({
      ok: false,
      blocked: true,
      reason:
        "当前为「计划」模式：禁止执行写操作。请只使用只读工具，并在最终回复中给出分步计划。",
    });
  }

  const cmd =
    typeof args.command === "string" ? args.command.trim() : "";

  // run_script：预先解析正文，供危险判断与确认展示
  let scriptPreview: {
    scriptId: number;
    name: string;
    body: string;
  } | null = null;
  if (name === "run_script") {
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
        hint: "请在 vars 中提供缺失变量后重试 get_script / run_script",
      });
    }
    scriptPreview = {
      scriptId,
      name: script.name,
      body: resolved.body,
    };
  }

  const dangerous =
    ((name === "terminal_run" || name === "session_exec") &&
      cmd.length > 0 &&
      isDangerousCommand(cmd)) ||
    (name === "run_script" &&
      !!scriptPreview &&
      isDangerousCommand(scriptPreview.body));

  // —— 权限门：confirm 所有写操作；full 仅危险 ——
  const needsConfirm =
    isWriteTool(name) &&
    (ctx.permissionMode === "confirm" ||
      (ctx.permissionMode === "full" && dangerous));

  if (needsConfirm) {
    const confirmArgs =
      name === "run_script" && scriptPreview
        ? {
            ...args,
            script_name: scriptPreview.name,
            resolved_preview: scriptPreview.body.slice(0, 500),
          }
        : args;
    const ok = ctx.confirmTool
      ? await ctx.confirmTool({ name, args: confirmArgs, dangerous })
      : false;
    if (!ok) {
      return JSON.stringify({
        ok: false,
        blocked: true,
        reason: "用户拒绝执行该操作",
      });
    }
  }

  switch (name) {
    case "terminal_tail": {
      const sid = activeSessionId(
        typeof args.session_id === "string" ? args.session_id : undefined,
      );
      if (!sid) return "No active terminal session";
      const max =
        typeof args.max_chars === "number" ? args.max_chars : 8000;
      const text = stripAnsi(await getTranscriptTail(sid, max));
      return text || "(empty transcript)";
    }
    case "host_info": {
      let hostId =
        typeof args.host_id === "number" ? args.host_id : undefined;
      if (hostId == null) {
        const { tabs, activeTabId } = useUiStore.getState();
        hostId = tabs.find((t) => t.id === activeTabId)?.hostId ?? undefined;
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
      const { tabs, activeTabId } = useUiStore.getState();
      return JSON.stringify(
        tabs.map((t) => ({
          tabId: t.id,
          title: t.title,
          kind: t.kind,
          sessionId: t.sessionId,
          hostId: t.hostId,
          status: t.status,
          active: t.id === activeTabId,
        })),
        null,
        2,
      );
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
          const hay = [
            r.name,
            r.description ?? "",
            r.package_name ?? "",
            r.kind,
          ]
            .join("\n")
            .toLowerCase();
          return hay.includes(q);
        });
      }
      const includeBody = args.include_body === true;
      return JSON.stringify(
        {
          packages: packages.map((p) => ({
            id: p.id,
            name: p.name,
          })),
          scripts: rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            kind: r.kind,
            package_id: r.package_id,
            package_name: r.package_name ?? null,
            send_mode: r.send_mode,
            paste_only: Boolean(r.paste_only),
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
      const vars = extractScriptVars(script.body);
      return JSON.stringify(
        {
          id: script.id,
          name: script.name,
          description: script.description,
          kind: script.kind,
          package_id: script.package_id,
          package_name: script.package_name ?? null,
          paste_only: Boolean(script.paste_only),
          send_mode: script.send_mode,
          vars,
          body: script.body,
        },
        null,
        2,
      );
    }
    case "list_cmd_history": {
      const items = useCmdHistory.getState().items;
      const sid =
        typeof args.session_id === "string" && args.session_id.trim()
          ? args.session_id.trim()
          : null;
      const q =
        typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      const limitRaw =
        typeof args.limit === "number" ? args.limit : asNum(args.limit);
      const limit = Math.min(Math.max(limitRaw ?? 40, 1), 120);
      let filtered = items;
      if (sid) {
        filtered = filtered.filter((it) => it.sessionId === sid);
      }
      if (q) {
        filtered = filtered.filter((it) => {
          const hay = `${it.cmd}\n${it.label ?? ""}`.toLowerCase();
          return hay.includes(q);
        });
      }
      const slice = filtered.slice(0, limit).map((it) => ({
        id: it.id,
        cmd: it.cmd,
        at: it.at,
        at_iso: new Date(it.at).toISOString(),
        session_id: it.sessionId,
        label: it.label ?? null,
      }));
      return JSON.stringify(
        {
          scope: sid ? "session" : "global",
          count: slice.length,
          total_matched: filtered.length,
          items: slice,
        },
        null,
        2,
      );
    }
    case "terminal_run": {
      if (!cmd) return "command required";
      const sid = activeSessionId(
        typeof args.session_id === "string" ? args.session_id : undefined,
      );
      if (!sid) return "No active session — 请先打开终端标签";
      const before = await getTranscriptTail(sid, 2000);
      // 写入可见 PTY（用户终端可见）
      await api.sessionWrite(sid, `${cmd}\n`);
      const wait =
        typeof args.wait_ms === "number"
          ? Math.min(Math.max(args.wait_ms, 200), 8000)
          : 900;
      await sleep(wait);
      const after = await getTranscriptTail(sid, 12_000);
      // 尽量返回增量
      let delta = after;
      if (before && after.startsWith(before)) {
        delta = after.slice(before.length);
      } else if (before && after.includes(before.slice(-80))) {
        const i = after.lastIndexOf(before.slice(-80));
        delta = after.slice(i + 80);
      }
      return JSON.stringify({
        ok: true,
        visible_in_terminal: true,
        command: cmd,
        output: stripAnsi((delta || after).slice(0, 16_000)),
      });
    }
    case "run_script": {
      if (!scriptPreview) {
        return JSON.stringify({ ok: false, error: "script resolve failed" });
      }
      const script = await getScript(scriptPreview.scriptId);
      if (!script) {
        return JSON.stringify({ ok: false, error: "script not found" });
      }
      const sid = activeSessionId(
        typeof args.session_id === "string" ? args.session_id : undefined,
      );
      if (!sid) return "No active session — 请先打开终端标签";
      const before = await getTranscriptTail(sid, 2000);
      await sendScriptToSession(sid, scriptPreview.body, {
        pasteOnly: Boolean(script.paste_only),
        sendMode: script.send_mode === "line" ? "line" : "once",
      });
      try {
        useCmdHistory.getState().push({
          cmd: scriptPreview.body.split("\n")[0] || script.name,
          sessionId: sid,
          label: script.name,
        });
      } catch {
        /* ignore */
      }
      const wait =
        typeof args.wait_ms === "number"
          ? Math.min(Math.max(args.wait_ms, 200), 8000)
          : 1200;
      await sleep(wait);
      const after = await getTranscriptTail(sid, 12_000);
      let delta = after;
      if (before && after.startsWith(before)) {
        delta = after.slice(before.length);
      } else if (before && after.includes(before.slice(-80))) {
        const i = after.lastIndexOf(before.slice(-80));
        delta = after.slice(i + 80);
      }
      return JSON.stringify({
        ok: true,
        visible_in_terminal: true,
        script_id: script.id,
        script_name: script.name,
        output: stripAnsi((delta || after).slice(0, 16_000)),
      });
    }
    case "host_metrics": {
      const { tabs, activeTabId } = useUiStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId);
      const sid =
        (typeof args.session_id === "string" ? args.session_id : null) ||
        tab?.sessionId ||
        null;
      if (!sid) return "No active session";
      const env = resolveProbeEnv(
        tab?.kind ?? "local",
        tab?.shellId,
        getHostOs(),
      );
      const out = await api.sessionExec(sid, metricsCmd(env, tab?.shellId));
      return out.slice(0, 12_000);
    }
    case "session_exec": {
      if (!cmd) return "command required";
      const sid = activeSessionId(
        typeof args.session_id === "string" ? args.session_id : undefined,
      );
      if (!sid) return "No active session";
      const out = await api.sessionExec(sid, cmd);
      return JSON.stringify({
        ok: true,
        visible_in_terminal: false,
        note: "旁路执行，未写入交互终端",
        command: cmd,
        output: stripAnsi(out.slice(0, 20_000)),
      });
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
