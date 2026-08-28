/**
 * @file 计划拆分与限额测试
 */

import { describe, expect, it } from "vitest";
import {
  buildPlanExecutePrompt,
  splitPlanFromReply,
  AGENT_LIMITS,
} from "../index";

describe("splitPlanFromReply", () => {
  it("ignores diagnostic bullets when no actionable steps", () => {
    const text = `建议：当前无需任何磁盘清理动作。

1. **磁盘非常健康**：根分区仅 5% 用量
2. **无大文件堆积**：/data 为空`;
    expect(splitPlanFromReply(text).planItems).toBeNull();
  });

  it("extracts actionable ## 执行计划 items", () => {
    const text = `结论：空间充足。

## 执行计划
1. 在目标主机执行 \`sudo apt clean\` 清理 apt 缓存
2. 使用 sync_to_remote 将产物同步到远程`;
    const { planItems } = splitPlanFromReply(text);
    expect(planItems).toEqual([
      "在目标主机执行 `sudo apt clean` 清理 apt 缓存",
      "使用 sync_to_remote 将产物同步到远程",
    ]);
  });
});

describe("buildPlanExecutePrompt", () => {
  it("includes confirm mode handoff", () => {
    const p = buildPlanExecutePrompt(["执行 apt clean"]);
    expect(p).toContain("确认执行模式");
    expect(p).toContain("apt clean");
  });
});

describe("AGENT_LIMITS", () => {
  it("exposes orch limits", () => {
    expect(AGENT_LIMITS.ORCH_MAX_ROUNDS).toBeGreaterThan(10);
    expect(AGENT_LIMITS.LLM_TIMEOUT_MS).toBeGreaterThan(0);
    expect(AGENT_LIMITS.ORCH_MAX_TOOL_CALLS).toBeGreaterThan(10);
  });
});
