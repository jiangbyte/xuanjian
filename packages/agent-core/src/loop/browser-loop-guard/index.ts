/**
 * @file agent-loop-guard 浏览器版 LoopGuard
 * @description 与 npm 包行为对齐，供 WebView 生产构建使用。
 */

import { callSignature, hashSignature } from "./signature";

export type SuggestedAction = "stop" | "change_approach";
export type DecisionCode =
  | "OK"
  | "BUDGET_EXHAUSTED"
  | "REPEATED_CALL"
  | "STAGNANT_RESULT"
  | "CYCLE_DETECTED";

export type BeforeCallDecision =
  | {
      allowed: true;
      code: "OK";
      reason: null;
      suggestedAction: null;
      suggestionDetail: null;
    }
  | {
      allowed: false;
      code: "BUDGET_EXHAUSTED" | "REPEATED_CALL";
      reason: string;
      suggestedAction: SuggestedAction;
      suggestionDetail: string;
    };

export type AfterCallDecision =
  | {
      allowed: true;
      code: "OK";
      stagnant: false;
      reason: null;
      suggestedAction: null;
      suggestionDetail: null;
    }
  | {
      allowed: false;
      code: "STAGNANT_RESULT";
      stagnant: true;
      reason: string;
      suggestedAction: "change_approach";
      suggestionDetail: string;
    }
  | {
      allowed: false;
      code: "BUDGET_EXHAUSTED" | "CYCLE_DETECTED";
      stagnant: false;
      reason: string;
      suggestedAction: SuggestedAction;
      suggestionDetail: string;
    };

export type GuardDecision = BeforeCallDecision | AfterCallDecision;

export interface LoopGuardOptions {
  maxCalls?: number;
  repeatThreshold?: number;
  stagnationThreshold?: number;
  maxSignatureLength?: number;
  maxCycleLength?: number;
  cycleThreshold?: number;
  signature?: ((toolName: string, args: unknown) => string) | null;
  resultSignature?: ((result: unknown) => string) | null;
  onDecision?: ((decision: GuardDecision) => void) | null;
}

export interface LoopGuardSummary {
  totalCalls: number;
  uniqueCallSignatures: number;
  budgetRemaining: number;
}

type CycleEntry = {
  callSignature: string;
  resultSignature: string;
};

const DEFAULT_OPTIONS = {
  maxCalls: 50,
  repeatThreshold: 3,
  stagnationThreshold: 2,
  maxSignatureLength: 200_000,
  maxCycleLength: 0,
  cycleThreshold: 2,
  signature: null as LoopGuardOptions["signature"],
  resultSignature: null as LoopGuardOptions["resultSignature"],
  onDecision: null as LoopGuardOptions["onDecision"],
};

const MIN_REPEAT_THRESHOLD = 2;
const MIN_STAGNATION_THRESHOLD = 2;
const MIN_CYCLE_THRESHOLD = 2;
const MAX_CYCLE_LENGTH = 1000;

function hasOwn(obj: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function validateToolName(toolName: string) {
  if (typeof toolName !== "string" || toolName.length === 0) {
    throw new TypeError("toolName must be a non-empty string.");
  }
}

function sameCycleEntry(left: CycleEntry, right: CycleEntry) {
  return (
    left.callSignature === right.callSignature &&
    left.resultSignature === right.resultSignature
  );
}

function validateOptions(options: LoopGuardOptions) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new TypeError("LoopGuard options must be an object.");
  }

  const ownOption = <K extends keyof LoopGuardOptions>(key: K) =>
    hasOwn(options, key) ? options[key] : undefined;

  for (const key of Object.keys(options) as (keyof LoopGuardOptions)[]) {
    if (!hasOwn(DEFAULT_OPTIONS, key)) {
      throw new TypeError(`Unknown LoopGuard option: ${String(key)}.`);
    }
    if (key === "signature" || key === "resultSignature" || key === "onDecision") {
      if (options[key] != null && typeof options[key] !== "function") {
        throw new TypeError(`LoopGuard option ${String(key)} must be a function or null.`);
      }
      continue;
    }
    const v = options[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new TypeError(
        `LoopGuard option ${String(key)} must be a non-negative integer.`,
      );
    }
    if (v === 0 && key !== "maxCycleLength") {
      throw new TypeError(
        `LoopGuard option ${String(key)} must be a positive integer.`,
      );
    }
  }

  const repeatThreshold = ownOption("repeatThreshold") as number | undefined;
  const stagnationThreshold = ownOption("stagnationThreshold") as
    | number
    | undefined;
  const cycleThreshold = ownOption("cycleThreshold") as number | undefined;
  const maxCycleLength = ownOption("maxCycleLength") as number | undefined;

  if (
    repeatThreshold !== undefined &&
    repeatThreshold < MIN_REPEAT_THRESHOLD
  ) {
    throw new TypeError(
      `LoopGuard option repeatThreshold must be at least ${MIN_REPEAT_THRESHOLD}.`,
    );
  }
  if (
    stagnationThreshold !== undefined &&
    stagnationThreshold < MIN_STAGNATION_THRESHOLD
  ) {
    throw new TypeError(
      `LoopGuard option stagnationThreshold must be at least ${MIN_STAGNATION_THRESHOLD}.`,
    );
  }
  if (cycleThreshold !== undefined && cycleThreshold < MIN_CYCLE_THRESHOLD) {
    throw new TypeError(
      `LoopGuard option cycleThreshold must be at least ${MIN_CYCLE_THRESHOLD}.`,
    );
  }
  if (
    maxCycleLength !== undefined &&
    maxCycleLength !== 0 &&
    maxCycleLength < 2
  ) {
    throw new TypeError(
      "LoopGuard option maxCycleLength must be 0 or at least 2.",
    );
  }
  if (maxCycleLength !== undefined && maxCycleLength > MAX_CYCLE_LENGTH) {
    throw new TypeError(
      `LoopGuard option maxCycleLength must not exceed ${MAX_CYCLE_LENGTH}.`,
    );
  }
}

export class LoopGuard {
  private readonly options: {
    maxCalls: number;
    repeatThreshold: number;
    stagnationThreshold: number;
    maxSignatureLength: number;
    maxCycleLength: number;
    cycleThreshold: number;
    signature: ((toolName: string, args: unknown) => string) | null;
    resultSignature: ((result: unknown) => string) | null;
    onDecision: ((decision: GuardDecision) => void) | null;
  };

  totalCalls = 0;
  uniqueSignatures = new Set<string>();
  consecutiveRepeatCount = 0;
  lastSignature: string | null = null;
  lastResultCallSignature: string | null = null;
  lastResultSignature: string | null = null;
  consecutiveResultCount = 0;
  unsupportedObjectIds = new WeakMap<object, number>();
  unsupportedSymbolIds = new Map<symbol, number>();
  nextUnsupportedId = 1;
  callHistory: CycleEntry[] = [];

  private deliveringDecision = false;

  constructor(options: LoopGuardOptions = {}) {
    validateOptions(options);
    this.options = {
      maxCalls: options.maxCalls ?? DEFAULT_OPTIONS.maxCalls,
      repeatThreshold:
        options.repeatThreshold ?? DEFAULT_OPTIONS.repeatThreshold,
      stagnationThreshold:
        options.stagnationThreshold ?? DEFAULT_OPTIONS.stagnationThreshold,
      maxSignatureLength:
        options.maxSignatureLength ?? DEFAULT_OPTIONS.maxSignatureLength,
      maxCycleLength:
        options.maxCycleLength ?? DEFAULT_OPTIONS.maxCycleLength,
      cycleThreshold:
        options.cycleThreshold ?? DEFAULT_OPTIONS.cycleThreshold,
      signature: options.signature ?? null,
      resultSignature: options.resultSignature ?? null,
      onDecision: options.onDecision ?? null,
    };
  }

  beforeCall(toolName: string, args: unknown): BeforeCallDecision {
    this.assertNotDeliveringDecision("beforeCall");
    validateToolName(toolName);

    if (this.totalCalls >= this.options.maxCalls) {
      return this.beforeDecision({
        allowed: false,
        code: "BUDGET_EXHAUSTED",
        reason: `Call budget exhausted (${this.totalCalls}/${this.options.maxCalls} calls used).`,
        suggestedAction: "stop",
        suggestionDetail:
          "End the run and surface a summary to the user rather than continuing — the budget exists to prevent runaway cost/time, not to be silently raised.",
      });
    }

    const signature = this.boundedSignature(toolName, args);

    if (signature === this.lastSignature) {
      const projectedRepeats = this.consecutiveRepeatCount + 1;
      if (projectedRepeats >= this.options.repeatThreshold) {
        return this.beforeDecision({
          allowed: false,
          code: "REPEATED_CALL",
          reason: `"${toolName}" has been called with identical arguments ${projectedRepeats} times in a row. The agent appears stuck in a loop.`,
          suggestedAction: "change_approach",
          suggestionDetail: `Do not retry "${toolName}" with the same arguments. Either try different arguments, use a different tool to accomplish the same goal, or ask the user for clarification if the task is ambiguous.`,
        });
      }
    }

    return this.beforeDecision({
      allowed: true,
      code: "OK",
      reason: null,
      suggestedAction: null,
      suggestionDetail: null,
    });
  }

  afterCall(
    toolName: string,
    args: unknown,
    result: unknown,
  ): AfterCallDecision {
    this.assertNotDeliveringDecision("afterCall");
    validateToolName(toolName);

    if (this.totalCalls >= this.options.maxCalls) {
      return this.afterDecision({
        allowed: false,
        code: "BUDGET_EXHAUSTED",
        stagnant: false,
        reason: `Call budget exhausted (${this.options.maxCalls} calls used).`,
        suggestedAction: "stop",
        suggestionDetail:
          "End the run and surface a summary to the user rather than continuing — the budget exists to prevent runaway cost/time.",
      });
    }

    this.totalCalls += 1;

    const signature = this.boundedSignature(toolName, args);
    const resultSignature = this.safeResultSignature(result);

    if (signature === this.lastSignature) {
      this.consecutiveRepeatCount += 1;
    } else {
      this.consecutiveRepeatCount = 1;
    }
    this.lastSignature = signature;

    this.uniqueSignatures.add(signature);

    const stagnantCount =
      signature === this.lastResultCallSignature &&
      resultSignature === this.lastResultSignature
        ? this.consecutiveResultCount + 1
        : 1;

    this.lastResultCallSignature = signature;
    this.lastResultSignature = resultSignature;
    this.consecutiveResultCount = stagnantCount;

    if (this.options.maxCycleLength > 0) {
      const entry: CycleEntry = {
        callSignature: signature,
        resultSignature,
      };
      this.callHistory.push(entry);
      const historyLimit =
        this.options.maxCycleLength * this.options.cycleThreshold;
      if (this.callHistory.length > historyLimit) {
        this.callHistory.shift();
      }
    }

    if (stagnantCount >= this.options.stagnationThreshold) {
      return this.afterDecision({
        allowed: false,
        code: "STAGNANT_RESULT",
        stagnant: true,
        reason: `"${toolName}" has returned the same result ${stagnantCount} times for the same arguments — the agent is not making progress and should change strategy.`,
        suggestedAction: "change_approach",
        suggestionDetail: `The last ${stagnantCount} calls to "${toolName}" with these arguments all returned the same result. Repeating it again won't help — try a different tool, different arguments, or escalate to the user with what's been tried so far.`,
      });
    }

    if (this.options.maxCycleLength > 0) {
      const maxDetectableLength = Math.min(
        this.options.maxCycleLength,
        Math.floor(this.callHistory.length / this.options.cycleThreshold),
      );

      for (let len = 2; len <= maxDetectableLength; len++) {
        const cycleThreshold = this.options.cycleThreshold;
        const sequence = this.callHistory.slice(this.callHistory.length - len);

        const isLengthOnePattern = sequence.every((entry) =>
          sameCycleEntry(entry, sequence[0]!),
        );
        if (isLengthOnePattern) continue;

        let isCycle = true;
        for (let i = 1; i < cycleThreshold; i++) {
          const offset = this.callHistory.length - len * (i + 1);
          for (let j = 0; j < len; j++) {
            if (
              !sameCycleEntry(this.callHistory[offset + j]!, sequence[j]!)
            ) {
              isCycle = false;
              break;
            }
          }
          if (!isCycle) break;
        }
        if (isCycle) {
          return this.afterDecision({
            allowed: false,
            code: "CYCLE_DETECTED",
            stagnant: false,
            reason: `A repeating sequence of tool calls (length ${len}) has been detected ${cycleThreshold} times in a row.`,
            suggestedAction: "change_approach",
            suggestionDetail:
              "The agent is alternating between the same set of tool calls without progressing. Review the recent steps and break the loop by taking a different action or escalating to the user.",
          });
        }
      }
    }

    return this.afterDecision({
      allowed: true,
      code: "OK",
      stagnant: false,
      reason: null,
      suggestedAction: null,
      suggestionDetail: null,
    });
  }

  summary(): LoopGuardSummary {
    return {
      totalCalls: this.totalCalls,
      uniqueCallSignatures: this.uniqueSignatures.size,
      budgetRemaining: Math.max(0, this.options.maxCalls - this.totalCalls),
    };
  }

  reset() {
    this.assertNotDeliveringDecision("reset");
    this.totalCalls = 0;
    this.uniqueSignatures = new Set();
    this.consecutiveRepeatCount = 0;
    this.lastSignature = null;
    this.lastResultCallSignature = null;
    this.lastResultSignature = null;
    this.consecutiveResultCount = 0;
    this.unsupportedObjectIds = new WeakMap();
    this.unsupportedSymbolIds = new Map();
    this.nextUnsupportedId = 1;
    this.callHistory = [];
  }

  private assertNotDeliveringDecision(methodName: string) {
    if (this.deliveringDecision) {
      throw new Error(
        `LoopGuard ${methodName}() cannot be called from the same instance while onDecision is running.`,
      );
    }
  }

  private decision(result: GuardDecision): GuardDecision {
    if (typeof this.options.onDecision === "function") {
      this.deliveringDecision = true;
      try {
        this.options.onDecision(Object.freeze({ ...result }) as GuardDecision);
      } catch {
        /* ignore observability errors */
      } finally {
        this.deliveringDecision = false;
      }
    }
    return result;
  }

  private beforeDecision(result: BeforeCallDecision): BeforeCallDecision {
    return this.decision(result) as BeforeCallDecision;
  }

  private afterDecision(result: AfterCallDecision): AfterCallDecision {
    return this.decision(result) as AfterCallDecision;
  }

  private boundedSignature(toolName: string, args: unknown): string {
    let signature: string;
    if (typeof this.options.signature === "function") {
      signature = this.options.signature(toolName, args);
      if (typeof signature !== "string") {
        throw new TypeError("Custom signature function must return a string.");
      }
    } else {
      signature = callSignature(toolName, args);
    }

    if (signature.length <= this.options.maxSignatureLength) {
      return signature;
    }
    const toolPreview = toolName.slice(0, 40);
    return `$tool:${JSON.stringify(toolPreview)}:$hash:${hashSignature(signature)}:len${signature.length}`;
  }

  private safeResultSignature(result: unknown): string {
    let signature: string;
    if (typeof this.options.resultSignature === "function") {
      signature = this.options.resultSignature(result);
      if (typeof signature !== "string") {
        throw new TypeError(
          "Custom resultSignature function must return a string.",
        );
      }
    } else {
      try {
        signature = callSignature("result", result);
      } catch {
        return this.unsupportedResultSignature(result);
      }
    }

    if (signature.length <= this.options.maxSignatureLength) {
      return signature;
    }
    return `$hash:${hashSignature(signature)}:len${signature.length}`;
  }

  private unsupportedResultSignature(result: unknown): string {
    if (
      (typeof result === "object" && result !== null) ||
      typeof result === "function"
    ) {
      const obj = result as object;
      let id = this.unsupportedObjectIds.get(obj);
      if (id === undefined) {
        id = this.nextUnsupportedId++;
        this.unsupportedObjectIds.set(obj, id);
      }
      return `$unsupported:${typeof result}:id${id}`;
    }

    if (typeof result === "symbol") {
      let id = this.unsupportedSymbolIds.get(result);
      if (id === undefined) {
        id = this.nextUnsupportedId++;
        this.unsupportedSymbolIds.set(result, id);
      }
      return `$unsupported:symbol:id${id}`;
    }

    return `$unsupported:${typeof result}`;
  }
}

export { callSignature, stableStringify, hashSignature } from "./signature";
