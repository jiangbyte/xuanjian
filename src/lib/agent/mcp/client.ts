/**
 * @file MCP 客户端：HTTP / stdio 连接与工具发现
 * @author Charlie
 */

import type { AgentToolDef } from "@/lib/agent/tools/types";
import { listMcpServers, listMcpToolPrefs, type McpServerRow } from "@/lib/db";
import { api } from "@/lib/tauri";

export type McpTestResult = {
  ok: boolean;
  tools: string[];
  error?: string;
};

type McpRoute = {
  serverId: number;
  serverName: string;
  toolName: string;
  transport: McpServerRow["transport"];
  command: string | null;
  args: string[];
  url: string | null;
};

const MCP_PREFIX = "mcp__";

let cachedTools: AgentToolDef[] = [];
const routeByFullName = new Map<string, McpRoute>();

function parseArgsJson(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function mcpToolName(serverName: string, toolName: string): string {
  const safeServer = serverName.replace(/[^a-zA-Z0-9_]+/g, "_");
  return `${MCP_PREFIX}${safeServer}__${toolName}`;
}

function parseMcpToolName(
  full: string,
): { serverKey: string; toolName: string } | null {
  if (!full.startsWith(MCP_PREFIX)) return null;
  const rest = full.slice(MCP_PREFIX.length);
  const idx = rest.indexOf("__");
  if (idx <= 0) return null;
  return { serverKey: rest.slice(0, idx), toolName: rest.slice(idx + 2) };
}

async function jsonRpcHttp(
  url: string,
  method: string,
  params?: unknown,
  id = Date.now(),
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (ct.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const msg = JSON.parse(payload) as {
        error?: { message?: string };
        result?: unknown;
      };
      if (msg.error) throw new Error(msg.error.message ?? String(msg.error));
      return msg.result;
    }
    throw new Error("empty SSE response");
  }
  const msg = JSON.parse(text) as {
    error?: { message?: string };
    result?: unknown;
  };
  if (msg.error) throw new Error(msg.error.message ?? String(msg.error));
  return msg.result;
}

async function discoverHttpTools(server: McpServerRow): Promise<McpToolDto[]> {
  const url = server.url?.trim();
  if (!url) throw new Error("missing MCP URL");
  await jsonRpcHttp(url, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "xuanjian", version: "1.0.0" },
  });
  const result = (await jsonRpcHttp(url, "tools/list", {})) as {
    tools?: McpToolDto[];
  };
  return result?.tools ?? [];
}

type McpToolDto = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  input_schema?: Record<string, unknown>;
};

async function discoverStdioTools(server: McpServerRow): Promise<McpToolDto[]> {
  const command = server.command?.trim();
  if (!command) throw new Error("missing MCP command");
  const result = await api.mcpStdioDiscover(
    command,
    parseArgsJson(server.args_json),
  );
  if (!result.ok) throw new Error(result.error ?? "stdio discover failed");
  return result.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema as Record<string, unknown>,
  }));
}

function toAgentTool(server: McpServerRow, tool: McpToolDto): AgentToolDef {
  const schema =
    tool.inputSchema ??
    tool.input_schema ??
    ({ type: "object", properties: {} } as Record<string, unknown>);
  return {
    type: "function",
    function: {
      name: mcpToolName(server.name, tool.name),
      description: `[MCP:${server.name}] ${tool.description ?? tool.name}`,
      parameters: schema,
    },
  };
}

function registerRoute(server: McpServerRow, tool: McpToolDto) {
  const full = mcpToolName(server.name, tool.name);
  routeByFullName.set(full, {
    serverId: server.id,
    serverName: server.name,
    toolName: tool.name,
    transport: server.transport,
    command: server.command,
    args: parseArgsJson(server.args_json),
    url: server.url,
  });
}

/** 测试单个 MCP 服务器连接并返回工具名列表 */
export async function testMcpConnection(
  server: McpServerRow,
): Promise<McpTestResult> {
  try {
    const tools =
      server.transport === "stdio"
        ? await discoverStdioTools(server)
        : await discoverHttpTools(server);
    return { ok: true, tools: tools.map((t) => t.name) };
  } catch (e) {
    return { ok: false, tools: [], error: String(e) };
  }
}

/** 从 mcp_servers 表发现全部已启用 MCP 工具并缓存（尊重 mcp_tool_prefs） */
export async function refreshMcpTools(): Promise<AgentToolDef[]> {
  routeByFullName.clear();
  const servers = (await listMcpServers()).filter((s) => s.enabled);
  const prefs = await listMcpToolPrefs();
  const prefMap = new Map<string, boolean>();
  for (const p of prefs) {
    prefMap.set(`${p.mcp_server_id}:${p.tool_name}`, Boolean(p.enabled));
  }
  const tools: AgentToolDef[] = [];
  for (const server of servers) {
    try {
      const discovered =
        server.transport === "stdio"
          ? await discoverStdioTools(server)
          : await discoverHttpTools(server);
      for (const tool of discovered) {
        const prefKey = `${server.id}:${tool.name}`;
        const pref = prefMap.get(prefKey);
        if (pref === false) continue;
        const def = toAgentTool(server, tool);
        tools.push(def);
        registerRoute(server, tool);
      }
    } catch (e) {
      console.warn(`MCP ${server.name}:`, e);
    }
  }
  cachedTools = tools;
  return tools;
}

/** 已缓存的 MCP 工具定义 */
export function getCachedMcpTools(): AgentToolDef[] {
  return cachedTools;
}

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_PREFIX);
}

/** 调用 MCP 工具（HTTP 或 stdio） */
export async function callMcpTool(
  fullName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const route = routeByFullName.get(fullName);
  if (!route) {
    const parsed = parseMcpToolName(fullName);
    if (!parsed) {
      return JSON.stringify({ ok: false, error: "unknown MCP tool" });
    }
    await refreshMcpTools();
    return callMcpTool(fullName, args);
  }

  try {
    if (route.transport === "stdio") {
      const command = route.command?.trim();
      if (!command) throw new Error("missing MCP command");
      const result = await api.mcpStdioCall(
        command,
        route.args,
        route.toolName,
        args,
      );
      if (!result.ok) throw new Error(result.error ?? "MCP call failed");
      return JSON.stringify({ ok: true, content: result.content });
    }
    const url = route.url?.trim();
    if (!url) throw new Error("missing MCP URL");
    await jsonRpcHttp(url, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "xuanjian", version: "1.0.0" },
    });
    const result = await jsonRpcHttp(url, "tools/call", {
      name: route.toolName,
      arguments: args,
    });
    const content = (result as { content?: unknown })?.content;
    return JSON.stringify({ ok: true, content });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) });
  }
}
