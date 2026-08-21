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
import { DialogHost } from "@/lib/dialogs";
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
    if (e.ctrlKey && e.shiftKey && (key === "i" || key === "j")) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "u") {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);

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
