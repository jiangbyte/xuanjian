/**
 * @file 设置 · Agent 上下文压缩（本地 LangGraph）
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
import { getSetting, setSetting } from "@/lib/db";

/** Agent 压缩设置（本地运行时） */
export function AgentSettingsSection() {
  const { t } = useTranslation();
  const [autoCompact, setAutoCompact] = useState(true);
  const [compactThreshold, setCompactThreshold] = useState("0.8");

  useEffect(() => {
    void (async () => {
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
      <p className="text-xs text-muted-foreground">
        本地 LangGraph Agent。接近上下文上限时自动摘要早期 tool 结果。
      </p>
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
            await setSetting(
              "agent.auto_compact",
              autoCompact ? "true" : "false",
            );
            await setSetting(
              "agent.compact_threshold",
              compactThreshold.trim() || "0.8",
            );
            toast.success(t("settings.saved"));
          }}
        >
          {t("settings.saveProvider")}
        </Button>
      </div>
    </section>
  );
}
