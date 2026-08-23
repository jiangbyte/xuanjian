/**
 * @file 终端输出等待（稳定检测 + 完成早退）
 * @author Charlie
 */

import { stripAnsi } from "@/lib/agent/ansi";
import { getTranscriptTail } from "@/lib/session/recorder";
import { sleep } from "@/lib/agent/tools/types";

export type TerminalWaitFinishReason =
  | "no_wait"
  | "prompt"
  | "error_stable"
  | "stable"
  | "deadline";

export type TerminalWaitResult = {
  output: string;
  waited_ms: number;
  likely_finished: boolean;
  finish_reason: TerminalWaitFinishReason;
};

/** 去掉 \\r 覆写进度，避免 docker 进度条导致「永远不稳定」 */
export function normalizeTerminalChunk(text: string): string {
  return text
    .split(/\n/)
    .map((line) => {
      const i = line.lastIndexOf("\r");
      return i >= 0 ? line.slice(i + 1) : line;
    })
    .join("\n");
}

const SHELL_PROMPT_RE =
  /(?:^|\n)(?:\x1b\][^\x07]*\x07)*[^\n]*[@#$%]\s*$/;

const ERROR_TAIL_RE =
  /(?:dependency failed to start|is unhealthy|Error response from daemon|exit code \d+|✘|(?:^|\n)[^\n]*\berror\b[^\n]*$|(?:^|\n)[^\n]*\bfailed\b[^\n]*$)/im;

export function detectTerminalFinished(output: string): {
  finished: boolean;
  reason: "prompt" | "error_stable" | null;
} {
  const tail = output.slice(-2000).trimEnd();
  if (!tail) return { finished: false, reason: null };
  if (SHELL_PROMPT_RE.test(tail)) {
    return { finished: true, reason: "prompt" };
  }
  return { finished: false, reason: null };
}

export function likelyTerminalFinished(output: string): boolean {
  const det = detectTerminalFinished(output);
  if (det.finished) return true;
  const tail = output.slice(-1200);
  return ERROR_TAIL_RE.test(tail) && SHELL_PROMPT_RE.test(output.slice(-400));
}

export async function waitForTerminalOutput(opts: {
  sessionId: string;
  maxChars?: number;
  waitMs: number;
  stableMs?: number;
  errorStableMs?: number;
  pollMs?: number;
}): Promise<TerminalWaitResult> {
  const maxChars = opts.maxChars ?? 12_000;
  const waitMs = Math.max(0, opts.waitMs);
  const stableMs = opts.stableMs ?? 1500;
  const errorStableMs = opts.errorStableMs ?? 800;
  const pollMs = opts.pollMs ?? 400;

  if (waitMs <= 0) {
    const output = stripAnsi(
      await getTranscriptTail(opts.sessionId, maxChars),
    );
    return {
      output,
      waited_ms: 0,
      likely_finished: likelyTerminalFinished(output),
      finish_reason: "no_wait",
    };
  }

  const started = Date.now();
  const deadline = started + waitMs;
  let lastNorm = "";
  let stableSince = Date.now();
  let errorSince: number | null = null;
  let finishReason: TerminalWaitFinishReason = "deadline";

  while (Date.now() < deadline) {
    const raw = stripAnsi(await getTranscriptTail(opts.sessionId, maxChars));
    const norm = normalizeTerminalChunk(raw);
    const det = detectTerminalFinished(norm);

    if (det.finished) {
      finishReason = det.reason === "prompt" ? "prompt" : "stable";
      return {
        output: raw,
        waited_ms: Date.now() - started,
        likely_finished: true,
        finish_reason: finishReason,
      };
    }

    if (ERROR_TAIL_RE.test(norm.slice(-2000))) {
      if (errorSince == null) errorSince = Date.now();
      if (Date.now() - errorSince >= errorStableMs) {
        return {
          output: raw,
          waited_ms: Date.now() - started,
          likely_finished: true,
          finish_reason: "error_stable",
        };
      }
    } else {
      errorSince = null;
    }

    if (norm === lastNorm) {
      if (Date.now() - stableSince >= stableMs) {
        return {
          output: raw,
          waited_ms: Date.now() - started,
          likely_finished: likelyTerminalFinished(raw),
          finish_reason: "stable",
        };
      }
    } else {
      lastNorm = norm;
      stableSince = Date.now();
    }

    await sleep(pollMs);
  }

  const output = stripAnsi(await getTranscriptTail(opts.sessionId, maxChars));
  return {
    output,
    waited_ms: Date.now() - started,
    likely_finished: likelyTerminalFinished(output),
    finish_reason: "deadline",
  };
}
