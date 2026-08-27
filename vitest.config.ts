import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/__tests__/**/*.test.ts",
      "packages/*/src/**/__tests__/**/*.test.ts",
    ],
  },
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
        find: /^@langchain\/langgraph$/,
        replacement: "@langchain/langgraph/web",
      },
      {
        find: /^@\//,
        replacement: `${path.resolve(__dirname, "./src")}/`,
      },
    ],
  },
});
