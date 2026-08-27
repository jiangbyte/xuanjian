/**
 * @file 设置 · MCP 服务器
 * @author Charlie
 */

import {
  Cable,
  Globe,
  Loader2,
  PlugZap,
  Plus,
  Terminal,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BUILTIN_PLUGIN } from "@/lib/agent/catalog";
import { testMcpConnection, refreshMcpTools } from "@/lib/agent/mcp/client";
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  listMcpToolPrefs,
  setMcpToolPref,
  updateMcpServer,
  type McpServerRow,
} from "@/lib/db";
import { cn } from "@/lib/utils";

type AddMode = "http" | "stdio";

/** MCP 设置区块 */
export function McpSettingsSection() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<McpServerRow[]>([]);
  const [addMode, setAddMode] = useState<AddMode>("http");
  const [httpName, setHttpName] = useState("");
  const [httpUrl, setHttpUrl] = useState("");
  const [stdioName, setStdioName] = useState("");
  const [stdioCommand, setStdioCommand] = useState("");
  const [adding, setAdding] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [discovered, setDiscovered] = useState<Record<number, string[]>>({});
  const [toolPrefs, setToolPrefs] = useState<Record<string, boolean>>({});

  const reload = async () => {
    const [servers, prefs] = await Promise.all([
      listMcpServers(),
      listMcpToolPrefs(),
    ]);
    setRows(servers);
    const pm: Record<string, boolean> = {};
    for (const p of prefs) {
      pm[`${p.mcp_server_id}:${p.tool_name}`] = Boolean(p.enabled);
    }
    setToolPrefs(pm);
  };

  useEffect(() => {
    reload().catch(console.error);
  }, [reload]);

  const runTest = async (row: McpServerRow) => {
    setTestingId(row.id);
    try {
      const result = await testMcpConnection(row);
      if (result.ok) {
        setDiscovered((d) => ({ ...d, [row.id]: result.tools }));
        toast.success(t("settings.mcpTestOk", { count: result.tools.length }));
        await refreshMcpTools();
      } else {
        toast.error(result.error ?? t("settings.mcpTestFail"));
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTestingId(null);
    }
  };

  const toggleServer = async (row: McpServerRow) => {
    await updateMcpServer(row.id, { enabled: !row.enabled });
    await reload();
    await refreshMcpTools();
  };

  const addHttp = async () => {
    const name = httpName.trim();
    const url = httpUrl.trim();
    if (!name || !url) {
      toast.error(t("settings.mcpFormIncomplete"));
      return;
    }
    setAdding(true);
    try {
      await createMcpServer({
        name,
        transport: "http",
        url,
        scope: "remote",
      });
      setHttpName("");
      setHttpUrl("");
      toast.success(t("settings.mcpAdded"));
      await reload();
      await refreshMcpTools();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAdding(false);
    }
  };

  const addStdio = async () => {
    const name = stdioName.trim();
    const command = stdioCommand.trim();
    if (!name || !command) {
      toast.error(t("settings.mcpFormIncomplete"));
      return;
    }
    setAdding(true);
    try {
      await createMcpServer({
        name,
        transport: "stdio",
        command,
        scope: "local",
      });
      setStdioName("");
      setStdioCommand("");
      toast.success(t("settings.mcpAdded"));
      await reload();
      await refreshMcpTools();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Cable size={14} />
          {t("settings.mcp")}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.mcpHint")}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/15 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{BUILTIN_PLUGIN.name}</span>
              <Badge variant="secondary">{t("settings.mcpBuiltin")}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {BUILTIN_PLUGIN.description}
            </p>
          </div>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            {t("settings.mcpCustomList")}
          </div>
          {rows.map((r) => (
            <div
              key={r.id}
              className="space-y-2 rounded-lg border border-border px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {r.transport === "http" ? "HTTP" : "stdio"}
                    </Badge>
                    {!r.enabled && (
                      <Badge variant="secondary">
                        {t("settings.mcpDisabled")}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {r.url || r.command || "—"}
                  </div>
                </div>
                <Switch
                  checked={Boolean(r.enabled)}
                  onCheckedChange={() => void toggleServer(r)}
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  title={t("settings.mcpTest")}
                  disabled={testingId === r.id}
                  onClick={() => void runTest(r)}
                >
                  {testingId === r.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <PlugZap size={12} />
                  )}
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title={t("dialog.delete")}
                  onClick={async () => {
                    await deleteMcpServer(r.id);
                    await reload();
                    await refreshMcpTools();
                  }}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
              {(discovered[r.id] ?? []).length > 0 && (
                <div className="space-y-1 border-t border-border/60 pt-2">
                  <div className="text-[10px] font-medium text-muted-foreground">
                    {t("settings.mcpDiscoveredTools")}
                  </div>
                  {(discovered[r.id] ?? []).map((toolName) => {
                    const key = `${r.id}:${toolName}`;
                    const enabled = toolPrefs[key] !== false;
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-2 pl-1"
                      >
                        <span className="truncate font-mono text-[10px]">
                          {toolName}
                        </span>
                        <Switch
                          checked={enabled}
                          onCheckedChange={async (v) => {
                            await setMcpToolPref(r.id, toolName, v);
                            await reload();
                            await refreshMcpTools();
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("settings.mcpNoServers")}
        </p>
      )}

      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div className="text-sm font-medium">{t("settings.mcpAddServer")}</div>

        <div className="inline-flex h-8 overflow-hidden rounded-md border border-input">
          {(
            [
              {
                id: "http" as const,
                label: t("settings.mcpTransportHttp"),
                icon: Globe,
              },
              {
                id: "stdio" as const,
                label: t("settings.mcpTransportStdio"),
                icon: Terminal,
              },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={cn(
                "inline-flex h-full items-center gap-1.5 px-3 text-xs transition-colors",
                addMode === id
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setAddMode(id)}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {addMode === "http" ? (
          <div className="space-y-2.5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.mcpHttpHint")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">{t("settings.mcpName")}</Label>
                <Input
                  className="h-8"
                  placeholder="my-remote-mcp"
                  value={httpName}
                  onChange={(e) => setHttpName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("settings.mcpUrl")}</Label>
                <Input
                  className="h-8 font-mono text-xs"
                  placeholder="https://example.com/mcp"
                  value={httpUrl}
                  onChange={(e) => setHttpUrl(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                className="h-8"
                disabled={adding}
                onClick={() => void addHttp()}
              >
                <Plus size={14} className="mr-1" />
                {t("settings.addMcpHttp")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.mcpStdioHint")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">{t("settings.mcpName")}</Label>
                <Input
                  className="h-8"
                  placeholder="local-filesystem"
                  value={stdioName}
                  onChange={(e) => setStdioName(e.target.value)}
                />
              </div>
              <div className="space-y-1 sm:col-span-1">
                <Label className="text-xs">{t("settings.mcpCommand")}</Label>
                <Input
                  className="h-8 font-mono text-xs"
                  placeholder="npx -y @modelcontextprotocol/server-filesystem /path"
                  value={stdioCommand}
                  onChange={(e) => setStdioCommand(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                disabled={adding}
                onClick={() => void addStdio()}
              >
                <Plus size={14} className="mr-1" />
                {t("settings.addMcpStdio")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
