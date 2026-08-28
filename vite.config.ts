/**
 * @file Vite 构建配置
 * @author Charlie
 * @description Tauri 桌面端前端构建入口配置：React + Tailwind，开发端口 1420，
 * 并配置 `@` 路径别名指向 `src/`。忽略对 `src-tauri` 的监听以免与 Cargo 冲突。
 * 生产构建拆分重型 vendor，缩短 WebView 首屏解析时间。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "@xuanjian/agent-core/graph",
        replacement: path.resolve(
          __dirname,
          "packages/agent-core/src/graph.ts",
        ),
      },
      {
        find: "@xuanjian/agent-core/inbox",
        replacement: path.resolve(
          __dirname,
          "packages/agent-core/src/inbox.ts",
        ),
      },
      {
        find: "@xuanjian/agent-core/plan",
        replacement: path.resolve(
          __dirname,
          "packages/agent-core/src/plan.ts",
        ),
      },
      {
        find: "@xuanjian/agent-core",
        replacement: path.resolve(
          __dirname,
          "packages/agent-core/src/index.ts",
        ),
      },
      {
        find: "@xuanjian/agent-adapters",
        replacement: path.resolve(
          __dirname,
          "packages/agent-adapters/src/index.ts",
        ),
      },
      {
        // WebView 构建：agent-loop-guard 依赖 node:crypto/util，替换为浏览器实现
        find: "agent-loop-guard",
        replacement: path.resolve(
          __dirname,
          "packages/agent-core/src/loop/browser-loop-guard/index.ts",
        ),
      },
      {
        // 精确匹配：避免把 `/web` 再写成 `/web/web`
        find: /^@langchain\/langgraph$/,
        replacement: "@langchain/langgraph/web",
      },
      {
        find: /^@\//,
        replacement: `${path.resolve(__dirname, "src")}/`,
      },
    ],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "esnext",
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("react-dom") ||
            id.includes("react-router") ||
            id.includes("/react/")
          ) {
            return "react-vendor";
          }
          if (id.includes("i18next") || id.includes("react-i18next")) {
            return "i18n";
          }
          if (id.includes("monaco-editor") || id.includes("@monaco-editor")) {
            return "monaco";
          }
          if (
            id.includes("@uiw/react-md") ||
            id.includes("@uiw/react-markdown")
          ) {
            return "markdown";
          }
          if (id.includes("recharts") || id.includes("d3-")) {
            return "recharts";
          }
          if (id.includes("@xyflow") || id.includes("@dagrejs")) {
            return "flow";
          }
          if (
            id.includes("echarts") ||
            id.includes("echarts-for-react")
          ) {
            return "echarts";
          }
          if (id.includes("@xterm")) {
            return "xterm";
          }
        },
      },
    },
  },
  worker: {
    format: "es" as const,
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-router-dom",
      "zustand",
      "i18next",
      "react-i18next",
      "monaco-editor",
      "@monaco-editor/react",
      "@xterm/xterm",
      "@xterm/addon-fit",
      "echarts",
      "echarts-for-react",
      "recharts",
      "@xyflow/react",
      "@uiw/react-md-editor",
    ],
  },
}));
