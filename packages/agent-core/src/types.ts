/**
 * @file Agent 运行时共享类型（框架无关）
 */

export type AgentPermissionMode = "confirm" | "plan" | "full";

export type ThinkingMode = "off" | "high" | "max";

export type AgentActivityPhase =
  | "idle"
  | "planning"
  | "calling_model"
  | "thinking"
  | "awaiting_confirm"
  | "running_tool"
  | "subagent"
  | "summarizing";

export type MessagePart =
  | { type: "text"; text: string; agent?: string }
  | { type: "thinking"; text: string; agent?: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: unknown;
      agent?: string;
      thinkingBefore?: string;
    }
  | {
      type: "tool_pending";
      id: string;
      name: string;
      args: unknown;
      dangerous?: boolean;
      agent?: string;
    }
  | {
      type: "tool_result";
      id: string;
      name: string;
      result: string;
      agent?: string;
    }
  | {
      type: "subagent";
      id: string;
      agent: string;
      label: string;
      task: string;
      status: "running" | "done" | "error";
      summary?: string;
      children?: MessagePart[];
    }
  | { type: "plan"; title?: string; items: string[]; agent?: string }
  | { type: "status"; text: string }
  | { type: "compaction"; summary: string };

export type LlmUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalPrompt: number;
  /** @deprecated alias */
  prompt?: number;
  completion?: number;
};

export type RuntimeEvent =
  | { type: "thinking"; text: string; agent?: string }
  | { type: "thinking_delta"; text: string; agent?: string }
  | { type: "text"; text: string; agent?: string }
  | { type: "text_delta"; text: string; agent?: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: unknown;
      agent?: string;
    }
  | {
      type: "tool_pending";
      id: string;
      name: string;
      args: unknown;
      dangerous?: boolean;
      agent?: string;
    }
  | {
      type: "tool_result";
      id: string;
      name: string;
      result: string;
      agent?: string;
    }
  | { type: "plan"; items: string[]; agent?: string }
  | { type: "status"; text: string }
  | {
      type: "activity";
      phase: AgentActivityPhase;
      label: string;
      detail?: string;
    }
  | {
      type: "subagent_start";
      id: string;
      agent: string;
      label: string;
      task: string;
    }
  | {
      type: "subagent_end";
      id: string;
      agent: string;
      label: string;
      ok: boolean;
      summary: string;
      children?: MessagePart[];
    }
  | { type: "error"; text: string }
  | { type: "usage"; usage: LlmUsage; agent?: string }
  | { type: "done" };

export type ConfirmToolRequest = {
  id: string;
  name: string;
  args: unknown;
  dangerous?: boolean;
};

/** 与 OpenAI chat 兼容的消息形状（adapters 再转 BaseMessage） */
export type CoreLlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | unknown }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: CoreLlmToolCall[];
      anthropic_content?: unknown;
    }
  | {
      role: "tool";
      tool_call_id: string;
      content: string;
      name?: string;
    };

export type CoreLlmToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type CoreToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type NormalizedLlmReply = {
  text: string;
  thinking: string;
  toolCalls: CoreLlmToolCall[];
  usage?: LlmUsage;
  anthropicContent?: unknown;
};

export type RunAgentInput = {
  sessionId: number;
  userText: string;
  modelRef?: string | null;
  permissionMode: AgentPermissionMode;
  thinkingMode?: ThinkingMode;
  history: CoreLlmMessage[];
  onEvent: (e: RuntimeEvent) => void;
  onConfirmTool?: (req: ConfirmToolRequest) => Promise<boolean>;
  signal?: AbortSignal;
};

export type ExecutionSnapshot = {
  tabId: string | null;
  plane: string;
  cwd?: string;
  hostLabel?: string;
  block: string;
};
