/**
 * @file Monaco 本地打包配置（完全离线）
 * @description 使用 npm 包内 monaco + Vite worker，禁止 @monaco-editor/react 默认走 jsDelivr CDN。
 * monaco-editor@0.56 的 exports 将 `./*` 映射到 `esm/vs/*`，worker 须用新路径导入。
 */

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker: (_: unknown, label: string) => Worker;
    };
  }
}

let configured = false;
let preloadPromise: Promise<void> | null = null;

/** 幂等：配置本地 monaco 与 workers，替代 CDN loader */
export function ensureMonacoLocal(): void {
  if (configured) return;
  configured = true;

  self.MonacoEnvironment = {
    getWorker(_: unknown, label: string) {
      if (label === "json") return new jsonWorker();
      if (label === "css" || label === "scss" || label === "less") {
        return new cssWorker();
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new htmlWorker();
      }
      if (label === "typescript" || label === "javascript") {
        return new tsWorker();
      }
      return new editorWorker();
    },
  };

  // 直接注入本地 monaco 实例；同时清空 CDN paths，防止任何回退请求外网
  loader.config({
    monaco,
    paths: { vs: "" },
  });
}

/** 预热隐藏实例，触发 worker 与渲染管线初始化 */
async function warmupMonacoInstance(
  monacoInstance: typeof monaco,
): Promise<void> {
  if (typeof document === "undefined") return;
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;left:-9999px";
  document.body.appendChild(host);
  try {
    const editor = monacoInstance.editor.create(host, {
      value: " ",
      language: "plaintext",
      automaticLayout: false,
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    editor.dispose();
  } finally {
    host.remove();
  }
}

/**
 * 应用启动时预加载 Monaco 与常用编辑器模块，避免首次打开文件编辑白屏等待。
 * 可重复调用，共享同一 Promise。
 */
export function preloadMonacoEditor(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  preloadPromise = (async () => {
    ensureMonacoLocal();
    const monacoInstance = await loader.init();
    await warmupMonacoInstance(monacoInstance);
    await import("@/features/terminal/FileEditorModal");
  })().catch((err) => {
    preloadPromise = null;
    console.error("[monaco] preload failed", err);
    throw err;
  });
  return preloadPromise;
}

ensureMonacoLocal();
