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

ensureMonacoLocal();
