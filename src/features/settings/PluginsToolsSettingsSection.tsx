/**
 * @file 设置 · 插件与内置工具（只读）
 * @author Charlie
 */

import { Puzzle } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  BUILTIN_PLUGIN,
  catalogBuiltinTools,
  domainLabel,
  type ToolDomain,
} from "@/lib/agent/catalog";

export function PluginsToolsSettingsSection() {
  const { t } = useTranslation();
  const byDomain = useMemo(() => {
    const map = new Map<ToolDomain, ReturnType<typeof catalogBuiltinTools>>();
    for (const tool of catalogBuiltinTools()) {
      const list = map.get(tool.domain) ?? [];
      list.push(tool);
      map.set(tool.domain, list);
    }
    return map;
  }, []);

  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Puzzle size={14} />
        {t("settings.pluginsTools")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t("settings.pluginsToolsHint")}
      </p>
      <div className="rounded-md border border-border p-3 text-xs">
        <div className="font-medium">{BUILTIN_PLUGIN.name}</div>
        <div className="text-muted-foreground">
          {BUILTIN_PLUGIN.description}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {t("settings.readOnlyPlugin")}
        </div>
      </div>
      {[...byDomain.entries()].map(([domain, tools]) => (
        <div key={domain}>
          <div className="mb-1 text-xs font-semibold">
            {domainLabel(domain)}
          </div>
          <ul className="space-y-0.5 text-[11px] text-muted-foreground">
            {tools.map((tool) => (
              <li key={tool.name}>
                <span className="font-mono text-foreground">{tool.name}</span>
                {tool.write ? " · write" : ""}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
