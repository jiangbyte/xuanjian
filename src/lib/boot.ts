/**
 * @file 应用启动：首帧绘制后再显示 Tauri 主窗口
 * @author Charlie
 */

import { isTauri } from "@tauri-apps/api/core";

/** 等待 React 首帧绘制后显示窗口，避免白屏闪烁 */
export function showMainWindowWhenReady() {
  if (!isTauri()) return;
  const show = () => {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().show(),
    );
  };
  requestAnimationFrame(() => requestAnimationFrame(show));
}

/** 空闲时执行非关键启动任务 */
export function runWhenIdle(task: () => void, timeoutMs = 2500) {
  if (typeof requestIdleCallback !== "undefined") {
    const id = requestIdleCallback(() => task(), { timeout: timeoutMs });
    return () => cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, 1);
  return () => clearTimeout(id);
}
