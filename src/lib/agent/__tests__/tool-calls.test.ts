/**
 * @file 并行工具调度测试
 */

import { describe, expect, it } from "vitest";
import { isConcurrencySafe } from "@/lib/agent/tools/concurrency";

describe("isConcurrencySafe", () => {
  it("marks read tools safe", () => {
    expect(isConcurrencySafe("ping")).toBe(true);
    expect(isConcurrencySafe("read_file")).toBe(true);
  });

  it("marks subagent safe", () => {
    expect(isConcurrencySafe("run_subagent")).toBe(true);
  });

  it("marks write tools unsafe", () => {
    expect(isConcurrencySafe("terminal_run")).toBe(false);
  });
});
