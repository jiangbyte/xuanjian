/**
 * @file terminalIdlePredicates
 */

import { describe, expect, it } from "vitest";
import {
  isShellPrompt,
  normalizeTerminalChunk,
  progressDigest,
  likelyTerminalFinished,
} from "@/lib/agent/tools/terminalIdlePredicates";

describe("terminalIdlePredicates", () => {
  it("normalizes CR progress bars", () => {
    expect(normalizeTerminalChunk("a\rbb\nccc\rdddd")).toBe("bb\ndddd");
  });

  it("detects shell prompt", () => {
    expect(isShellPrompt("hello\nuser@host:~$ ")).toBe(true);
    expect(isShellPrompt("still pulling layers")).toBe(false);
  });

  it("progressDigest changes with output", () => {
    const a = progressDigest("line1\n");
    const b = progressDigest("line1\nline2\n");
    expect(a).not.toBe(b);
  });

  it("likely finished on prompt", () => {
    expect(likelyTerminalFinished("done\n$ ")).toBe(true);
  });
});
