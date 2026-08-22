/**
 * @file ReAct 循环安全护栏（仅内部使用，不向用户暴露机制）
 * @author Charlie
 */

/** 全局 ReAct 限制 */
export const REACT_LIMITS = {
  ORCH_MAX_ROUNDS: 12,
  ORCH_MAX_TOOL_CALLS: 30,
  MAX_WALL_MS: 10 * 60 * 1000,
  LLM_TIMEOUT_MS: 5 * 60 * 1000,
  DUP_WINDOW: 8,
  DUP_THRESHOLD: 3,
  MAX_EMPTY_ROUNDS: 2,
} as const;

export type GuardStopReason =
  | "max_rounds"
  | "max_tool_calls"
  | "wall_clock"
  | "duplicate_tool"
  | "empty_replies";

/** 工具调用签名，用于检测重复循环 */
export function toolCallSignature(
  name: string,
  args: Record<string, unknown>,
): string {
  let argsKey = "";
  try {
    const sorted = Object.keys(args).sort();
    const o: Record<string, unknown> = {};
    for (const k of sorted) o[k] = args[k];
    argsKey = JSON.stringify(o);
  } catch {
    argsKey = String(args);
  }
  return `${name}::${argsKey}`;
}

/** 写给模型的 Observation，语气中性，不出现 BLOCKED / 上限 / 循环 等字眼 */
const OBS_DUPLICATE =
  "该操作刚才已执行，结果与上文相同。请根据已有信息继续，或直接回答用户。";
const OBS_TOOL_BUDGET =
  "本轮可执行的操作已足够。请根据已有信息直接回答用户，勿再调用工具。";

export class ReactLoopGuard {
  private toolCallCount = 0;
  private recentSigs: string[] = [];
  private readonly startedAt = Date.now();
  /** 内部标记：应转入收尾，不向 UI 暴露原因 */
  shouldWrapUp = false;
  lastStopReason: GuardStopReason | null = null;

  constructor(
    private readonly maxToolCalls: number,
    private readonly maxWallMs: number = REACT_LIMITS.MAX_WALL_MS,
    private readonly dupWindow: number = REACT_LIMITS.DUP_WINDOW,
    private readonly dupThreshold: number = REACT_LIMITS.DUP_THRESHOLD,
  ) {}

  checkWallClock(): boolean {
    if (Date.now() - this.startedAt > this.maxWallMs) {
      this.shouldWrapUp = true;
      this.lastStopReason = "wall_clock";
      return true;
    }
    return false;
  }

  markWrapUp(reason: GuardStopReason) {
    this.shouldWrapUp = true;
    this.lastStopReason = reason;
  }

  /**
   * 执行工具前检查。
   * 返回非空字符串时作为 tool Observation 喂给模型（用户侧不单独提示）。
   */
  beforeToolCall(name: string, args: Record<string, unknown>): string | null {
    this.toolCallCount += 1;
    if (this.toolCallCount > this.maxToolCalls) {
      this.shouldWrapUp = true;
      this.lastStopReason = "max_tool_calls";
      return OBS_TOOL_BUDGET;
    }

    const sig = toolCallSignature(name, args);
    this.recentSigs.push(sig);
    while (this.recentSigs.length > this.dupWindow) {
      this.recentSigs.shift();
    }
    const repeats = this.recentSigs.filter((s) => s === sig).length;
    if (repeats >= this.dupThreshold) {
      this.shouldWrapUp = true;
      this.lastStopReason = "duplicate_tool";
      return OBS_DUPLICATE;
    }
    return null;
  }
}
