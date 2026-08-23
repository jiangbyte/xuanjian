/**
 * @file Agent 只读工具处理器（M2）
 * @author Charlie
 */

import { stripAnsi } from "@/lib/agent/ansi";
import {
  DOCKER_JSON_FORMAT,
  looksLikeDockerError,
  parseDockerJsonLines,
  safeDockerArg,
} from "@/lib/agent/tools/handlers/dockerHelpers";
import {
  activeFsEndpointAsync,
  activeSessionIdAsync,
  formatResolveError,
  resolveTabForExecution,
} from "@/lib/agent/tools/helpers";
import { asNum } from "@/lib/agent/tools/types";
import { searchCmdHistory, searchNotes, searchSessionLogs } from "@/lib/db";
import {
  diskSnapshotCmd,
  portsCmd,
  resolveProbeEnv,
} from "@/lib/session/probeEnv";
import { fsListDir, fsReadFile } from "@/lib/fs";
import { getHostOs } from "@/lib/core/platform";
import { api } from "@/lib/tauri";

function parentDir(path: string, unix: boolean) {
  const p = path.replace(/\\/g, "/");
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return unix ? "/" : p.slice(0, 2) || "/";
  return p.slice(0, idx);
}

function basename(path: string) {
  const p = path.replace(/\\/g, "/");
  return p.split("/").pop() || p;
}

export async function runReadToolHandler(
  name: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  switch (name) {
    case "list_files": {
      const hit = await activeFsEndpointAsync(args);
      if (!hit) {
        return JSON.stringify({
          ok: false,
          error: formatResolveError(args, "No active session"),
        });
      }
      const { endpoint: ep, tab, provisioned } = hit;
      const path =
        typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
      const limit = Math.min(Math.max(asNum(args.limit) ?? 200, 1), 500);
      const offset = Math.max(asNum(args.offset) ?? 0, 0);
      try {
        const rows = await fsListDir(ep, path);
        const slice = rows.slice(offset, offset + limit);
        return JSON.stringify(
          {
            path,
            tab_id: tab.id,
            auto_opened: provisioned,
            endpoint: ep.kind,
            count: slice.length,
            total: rows.length,
            offset,
            entries: slice.map((e) => ({
              name: e.name,
              path: e.path,
              isDir: e.isDir,
              size: e.size,
              modifiedAt: e.modifiedAt ?? null,
            })),
          },
          null,
          2,
        );
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
      }
    }
    case "read_file": {
      const hit = await activeFsEndpointAsync(args);
      if (!hit) {
        return JSON.stringify({
          ok: false,
          error: formatResolveError(args, "No active session"),
        });
      }
      const { endpoint: ep } = hit;
      const path = typeof args.path === "string" ? args.path.trim() : "";
      if (!path) return JSON.stringify({ ok: false, error: "path required" });
      const max =
        typeof args.max_chars === "number"
          ? Math.min(Math.max(args.max_chars, 256), 64_000)
          : 16_000;
      try {
        const text = await fsReadFile(ep, path);
        return JSON.stringify({
          ok: true,
          path,
          truncated: text.length > max,
          chars: text.length,
          content: text.slice(0, max),
        });
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
      }
    }
    case "file_info": {
      const hit = await activeFsEndpointAsync(args);
      if (!hit) {
        return JSON.stringify({
          ok: false,
          error: formatResolveError(args, "No active session"),
        });
      }
      const { endpoint: ep } = hit;
      const path = typeof args.path === "string" ? args.path.trim() : "";
      if (!path) return JSON.stringify({ ok: false, error: "path required" });
      try {
        const dir = parentDir(path, ep.unixPaths);
        const rows = await fsListDir(ep, dir);
        const name = basename(path);
        const hit = rows.find(
          (e) => e.name === name || e.path === path || e.path.endsWith(`/${name}`),
        );
        if (!hit) {
          return JSON.stringify({ ok: false, error: "not found", path });
        }
        return JSON.stringify(
          {
            ok: true,
            name: hit.name,
            path: hit.path,
            isDir: hit.isDir,
            size: hit.size,
            modifiedAt: hit.modifiedAt ?? null,
            permissions: hit.permissions ?? null,
          },
          null,
          2,
        );
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
      }
    }
    case "ping": {
      const target =
        typeof args.target === "string" ? args.target.trim() : "";
      if (!target) return JSON.stringify({ ok: false, error: "target required" });
      const count = asNum(args.count);
      try {
        const out = await api.networkPing(target, count ?? undefined);
        return out.slice(0, 12_000);
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
      }
    }
    case "dns_lookup": {
      const host = typeof args.host === "string" ? args.host.trim() : "";
      if (!host) return JSON.stringify({ ok: false, error: "host required" });
      const recordType =
        typeof args.record_type === "string" && args.record_type.trim()
          ? args.record_type.trim()
          : "A";
      try {
        const out = await api.networkDnsLookup(host, recordType);
        return out.slice(0, 12_000);
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
      }
    }
    case "tcp_probe": {
      const host = typeof args.host === "string" ? args.host.trim() : "";
      if (!host) return JSON.stringify({ ok: false, error: "host required" });
      const portsRaw = args.ports;
      const ports: number[] = Array.isArray(portsRaw)
        ? portsRaw.map((p) => asNum(p)).filter((p): p is number => p != null)
        : typeof portsRaw === "number"
          ? [portsRaw]
          : [];
      if (!ports.length) {
        return JSON.stringify({ ok: false, error: "ports required" });
      }
      const timeoutMs = asNum(args.timeout_ms) ?? undefined;
      try {
        const rows = await api.networkTcpProbe(host, ports, timeoutMs);
        return JSON.stringify(rows, null, 2);
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
      }
    }
    case "tls_cert": {
      const hostPort =
        typeof args.host_port === "string"
          ? args.host_port.trim()
          : typeof args.host === "string"
            ? args.host.trim()
            : "";
      if (!hostPort) {
        return JSON.stringify({ ok: false, error: "host_port required" });
      }
      try {
        const info = await api.networkTlsCert(hostPort);
        return JSON.stringify(info, null, 2);
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
      }
    }
    case "docker_ps": {
      const target = await activeSessionIdAsync(args);
      if (!target) {
        return JSON.stringify({
          ok: false,
          error: formatResolveError(args, "No active session"),
        });
      }
      const sid = target.sessionId;
      const all = args.all !== false;
      const flag = all ? "-a" : "";
      const raw = await api.sessionExec(
        sid,
        `docker ps ${flag} ${DOCKER_JSON_FORMAT} 2>&1`,
      );
      if (looksLikeDockerError(raw) && !raw.includes("{")) {
        return JSON.stringify({ ok: false, error: raw.slice(0, 800) });
      }
      const rows = parseDockerJsonLines<Record<string, string>>(raw).map(
        (row) => ({
          id: row.ID || row.Id || "",
          name: (row.Names || row.Name || "").replace(/^\//, ""),
          image: row.Image || "",
          status: row.Status || "",
          state: row.State || "",
          ports: row.Ports || "",
        }),
      );
      return JSON.stringify({ ok: true, count: rows.length, containers: rows }, null, 2);
    }
    case "docker_logs": {
      const target = await activeSessionIdAsync(args);
      if (!target) {
        return JSON.stringify({
          ok: false,
          error: formatResolveError(args, "No active session"),
        });
      }
      const sid = target.sessionId;
      const container =
        typeof args.container === "string" ? args.container.trim() : "";
      if (!container) {
        return JSON.stringify({ ok: false, error: "container required" });
      }
      const tail = Math.min(Math.max(asNum(args.tail) ?? 200, 20), 2000);
      try {
        const ref = safeDockerArg(container);
        const raw = await api.sessionExec(
          sid,
          `docker logs --tail ${tail} ${ref} 2>&1`,
        );
        return JSON.stringify({
          ok: true,
          container: ref,
          tail,
          logs: stripAnsi(raw).slice(0, 20_000),
        });
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
      }
    }
    case "docker_inspect": {
      const target = await activeSessionIdAsync(args);
      if (!target) {
        return JSON.stringify({
          ok: false,
          error: formatResolveError(args, "No active session"),
        });
      }
      const sid = target.sessionId;
      const container =
        typeof args.container === "string" ? args.container.trim() : "";
      if (!container) {
        return JSON.stringify({ ok: false, error: "container required" });
      }
      try {
        const ref = safeDockerArg(container);
        const raw = await api.sessionExec(
          sid,
          `docker inspect ${ref} 2>&1`,
        );
        if (looksLikeDockerError(raw) && !raw.trim().startsWith("[")) {
          return JSON.stringify({ ok: false, error: raw.slice(0, 800) });
        }
        return raw.slice(0, 24_000);
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
      }
    }
    case "search_notes": {
      const q = typeof args.query === "string" ? args.query : "";
      const limit = asNum(args.limit) ?? 20;
      const rows = await searchNotes(q, limit);
      return JSON.stringify(
        {
          count: rows.length,
          notes: rows.map((n) => ({
            id: n.id,
            title: n.title,
            pinned: Boolean(n.pinned),
            category: n.category_name ?? null,
            preview: n.body.slice(0, 160),
            updated_at: n.updated_at,
          })),
        },
        null,
        2,
      );
    }
    case "search_session_logs": {
      const q = typeof args.query === "string" ? args.query : "";
      const limit = asNum(args.limit) ?? 30;
      const kind =
        args.kind === "ssh" || args.kind === "local" ? args.kind : null;
      const rows = await searchSessionLogs(q, { kind, limit });
      return JSON.stringify(
        {
          count: rows.length,
          logs: rows.map((r) => ({
            id: r.id,
            title: r.title,
            kind: r.kind,
            host_id: r.host_id,
            status: r.status,
            started_at: r.started_at,
            ended_at: r.ended_at,
            bytes_out: r.bytes_out,
          })),
        },
        null,
        2,
      );
    }
    case "search_cmd_history": {
      const q = typeof args.query === "string" ? args.query : "";
      const limit = asNum(args.limit) ?? 40;
      const rows = await searchCmdHistory(q, limit);
      return JSON.stringify(
        {
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
    case "port_snapshot": {
      const resolved = await resolveTabForExecution(args);
      if (!resolved?.tab.sessionId) {
        return JSON.stringify({
          ok: false,
          error: formatResolveError(args, "No active session"),
        });
      }
      const { tab } = resolved;
      const sid = tab.sessionId!;
      const env = resolveProbeEnv(
        tab?.kind ?? "local",
        tab?.shellId,
        getHostOs(),
      );
      const out = await api.sessionExec(sid, portsCmd(env, tab?.shellId));
      return stripAnsi(out.slice(0, 16_000));
    }
    case "disk_snapshot": {
      const resolved = await resolveTabForExecution(args);
      if (!resolved?.tab.sessionId) {
        return JSON.stringify({
          ok: false,
          error: formatResolveError(args, "No active session"),
        });
      }
      const { tab } = resolved;
      const sid = tab.sessionId!;
      const env = resolveProbeEnv(
        tab?.kind ?? "local",
        tab?.shellId,
        getHostOs(),
      );
      const out = await api.sessionExec(
        sid,
        diskSnapshotCmd(env, tab?.shellId),
      );
      return stripAnsi(out.slice(0, 16_000));
    }
    default:
      return null;
  }
}
