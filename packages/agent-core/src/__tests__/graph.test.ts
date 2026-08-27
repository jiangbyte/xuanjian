/**
 * @file OrchestratorGraph 路由冒烟测试（mock ports）
 */

import { describe, expect, it, vi } from "vitest";
import { AgentInbox, type AgentPorts, type CoreLlmMessage, type NormalizedLlmReply } from "../index";
import { runOrchestratorGraph } from "../graph";

function mockPorts(reply: NormalizedLlmReply): AgentPorts {
  return {
    llm: {
      complete: vi.fn(async () => reply),
      stream: vi.fn(async () => reply),
    },
    tools: {
      listTools: () => [],
      isWriteTool: () => false,
      execute: vi.fn(async () => JSON.stringify({ ok: true })),
    },
    execution: {
      snapshot: async () => ({
        tabId: null,
        plane: "local",
        block: "",
      }),
    },
    session: {
      loadHistory: async () => [],
      appendUser: async () => {},
      appendAssistant: async () => {},
    },
    provider: {
      resolve: async () => ({
        modelId: "test",
        contextTag: "128k",
        maxTokens: 1024,
      }),
    },
  };
}

describe("runOrchestratorGraph", () => {
  it("finalizes text-only reply and extracts plan in plan mode", async () => {
    const reply: NormalizedLlmReply = {
      text: `空间充足。

## 执行计划
1. 执行 sudo apt clean 清理缓存
2. 使用 sync_to_remote 同步产物`,
      thinking: "",
      toolCalls: [],
    };
    const events: string[] = [];
    const parts = await runOrchestratorGraph(
      {
        ports: mockPorts(reply),
        system: "sys",
        tools: [],
        userText: "清理磁盘",
        permissionMode: "plan",
        thinkingMode: "off",
        maxRounds: 5,
        agentTag: "orchestrator",
        agentLabel: "编排器",
        depth: 0,
        emit: (e) => events.push(e.type),
        inbox: new AgentInbox(),
      },
      [] as CoreLlmMessage[],
    );

    expect(parts.some((p) => p.type === "text")).toBe(true);
    expect(parts.some((p) => p.type === "plan")).toBe(true);
    expect(events).toContain("plan");
  });

  it("executes a tool then finishes on next text turn", async () => {
    let call = 0;
    const ports = mockPorts({
      text: "",
      thinking: "",
      toolCalls: [],
    });
    ports.llm.stream = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          text: "",
          thinking: "",
          toolCalls: [
            {
              id: "c1",
              type: "function" as const,
              function: {
                name: "list_files",
                arguments: '{"path":"/"}',
              },
            },
          ],
        };
      }
      return {
        text: "根目录如下…",
        thinking: "",
        toolCalls: [],
      };
    });

    const parts = await runOrchestratorGraph(
      {
        ports,
        system: "sys",
        tools: [],
        userText: "列目录",
        permissionMode: "confirm",
        thinkingMode: "off",
        maxRounds: 8,
        agentTag: "orchestrator",
        agentLabel: "编排器",
        depth: 0,
        emit: () => {},
        inbox: new AgentInbox(),
      },
      [],
    );

    expect(ports.tools.execute).toHaveBeenCalled();
    expect(parts.some((p) => p.type === "tool_result")).toBe(true);
    expect(parts.some((p) => p.type === "text" && p.text.includes("根目录"))).toBe(
      true,
    );
  });
});
