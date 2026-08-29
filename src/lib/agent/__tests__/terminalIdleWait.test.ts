/**
 * @file terminalIdleWait / predicates 测试
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isShellPrompt,
  normalizeTerminalChunk,
  progressDigest,
  likelyTerminalFinished,
} from "@/lib/agent/tools/terminalIdlePredicates";
import {
  QUIET_EARLY_EXIT_WAIT_CAP_MS,
  resolveEffectiveQuietMs,
  waitForTerminalIdle,
} from "@/lib/agent/tools/terminalIdleWait";

vi.mock("@/lib/session/recorder", () => ({
  getTranscriptTail: vi.fn(),
}));

import { getTranscriptTail } from "@/lib/session/recorder";

const mockedTail = vi.mocked(getTranscriptTail);

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

describe("resolveEffectiveQuietMs", () => {
  it("keeps quiet for short waits", () => {
    expect(resolveEffectiveQuietMs(2000, 1500)).toBe(1500);
    expect(resolveEffectiveQuietMs(1000, 1500)).toBe(1000);
  });

  it("raises quiet to full wait window for long waits", () => {
    expect(QUIET_EARLY_EXIT_WAIT_CAP_MS).toBe(5_000);
    expect(resolveEffectiveQuietMs(25_000, 1500)).toBe(25_000);
    expect(resolveEffectiveQuietMs(120_000, 2000)).toBe(120_000);
  });
});

describe("waitForTerminalIdle", () => {
  afterEach(() => {
    vi.useRealTimers();
    mockedTail.mockReset();
  });

  it("returns early on shell prompt", async () => {
    mockedTail.mockResolvedValue("done\nuser@host:~$ ");
    const r = await waitForTerminalIdle({
      sessionId: "s1",
      waitMs: 10_000,
      quietMs: 1500,
    });
    expect(r.finish_reason).toBe("prompt");
    expect(r.still_running).toBe(false);
    expect(r.waited_ms).toBeLessThan(2000);
  });

  it("does not quiet-settle early on frozen output when wait_ms is long", async () => {
    vi.useFakeTimers();
    mockedTail.mockResolvedValue("sleeping… no prompt yet\n");
    const p = waitForTerminalIdle({
      sessionId: "s1",
      waitMs: 5_000,
      quietMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1_500);
    // 若仍被旧逻辑 500ms quiet 提前返回，promise 已 settle
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(4_000);
    const r = await p;
    expect(r.finish_reason).toBe("deadline");
    expect(r.still_running).toBe(true);
    expect(r.requested_wait_ms).toBe(5_000);
    expect(r.effective_quiet_ms).toBe(5_000);
    expect(r.waited_ms).toBeGreaterThanOrEqual(4_500);
  });

  it("allows quiet settle on short waits", async () => {
    vi.useFakeTimers();
    mockedTail.mockResolvedValue("quick output without prompt\n");
    const p = waitForTerminalIdle({
      sessionId: "s1",
      waitMs: 2_000,
      quietMs: 400,
    });
    await vi.advanceTimersByTimeAsync(800);
    const r = await p;
    expect(r.finish_reason).toBe("quiet_settled");
    expect(r.waited_ms).toBeLessThan(2_000);
  });
});
