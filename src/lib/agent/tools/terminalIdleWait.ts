/**
 * @file 终端空闲等待（p-wait-for + shell 领域谓词）
 * @author Charlie
 * @description 长任务按「提示符 / 错误静默 / 截止」结束；短静默不得提前打断 wait_ms。
 * 对齐行业做法：单次阻塞等到完成或超时，避免 LLM 短间隔轮询浪费 token。
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
  requested_wait_ms: number;
  likely_finished: boolean;
  still_running: boolean;
  finish_reason: TerminalIdleFinishReason;
  progress_digest: string;
  suggested_next_wait_ms: number;
  /** 实际用于 quiet 判定的阈值（长等待会被抬到接近 waitMs） */
  effective_quiet_ms: number;
};

export {
  isShellPrompt,
  likelyTerminalFinished,
  normalizeTerminalChunk,
  progressDigest,
} from "@/lib/agent/tools/terminalIdlePredicates";

/** 短于此的 wait 仍允许「输出静默」提前结束；更长则等同等到 deadline/prompt */
export const QUIET_EARLY_EXIT_WAIT_CAP_MS = 5_000;

/**
 * 解析静默阈值：长 wait 时抬到 waitMs，避免 sleep/docker pull 等无输出期被 1.5s 假静默提前返回。
 */
export function resolveEffectiveQuietMs(waitMs: number, quietMs: number): number {
  const q = Math.max(0, quietMs);
  const w = Math.max(0, waitMs);
  if (w <= 0) return q;
  if (w < QUIET_EARLY_EXIT_WAIT_CAP_MS) return Math.min(q, w);
  return Math.max(q, w);
}

function suggestedNextWaitMs(
  waitMs: number,
  finish: TerminalIdleFinishReason,
  stillRunning: boolean,
): number {
  if (!stillRunning) return 0;
  if (finish === "quiet_settled" || finish === "deadline") {
    // 单次给足下一档，避免 25s→30s→45s 碎步轮询
    return Math.min(300_000, Math.max(30_000, waitMs * 2));
  }
  return Math.min(120_000, Math.max(10_000, waitMs));
}

function pollIntervalForWait(waitMs: number): number {
  // 长等待降低轮询频率，减少 transcript 读压力
  return Math.min(2000, Math.max(250, Math.floor(waitMs / 30) || 250));
}

/**
 * 等到 prompt / 错误静默 /（短等待下的）输出静默，或 waitMs 截止。
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
  const effectiveQuietMs = resolveEffectiveQuietMs(waitMs, quietMs);
  const errorSettleMs = opts.errorSettleMs ?? 800;

  const snapshot = async () =>
    stripAnsi(await getTranscriptTail(opts.sessionId, maxChars));

  if (waitMs <= 0) {
    const output = await snapshot();
    const finished = likelyTerminalFinished(output);
    return {
      output,
      waited_ms: 0,
      requested_wait_ms: 0,
      likely_finished: finished,
      still_running: !finished,
      finish_reason: "no_wait",
      progress_digest: progressDigest(output),
      suggested_next_wait_ms: suggestedNextWaitMs(0, "no_wait", !finished),
      effective_quiet_ms: effectiveQuietMs,
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
          if (Date.now() - quietSince >= effectiveQuietMs) {
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
  let reason = settle.reason;
  // 静默阈值已抬到整段 wait：与 deadline 等价，统一记为 deadline，避免误导模型「提前静默结束」
  if (reason === "quiet_settled" && effectiveQuietMs >= waitMs) {
    reason = "deadline";
  }
  const likely = likelyTerminalFinished(lastRaw);
  const stillRunning =
    reason === "quiet_settled" || reason === "deadline" ? !likely : false;

  return {
    output: lastRaw,
    waited_ms: Date.now() - started,
    requested_wait_ms: waitMs,
    likely_finished:
      likely || reason === "prompt" || reason === "error_settled",
    still_running: stillRunning,
    finish_reason: reason,
    progress_digest: progressDigest(lastRaw),
    suggested_next_wait_ms: suggestedNextWaitMs(waitMs, reason, stillRunning),
    effective_quiet_ms: effectiveQuietMs,
  };
}
