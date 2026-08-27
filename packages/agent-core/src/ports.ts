/**
 * @file Agent 端口接口（core 不依赖 Tauri/React）
 */

import type {
  AgentPermissionMode,
  ConfirmToolRequest,
  CoreLlmMessage,
  CoreToolDef,
  ExecutionSnapshot,
  MessagePart,
  NormalizedLlmReply,
  RuntimeEvent,
  ThinkingMode,
} from "./types";

export type StreamCallbacks = {
  onTextDelta?: (d: string) => void;
  onThinkingDelta?: (d: string) => void;
  onUsage?: (u: import("./types").LlmUsage) => void;
};

export type LlmRequestOpts = {
  thinkingMode?: ThinkingMode;
  signal?: AbortSignal;
  stream?: boolean;
  callbacks?: StreamCallbacks;
};

export interface LlmPort {
  complete(
    messages: CoreLlmMessage[],
    tools: CoreToolDef[],
    opts?: LlmRequestOpts,
  ): Promise<NormalizedLlmReply>;
  stream(
    messages: CoreLlmMessage[],
    tools: CoreToolDef[],
    opts?: LlmRequestOpts,
  ): Promise<NormalizedLlmReply>;
}

export interface ToolPort {
  listTools(permissionMode: AgentPermissionMode): CoreToolDef[];
  execute(
    name: string,
    args: Record<string, unknown>,
    ctx: {
      permissionMode: AgentPermissionMode;
      toolCallId?: string;
      confirmTool?: (req: ConfirmToolRequest) => Promise<boolean>;
      emit: (e: RuntimeEvent) => void;
      agentTag?: string;
    },
  ): Promise<string>;
  isWriteTool(name: string): boolean;
  isDangerous?(name: string, args: Record<string, unknown>): boolean;
}

export interface ExecutionContextPort {
  snapshot(): Promise<ExecutionSnapshot>;
  /** 仅当上下文变化时返回 block，否则 null */
  snapshotIfChanged?(): Promise<string | null>;
}

export interface SessionPort {
  loadHistory(sessionId: number): Promise<CoreLlmMessage[]>;
  appendUser(sessionId: number, text: string): Promise<void>;
  appendAssistant(sessionId: number, parts: MessagePart[]): Promise<void>;
}

export interface ProviderPort {
  resolve(modelRef?: string | null): Promise<{
    modelId: string;
    contextTag: string;
    maxTokens: number;
  }>;
}

export type AgentPorts = {
  llm: LlmPort;
  tools: ToolPort;
  execution: ExecutionContextPort;
  session: SessionPort;
  provider: ProviderPort;
};
