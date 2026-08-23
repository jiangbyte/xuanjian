/**
 * @file ReAct 循环安全护栏（仅内部使用，不向用户暴露机制）
 * @author Charlie
 */

/** 全局 ReAct 限制（部署等多步任务需要较大余量） */
export const REACT_LIMITS = {
  ORCH_MAX_ROUNDS: 32,
  ORCH_MAX_TOOL_CALLS: 150,
  MAX_WALL_MS: 60 * 60 * 1000,
  LLM_TIMEOUT_MS: 8 * 60 * 1000,
  DUP_WINDOW: 12,
  DUP_THRESHOLD: 5,
  MAX_EMPTY_ROUNDS: 3,
  /** 接近回合上限且仍在调用工具时，额外允许的轮次 */
  PROGRESS_BONUS_ROUNDS: 24,
} as const;

/** 只读/观测类工具：不计入工具预算，不参与重复检测 */
export const READ_ONLY_AGENT_TOOLS = new Set([
  "terminal_tail",
  "list_files",
  "read_file",
  "file_info",
  "host_info",
  "list_hosts",
  "list_sessions",
  "list_scripts",
  "get_script",
  "list_cmd_history",
  "host_metrics",
  "list_pipelines",
  "get_pipeline",
  "search_notes",
  "search_session_logs",
  "search_cmd_history",
  "tcp_probe",
]);

export function isReadOnlyAgentTool(name: string): boolean {
  return READ_ONLY_AGENT_TOOLS.has(name);
}

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
  private pausedMs = 0;
  private pauseStarted: number | null = null;
  /** 内部标记：应转入收尾，不向 UI 暴露原因 */
  shouldWrapUp = false;
  lastStopReason: GuardStopReason | null = null;

  constructor(
    private readonly maxToolCalls: number,
    private readonly maxWallMs: number = REACT_LIMITS.MAX_WALL_MS,
    private readonly dupWindow: number = REACT_LIMITS.DUP_WINDOW,
    private readonly dupThreshold: number = REACT_LIMITS.DUP_THRESHOLD,
  ) {}

  /** 长耗时工具（等待终端/传输）期间暂停墙钟计时 */
  pauseWallClock() {
    if (this.pauseStarted == null) this.pauseStarted = Date.now();
  }

  resumeWallClock() {
    if (this.pauseStarted != null) {
      this.pausedMs += Date.now() - this.pauseStarted;
      this.pauseStarted = null;
    }
  }

  private elapsedMs(): number {
    let elapsed = Date.now() - this.startedAt - this.pausedMs;
    if (this.pauseStarted != null) {
      elapsed -= Date.now() - this.pauseStarted;
    }
    return elapsed;
  }

  checkWallClock(): boolean {
    if (this.elapsedMs() > this.maxWallMs) {
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
    const isReadOnly = isReadOnlyAgentTool(name);

    if (!isReadOnly) {
      this.toolCallCount += 1;
      if (this.toolCallCount > this.maxToolCalls) {
        this.shouldWrapUp = true;
        this.lastStopReason = "max_tool_calls";
        return OBS_TOOL_BUDGET;
      }
    }

    if (isReadOnly) return null;

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
