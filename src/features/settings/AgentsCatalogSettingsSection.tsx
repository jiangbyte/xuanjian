/**
 * @file 设置 · 智能体 Catalog（只读 toolBindings）
 * @author Charlie
 */

import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { listAgentCatalog } from "@/lib/agent/catalog";

export function AgentsCatalogSettingsSection() {
  const { t } = useTranslation();
  const agents = listAgentCatalog();

  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Bot size={14} />
        {t("settings.agentsCatalog")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t("settings.agentsCatalogHint")}
      </p>
      {agents.map((a) => (
        <div key={a.id} className="rounded-md border border-border p-3 text-xs">
          <div className="font-medium">{a.label}</div>
          <div className="text-muted-foreground">{a.description}</div>
          <div className="mt-2 text-[10px] text-muted-foreground">
            {t("settings.toolBindings", { count: a.toolBindings.length })}
          </div>
          <div className="mt-1 max-h-24 overflow-y-auto font-mono text-[10px] leading-relaxed text-muted-foreground">
            {a.toolBindings.join(", ")}
          </div>
        </div>
      ))}
    </section>
  );
}
