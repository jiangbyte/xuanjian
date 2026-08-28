/**
 * @file 终端空闲等待（p-wait-for + shell 领域谓词）
 * @author Charlie
 */

import pWaitFor from "p-wait-for";
import { stripAnsi } from "@/lib/agent/ansi";
import { getTranscriptTail } from "@/lib/session/recorder";
import {
  ERROR_TAIL_RE,
  isShellPrompt,
  likelyTerminalFinished,
  normalizeTerminalChunk,
  progressDigest,
} from "@/lib/agent/tools/terminalIdlePredicates";

export type TerminalIdleFinishReason =
  | "no_wait"
  | "prompt"
  | "error_settled"
  | "quiet_settled"
  | "deadline";

export type TerminalIdleWaitResult = {
  output: string;
  waited_ms: number;
  likely_finished: boolean;
  still_running: boolean;
  finish_reason: TerminalIdleFinishReason;
  progress_digest: string;
  suggested_next_wait_ms: number;
};

export {
  isShellPrompt,
  likelyTerminalFinished,
  normalizeTerminalChunk,
  progressDigest,
} from "@/lib/agent/tools/terminalIdlePredicates";

function suggestedNextWaitMs(
  waitMs: number,
  finish: TerminalIdleFinishReason,
  stillRunning: boolean,
): number {
  if (!stillRunning) return 0;
  if (finish === "quiet_settled" || finish === "deadline") {
    return Math.min(120_000, Math.max(5_000, waitMs * 2));
  }
  return Math.min(60_000, Math.max(3_000, waitMs));
}

function pollIntervalForWait(waitMs: number): number {
  return Math.min(1500, Math.max(200, Math.floor(waitMs / 40) || 200));
}

/**
 * 等到 prompt / 错误静默 / 输出静默，或 waitMs 截止。
 * 轮询调度由 p-wait-for 负责。
 */
export async function waitForTerminalIdle(opts: {
  sessionId: string;
  maxChars?: number;
  waitMs: number;
  quietMs?: number;
  errorSettleMs?: number;
  signal?: AbortSignal;
}): Promise<TerminalIdleWaitResult> {
  const maxChars = opts.maxChars ?? 12_000;
  const waitMs = Math.max(0, opts.waitMs);
  const quietMs = opts.quietMs ?? 1500;
  const errorSettleMs = opts.errorSettleMs ?? 800;

  const snapshot = async () =>
    stripAnsi(await getTranscriptTail(opts.sessionId, maxChars));

  if (waitMs <= 0) {
    const output = await snapshot();
    const finished = likelyTerminalFinished(output);
    return {
      output,
      waited_ms: 0,
      likely_finished: finished,
      still_running: !finished,
      finish_reason: "no_wait",
      progress_digest: progressDigest(output),
      suggested_next_wait_ms: suggestedNextWaitMs(0, "no_wait", !finished),
    };
  }

  const started = Date.now();
  let lastNorm = "";
  let quietSince = Date.now();
  let errorSince: number | null = null;
  let lastRaw = "";
  const settle = {
    reason: "deadline" as TerminalIdleFinishReason,
  };

  const interval = pollIntervalForWait(waitMs);

  try {
    await pWaitFor(
      async () => {
        lastRaw = await snapshot();
        const norm = normalizeTerminalChunk(lastRaw);

        if (isShellPrompt(norm)) {
          settle.reason = "prompt";
          return true;
        }

        if (ERROR_TAIL_RE.test(norm.slice(-2000))) {
          if (errorSince == null) errorSince = Date.now();
          if (Date.now() - errorSince >= errorSettleMs) {
            settle.reason = "error_settled";
            return true;
          }
        } else {
          errorSince = null;
        }

        if (norm === lastNorm) {
          if (Date.now() - quietSince >= quietMs) {
            settle.reason = "quiet_settled";
            return true;
          }
        } else {
          lastNorm = norm;
          quietSince = Date.now();
        }

        return false;
      },
      {
        interval,
        timeout: {
          milliseconds: waitMs,
          fallback: () => {
            settle.reason = "deadline";
            return false;
          },
        },
        signal: opts.signal,
      },
    );
  } catch {
    settle.reason = "deadline";
  }

  if (!lastRaw) lastRaw = await snapshot();
  const reason = settle.reason;
  const likely = likelyTerminalFinished(lastRaw);
  const stillRunning =
    reason === "quiet_settled" || reason === "deadline" ? !likely : false;

  return {
    output: lastRaw,
    waited_ms: Date.now() - started,
    likely_finished:
      likely || reason === "prompt" || reason === "error_settled",
    still_running: stillRunning,
    finish_reason: reason,
    progress_digest: progressDigest(lastRaw),
    suggested_next_wait_ms: suggestedNextWaitMs(waitMs, reason, stillRunning),
  };
}
