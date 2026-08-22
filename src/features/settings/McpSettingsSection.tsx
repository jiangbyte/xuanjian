/**
 * @file 设置 · MCP 服务器
 * @author Charlie
 * @description 内置本地工具一览 + 远程 MCP 条目的增删。
 */

import { Cable, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BUILTIN_MCP_SERVER } from "@/lib/agent/mcpBuiltin";
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  type McpServerRow,
} from "@/lib/db";

/** MCP 设置区块 */
export function McpSettingsSection() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<McpServerRow[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const reload = () => listMcpServers().then(setRows).catch(console.error);
  useEffect(() => {
    reload();
  }, []);

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Cable size={14} />
        {t("settings.mcp")}
      </h3>
      <p className="text-xs text-muted-foreground">{t("settings.mcpHint")}</p>
      <div className="rounded-md border border-border p-2 text-xs">
        <div className="font-medium">{BUILTIN_MCP_SERVER.name}</div>
        <div className="text-muted-foreground">
          {BUILTIN_MCP_SERVER.description}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          tools: {BUILTIN_MCP_SERVER.tools.join(", ")}
        </div>
      </div>
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-xs"
        >
          <div>
            <div className="font-medium">{r.name}</div>
            <div className="text-muted-foreground">
              {r.transport} · {r.url || r.command || "—"}
            </div>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={async () => {
              await deleteMcpServer(r.id);
              reload();
            }}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <div className="flex gap-1">
        <Input
          className="h-8"
          placeholder={t("settings.mcpName")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Input
          className="h-8"
          placeholder="https://…/mcp"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
        />
        <Button
          type="button"
          size="sm"
          onClick={async () => {
            if (!name.trim() || !url.trim()) return;
            await createMcpServer({
              name: name.trim(),
              transport: "http",
              url: url.trim(),
              scope: "remote",
            });
            setName("");
            setUrl("");
            reload();
          }}
        >
          {t("settings.addMcp")}
        </Button>
      </div>
    </section>
  );
}
