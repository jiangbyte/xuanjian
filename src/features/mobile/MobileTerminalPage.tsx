/**
 * @file 移动端单屏 SSH 终端
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MobileTopBar } from "@/features/mobile/MobileTopBar";
import { XtermView } from "@/features/terminal/XtermView";
import { useUiStore } from "@/stores/ui";

export function MobileTerminalPage() {
  const navigate = useNavigate();
  const tabs = useUiStore((s) => s.tabs);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const closeTab = useUiStore((s) => s.closeTab);

  const sshTabs = useMemo(
    () => tabs.filter((t) => t.kind === "ssh"),
    [tabs],
  );
  const active =
    sshTabs.find((t) => t.id === activeTabId) ??
    sshTabs[sshTabs.length - 1] ??
    null;

  return (
    <div className="flex h-full flex-col bg-black">
      <MobileTopBar
        title={active?.title || "终端"}
        right={
          active ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-destructive"
              onClick={() => closeTab(active.id)}
            >
              断开
            </Button>
          ) : null
        }
      />
      {sshTabs.length > 1 ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/40 bg-zinc-950 px-2 py-1">
          {sshTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`shrink-0 rounded-md px-2 py-1 text-xs ${
                t.id === active?.id
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400"
              }`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.title}
            </button>
          ))}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {!active ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-zinc-400">尚未连接主机</p>
            <Button type="button" size="sm" onClick={() => navigate("/m")}>
              去主机列表
            </Button>
          </div>
        ) : (
          sshTabs.map((tab) => (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{
                visibility: tab.id === active.id ? "visible" : "hidden",
                pointerEvents: tab.id === active.id ? "auto" : "none",
              }}
            >
              <XtermView tab={tab} active={tab.id === active.id} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
