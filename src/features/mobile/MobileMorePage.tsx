/**
 * @file 移动端「更多」：设置入口与关于
 */

import { lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MobileTopBar } from "@/features/mobile/MobileTopBar";
import { useSettingsStore, type ThemeMode } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

const SettingsDialog = lazy(() =>
  import("@/features/settings/SettingsDialog").then((m) => ({
    default: m.SettingsDialog,
  })),
);

export function MobileMorePage() {
  const navigate = useNavigate();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  const themes: { id: ThemeMode; label: string }[] = [
    { id: "system", label: "跟随系统" },
    { id: "light", label: "浅色" },
    { id: "dark", label: "深色" },
  ];

  return (
    <div className="flex h-full flex-col">
      <MobileTopBar title="更多" />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <section className="rounded-xl border border-border bg-card p-3">
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">
            主题
          </h2>
          <div className="flex flex-wrap gap-2">
            {themes.map((t) => (
              <Button
                key={t.id}
                type="button"
                size="sm"
                variant={theme === t.id ? "default" : "outline"}
                onClick={() => setTheme(t.id)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-3">
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">
            设置
          </h2>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setSettingsOpen(true)}
          >
            打开完整设置
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            移动端不包含 AI / Agent。密钥与模型等可在此配置。
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-3 text-sm">
          <h2 className="mb-1 text-xs font-medium text-muted-foreground">
            关于
          </h2>
          <p>玄鉴移动伴侣 · 远程 SSH / 文件 / 笔记</p>
          <Button
            type="button"
            variant="link"
            className="h-auto px-0"
            onClick={() => navigate("/m")}
          >
            返回主机
          </Button>
        </section>
      </div>
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </Suspense>
      ) : null}
    </div>
  );
}
