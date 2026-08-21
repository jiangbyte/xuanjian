/**
 * @file 前端入口
 * @author Charlie
 * @description 挂载 React 根节点，注入对话框与右键菜单 Provider。
 * 屏蔽浏览器默认右键与部分开发者工具快捷键（不拦截终端复制用的 Ctrl+Shift+C）。
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { ContextMenuProvider } from "@/components/ContextMenu";
import { DialogProvider } from "@/components/Dialog";
import "@/i18n";
import "@/styles/index.css";

// —— 全局交互拦截 ——
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
    // 审查元素 / 控制台 —— 不含 Ctrl+Shift+C（复制）或 Ctrl+Shift+V（粘贴）
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
    <DialogProvider>
      <ContextMenuProvider>
        <App />
      </ContextMenuProvider>
    </DialogProvider>
  </React.StrictMode>,
);
