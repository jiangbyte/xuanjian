/**
 * @file LoopPolicy — 唯一环路入口（封装 agent-loop-guard）
 */

import {
  LoopGuard,
  type AfterCallDecision,
  type BeforeCallDecision,
  type DecisionCode,
} from "agent-loop-guard";
import { AGENT_LIMITS } from "../limits";
import type {
  AfterToolDecision,
  BeforeToolDecision,
  StopReason,
} from "./types";

function stableArgsKey(
  args: Record<string, unknown>,
  toolName?: string,
): string {
  const sorted = Object.keys(args).sort();
  const o: Record<string, unknown> = {};
  // terminal_tail：忽略 wait/stable，防止靠加大 wait_ms 绕开 REPEATED_CALL 无限轮询
  const omit =
    toolName === "terminal_tail"
      ? new Set(["wait_ms", "stable_ms", "max_chars"])
      : null;
  for (const k of sorted) {
    if (omit?.has(k)) continue;
    o[k] = args[k];
  }
  try {
    return JSON.stringify(o);
  } catch {
    return String(args);
  }
}

function defaultCallSignature(
  toolName: string,
  args: unknown,
): string {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return `${toolName}::${stableArgsKey(args as Record<string, unknown>, toolName)}`;
  }
  return `${toolName}::${String(args)}`;
}

/** 进度指纹：优先 JSON 字段，避免整段 transcript 进入 guard */
export function defaultResultSignature(result: unknown): string {
  if (typeof result !== "string") {
    try {
      return JSON.stringify(result).slice(0, 400);
    } catch {
      return String(result).slice(0, 200);
    }
  }
  try {
    const o = JSON.parse(result) as Record<string, unknown>;
    if (o && typeof o === "object") {
      const out = typeof o.output === "string" ? o.output : "";
      return JSON.stringify({
        progress_digest: o.progress_digest ?? null,
        finish_reason: o.finish_reason ?? null,
        likely_finished: o.likely_finished ?? null,
        still_running: o.still_running ?? null,
        ok: o.ok ?? null,
        out_len: out.length,
        out_tail: out.slice(-600),
      });
    }
  } catch {
    /* plain text */
  }
  return `${result.length}:${result.slice(0, 100)}:${result.slice(-200)}`;
}

function codeToStopReason(code: DecisionCode): StopReason {
  switch (code) {
    case "BUDGET_EXHAUSTED":
      return "loop_budget";
    case "REPEATED_CALL":
      return "loop_repeated";
    case "STAGNANT_RESULT":
      return "loop_stagnant";
    case "CYCLE_DETECTED":
      return "loop_cycle";
    default:
      return "loop_repeated";
  }
}

export type LoopPolicyOptions = {
  maxCalls: number;
  maxWallMs?: number;
  /** soft block 累计达到此值后 hard stop（含本次） */
  softBeforeHard?: number;
};

export class LoopPolicy {
  private readonly guard: LoopGuard;
  private readonly maxWallMs: number;
  private readonly softBeforeHard: number;
  private readonly startedAt = Date.now();
  private softBlockCount = 0;
  private _stopReason: StopReason | null = null;

  constructor(opts: LoopPolicyOptions) {
    this.maxWallMs = opts.maxWallMs ?? AGENT_LIMITS.MAX_WALL_MS;
    this.softBeforeHard = opts.softBeforeHard ?? 2;
    this.guard = new LoopGuard({
      maxCalls: opts.maxCalls,
      repeatThreshold: 3,
      stagnationThreshold: 2,
      maxCycleLength: 6,
      cycleThreshold: 2,
      signature: defaultCallSignature,
      resultSignature: defaultResultSignature,
    });
  }

  get stopReason(): StopReason | null {
    return this._stopReason;
  }

  isStopped(): boolean {
    return this._stopReason != null;
  }

  applyStop(reason: StopReason): void {
    this._stopReason = reason;
  }

  checkWallClock(): boolean {
    if (Date.now() - this.startedAt > this.maxWallMs) {
      this._stopReason = "wall_clock";
      return true;
    }
    return false;
  }

  beforeTool(
    name: string,
    args: Record<string, unknown>,
  ): BeforeToolDecision {
    if (this._stopReason) {
      return {
        action: "observe",
        text: "本轮已结束，请根据已有信息直接回答用户。",
        soft: false,
        stopReason: this._stopReason,
      };
    }
    if (this.checkWallClock()) {
      return {
        action: "observe",
        text: "已超过最长运行时间，请根据已有信息直接回答用户。",
        soft: false,
        stopReason: "wall_clock",
      };
    }

    const d = this.guard.beforeCall(name, args);
    if (d.allowed) return { action: "run" };
    return this.mapBeforeBlock(d);
  }

  afterTool(
    name: string,
    args: Record<string, unknown>,
    result: string,
  ): AfterToolDecision {
    if (this._stopReason) {
      return {
        action: "stop",
        text: "本轮已结束，请根据已有信息直接回答用户。",
        reason: this._stopReason,
      };
    }

    const d = this.guard.afterCall(name, args, result);
    if (d.allowed) return { action: "continue" };
    return this.mapAfterBlock(d);
  }

  private mapBeforeBlock(d: BeforeCallDecision & { allowed: false }): BeforeToolDecision {
    const text =
      d.suggestionDetail ||
      d.reason ||
      "请更换策略，勿重复相同工具调用。";
    if (d.code === "BUDGET_EXHAUSTED") {
      this._stopReason = "loop_budget";
      return { action: "observe", text, soft: false, stopReason: "loop_budget" };
    }
    this.softBlockCount += 1;
    if (this.softBlockCount >= this.softBeforeHard) {
      const reason = codeToStopReason(d.code);
      this._stopReason = reason;
      return { action: "observe", text, soft: false, stopReason: reason };
    }
    return { action: "observe", text, soft: true };
  }

  private mapAfterBlock(d: AfterCallDecision & { allowed: false }): AfterToolDecision {
    const text =
      d.suggestionDetail ||
      d.reason ||
      "请更换策略，勿在无进展时重复调用。";
    if (d.code === "BUDGET_EXHAUSTED") {
      this._stopReason = "loop_budget";
      return { action: "stop", text, reason: "loop_budget" };
    }
    this.softBlockCount += 1;
    if (this.softBlockCount >= this.softBeforeHard) {
      const reason = codeToStopReason(d.code);
      this._stopReason = reason;
      return { action: "stop", text, reason };
    }
    return { action: "observe", text, soft: true };
  }
}
