/**
 * @file LoopPolicy 决策类型
 */

export type StopReason =
  | "max_rounds"
  | "wall_clock"
  | "empty_replies"
  | "loop_budget"
  | "loop_repeated"
  | "loop_stagnant"
  | "loop_cycle"
  | "user_abort"
  | "error";

export type BeforeToolDecision =
  | { action: "run" }
  | {
      action: "observe";
      text: string;
      soft: boolean;
      stopReason?: StopReason;
    };

export type AfterToolDecision =
  | { action: "continue" }
  | { action: "observe"; text: string; soft: boolean }
  | { action: "stop"; text: string; reason: StopReason };
