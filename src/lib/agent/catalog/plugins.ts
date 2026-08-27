/**
 * @file Catalog — 插件层
 * @author Charlie
 */

import { listMcpServers, type McpServerRow } from "@/lib/db";

export type PluginKind = "builtin" | "mcp";

export type PluginMeta = {
  id: string;
  kind: PluginKind;
  name: string;
  description: string;
  readOnly: boolean;
  mcpServerId?: number;
};

export const BUILTIN_PLUGIN: PluginMeta = {
  id: "xuanjian-local",
  kind: "builtin",
  name: "xuanjian-local",
  description: "本地终端 / 主机 / 脚本 / SubAgent 编排",
  readOnly: true,
};

export async function listPlugins(): Promise<PluginMeta[]> {
  const mcpRows = await listMcpServers();
  const mcpPlugins: PluginMeta[] = mcpRows.map((r) => mcpRowToPlugin(r));
  return [BUILTIN_PLUGIN, ...mcpPlugins];
}

export function mcpRowToPlugin(row: McpServerRow): PluginMeta {
  return {
    id: `mcp:${row.id}`,
    kind: "mcp",
    name: row.name,
    description: `${row.transport} · ${row.scope}`,
    readOnly: false,
    mcpServerId: row.id,
  };
}
