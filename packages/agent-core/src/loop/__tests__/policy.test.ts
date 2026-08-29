/**
 * @file LoopPolicy 环路软硬映射与进度豁免
 */

import { describe, expect, it } from "vitest";
import { LoopPolicy } from "../policy";

describe("LoopPolicy", () => {
  it("allows different commands without stopping", () => {
    const p = new LoopPolicy({ maxCalls: 20, softBeforeHard: 2 });
    expect(p.beforeTool("terminal_run", { command: "a" }).action).toBe("run");
    expect(p.afterTool("terminal_run", { command: "a" }, '{"ok":true,"progress_digest":"1"}').action).toBe(
      "continue",
    );
    expect(p.beforeTool("terminal_run", { command: "b" }).action).toBe("run");
    expect(p.isStopped()).toBe(false);
  });

  it("soft-blocks then hard-stops on repeated identical calls", () => {
    const p = new LoopPolicy({ maxCalls: 50, softBeforeHard: 2 });
    const args = { command: "same" };
    // agent-loop-guard repeatThreshold=3 → 第 3 次 beforeCall 才 block
    expect(p.beforeTool("terminal_run", args).action).toBe("run");
    p.afterTool("terminal_run", args, '{"ok":1,"progress_digest":"x"}');
    expect(p.beforeTool("terminal_run", args).action).toBe("run");
    p.afterTool("terminal_run", args, '{"ok":1,"progress_digest":"y"}');
    // 第 3 次 identical before → soft
    const soft = p.beforeTool("terminal_run", args);
    expect(soft.action).toBe("observe");
    if (soft.action === "observe") expect(soft.soft).toBe(true);
    expect(p.isStopped()).toBe(false);

    // 再一次 → hard（softBeforeHard=2）
    const hard = p.beforeTool("terminal_run", args);
    expect(hard.action).toBe("observe");
    if (hard.action === "observe") {
      expect(hard.soft).toBe(false);
      expect(hard.stopReason).toBe("loop_repeated");
    }
    expect(p.isStopped()).toBe(true);
  });

  it("stagnates when terminal_tail result fingerprint unchanged", () => {
    const p = new LoopPolicy({ maxCalls: 50, softBeforeHard: 2 });
    const args = { wait_ms: 1000 };
    const same = JSON.stringify({
      ok: true,
      progress_digest: "d1:10",
      finish_reason: "quiet_settled",
      still_running: true,
      output: "pulling...",
    });

    expect(p.beforeTool("terminal_tail", args).action).toBe("run");
    let after = p.afterTool("terminal_tail", args, same);
    expect(after.action).toBe("continue");

    expect(p.beforeTool("terminal_tail", args).action).toBe("run");
    after = p.afterTool("terminal_tail", args, same);
    // stagnationThreshold=2 → 第二次同 call+result 应 block
    expect(after.action === "observe" || after.action === "stop").toBe(true);
  });

  it("does not stagnate when progress_digest changes", () => {
    const p = new LoopPolicy({ maxCalls: 50, softBeforeHard: 2 });
    const args = { wait_ms: 5000 };
    expect(p.beforeTool("terminal_tail", args).action).toBe("run");
    expect(
      p.afterTool(
        "terminal_tail",
        args,
        JSON.stringify({ progress_digest: "a", output: "1%" }),
      ).action,
    ).toBe("continue");

    expect(p.beforeTool("terminal_tail", args).action).toBe("run");
    expect(
      p.afterTool(
        "terminal_tail",
        args,
        JSON.stringify({ progress_digest: "b", output: "50%" }),
      ).action,
    ).toBe("continue");

    expect(p.isStopped()).toBe(false);
  });

  it("hard-stops when tool budget exhausted", () => {
    const p = new LoopPolicy({ maxCalls: 2, softBeforeHard: 99 });
    expect(p.beforeTool("terminal_run", { command: "1" }).action).toBe("run");
    p.afterTool("terminal_run", { command: "1" }, "ok1");
    expect(p.beforeTool("terminal_run", { command: "2" }).action).toBe("run");
    p.afterTool("terminal_run", { command: "2" }, "ok2");
    const blocked = p.beforeTool("terminal_run", { command: "3" });
    expect(blocked.action).toBe("observe");
    if (blocked.action === "observe") {
      expect(blocked.soft).toBe(false);
      expect(blocked.stopReason).toBe("loop_budget");
    }
    expect(p.stopReason).toBe("loop_budget");
  });

  it("treats terminal_tail with different wait_ms as the same call for repeat detection", () => {
    const p = new LoopPolicy({ maxCalls: 50, softBeforeHard: 2 });
    const result = JSON.stringify({
      ok: true,
      progress_digest: "d1:10",
      finish_reason: "deadline",
      still_running: true,
      output: "sleeping",
    });

    expect(p.beforeTool("terminal_tail", { wait_ms: 25_000 }).action).toBe(
      "run",
    );
    p.afterTool("terminal_tail", { wait_ms: 25_000 }, result);

    expect(p.beforeTool("terminal_tail", { wait_ms: 50_000 }).action).toBe(
      "run",
    );
    p.afterTool("terminal_tail", { wait_ms: 50_000 }, result);

    // 第 3 次仅靠加大 wait_ms 仍算重复
    const soft = p.beforeTool("terminal_tail", { wait_ms: 90_000 });
    expect(soft.action).toBe("observe");
  });
});
