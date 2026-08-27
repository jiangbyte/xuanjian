/**
 * @file 设置 · 远程 Agent / 后端 + 上下文压缩
 * @author Charlie
 */

import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingField } from "@/features/settings/SettingField";
import { discoverRemoteAgents } from "@/lib/agent/remoteClient";
import { getSetting, setSetting, upsertRemoteAgent } from "@/lib/db";

/** Agent 后端连接与压缩设置 */
export function AgentSettingsSection() {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [autoCompact, setAutoCompact] = useState(true);
  const [compactThreshold, setCompactThreshold] = useState("0.8");

  useEffect(() => {
    void (async () => {
      setBaseUrl((await getSetting("backend.base_url")) ?? "");
      setToken((await getSetting("backend.token")) ?? "");
      setAutoCompact((await getSetting("agent.auto_compact")) !== "false");
      setCompactThreshold(
        (await getSetting("agent.compact_threshold")) ?? "0.8",
      );
    })();
  }, []);

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Bot size={14} />
        {t("settings.agent")}
      </h3>
      <p className="text-xs text-muted-foreground">{t("settings.agentHint")}</p>
      <SettingField label={t("settings.backendUrl")}>
        <Input
          value={baseUrl}
          placeholder="http://127.0.0.1:8080"
          onChange={(e) => setBaseUrl(e.currentTarget.value)}
        />
      </SettingField>
      <SettingField label={t("settings.backendToken")}>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
        />
      </SettingField>
      <SettingField label="自动上下文压缩">
        <div className="flex items-center gap-2">
          <Switch checked={autoCompact} onCheckedChange={setAutoCompact} />
          <span className="text-xs text-muted-foreground">
            接近上下文上限时自动摘要早期 tool 结果
          </span>
        </div>
      </SettingField>
      <SettingField label="压缩阈值（0–1）">
        <Input
          value={compactThreshold}
          placeholder="0.8"
          onChange={(e) => setCompactThreshold(e.currentTarget.value)}
        />
      </SettingField>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={async () => {
            await setSetting("backend.base_url", baseUrl.trim());
            await setSetting("backend.token", token.trim());
            await setSetting("agent.auto_compact", autoCompact ? "true" : "false");
            await setSetting(
              "agent.compact_threshold",
              compactThreshold.trim() || "0.8",
            );
            toast.success(t("settings.saved"));
          }}
        >
          {t("settings.saveProvider")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              const list = await discoverRemoteAgents();
              for (const a of list) {
                await upsertRemoteAgent({
                  id: a.id,
                  name: a.name,
                  description: a.description,
                  endpoint: baseUrl,
                });
              }
              toast.success(
                t("settings.remoteAgentsFound", { count: list.length }),
              );
            } catch (e) {
              toast.error(String(e));
            }
          }}
        >
          {t("settings.discoverAgents")}
        </Button>
      </div>
    </section>
  );
}
