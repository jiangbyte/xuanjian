/**
 * @file hook 瀑布测试
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  clearAllHooks,
  runPreExecuteHooks,
  useHook,
} from "@/lib/agent/hooks/registry";

describe("hooks registry", () => {
  beforeEach(() => clearAllHooks());

  it("runs pre-execute deny", async () => {
    useHook("tools/pre-execute", async (_ctx, _next) => {
      return { kind: "deny", result: "blocked" };
    });
    const decision = await runPreExecuteHooks({
      name: "test",
      args: {},
      execCtx: { permissionMode: "full" },
    });
    expect(decision).toEqual({ kind: "deny", result: "blocked" });
  });

  it("falls through to allow", async () => {
    useHook("tools/pre-execute", async (_ctx, next) => next());
    const decision = await runPreExecuteHooks({
      name: "test",
      args: {},
      execCtx: { permissionMode: "full" },
    });
    expect(decision).toEqual({ kind: "allow" });
  });
});
