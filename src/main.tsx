/**
 * @file 前端入口
 * @author Charlie
 * @description 挂载 React 根；shadcn TooltipProvider + Toaster + 对话框/右键菜单。
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { ContextMenuProvider } from "@/components/ContextMenu";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { shouldUseMobileUi } from "@/lib/platform/mobile";
import { DialogHost } from "@/lib/ui/dialogs";
import "@/stores/settings";
import "@/i18n";
import "@/styles/index.css";

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

/** 仅拦截开发者工具快捷键 —— 不要拦截 Ctrl+Shift+C（终端复制）。 */
document.addEventListener(
  "keydown",
  (e) => {
    const key = e.key.toLowerCase();
    if (e.key === "F12") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.shiftKey &&
      (key === "i" || key === "j")
    ) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "u") {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);

// 移动端不注册 Agent 工具钩子（无 AI）
if (!shouldUseMobileUi()) {
  void import("@/lib/agent/hooks/defaultTools").then((m) =>
    m.registerDefaultToolHooks(),
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <ContextMenuProvider>
        <App />
        <DialogHost />
        <Toaster />
      </ContextMenuProvider>
    </TooltipProvider>
  </React.StrictMode>,
);
