/**
 * @file 后端 Agent 应用客户端
 * @author Charlie
 */

import {
  appendAgentMessage,
  listAgentSessions,
  type MessagePart,
} from "@/lib/db";
import {
  getBackendBase,
  type RunAgentInput,
} from "@/lib/agent/types";
import { executeLocalTool } from "@/lib/agent/tools";

type AgentInfo = {
  id: string;
  name: string;
  description?: string;
};

export async function discoverRemoteAgents(): Promise<AgentInfo[]> {
  const { baseUrl, token } = await getBackendBase();
  if (!baseUrl) return [];
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/agents`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`discover agents: ${res.status}`);
  const data = (await res.json()) as { agents?: AgentInfo[] };
  return data.agents ?? [];
}

async function resolveRemoteSessionId(
  input: RunAgentInput,
  root: string,
  agentId: string,
  headers: Record<string, string>,
): Promise<string> {
  const sessions = await listAgentSessions();
  const row = sessions.find((s) => s.id === input.sessionId);
  if (row?.remote_backend_session_id) {
    return row.remote_backend_session_id;
  }

  const sessRes = await fetch(`${root}/v1/agents/${agentId}/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "xuanjian" }),
  });
  if (!sessRes.ok) {
    throw new Error(`创建后端会话失败: ${sessRes.status}`);
  }
  const sess = (await sessRes.json()) as { id: string };
  const { updateAgentSession } = await import("@/lib/db");
  await updateAgentSession(input.sessionId, {
    remote_backend_session_id: sess.id,
  });
  return sess.id;
}

export async function runRemoteAgentTurn(input: RunAgentInput): Promise<void> {
  const { baseUrl, token } = await getBackendBase();
  if (!baseUrl) {
    input.onEvent({
      type: "error",
      text: "未配置后端地址（设置 → Agent → 后端 Base URL）",
    });
    input.onEvent({ type: "done" });
    return;
  }
  const agentId = input.remoteAgentId;
  if (!agentId) {
    input.onEvent({ type: "error", text: "未选择后端 Agent 应用" });
    input.onEvent({ type: "done" });
    return;
  }

  const root = baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let sid: string;
  try {
    sid = await resolveRemoteSessionId(input, root, agentId, headers);
  } catch (e) {
    input.onEvent({ type: "error", text: String(e) });
    input.onEvent({ type: "done" });
    return;
  }

  await fetch(`${root}/v1/agents/${agentId}/sessions/${sid}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: input.userText }),
  });

  const parts: MessagePart[] = [];
  const tokenQs = token ? `?token=${encodeURIComponent(token)}` : "";
  const es = new EventSource(
    `${root}/v1/agents/${agentId}/sessions/${sid}/events${tokenQs}`,
  );

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      es.close();
      resolve();
    };

    const onAbort = () => {
      input.onEvent({ type: "error", text: "已取消" });
      finish();
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });

    es.onmessage = (ev) => {
      void (async () => {
        try {
          const data = JSON.parse(ev.data) as {
            type: string;
            text?: string;
            tool?: {
              id: string;
              name: string;
              args?: Record<string, unknown>;
            };
          };
          if (data.type === "thinking" && data.text) {
            parts.push({ type: "thinking", text: data.text });
            input.onEvent({ type: "thinking", text: data.text });
          } else if (data.type === "token" && data.text) {
            parts.push({ type: "text", text: data.text });
            input.onEvent({ type: "text_delta", text: data.text });
          } else if (data.type === "tool_request" && data.tool) {
            const t = data.tool;
            input.onEvent({
              type: "tool_call",
              id: t.id,
              name: t.name,
              args: t.args ?? {},
            });
            const result = await executeLocalTool(t.name, t.args ?? {}, {
              permissionMode: input.permissionMode,
              confirmTool: async (info) => {
                input.onEvent({
                  type: "tool_pending",
                  id: t.id,
                  name: info.name,
                  args: info.args,
                  dangerous: info.dangerous,
                });
                if (!input.onConfirmTool) return false;
                return input.onConfirmTool({
                  id: t.id,
                  name: info.name,
                  args: info.args,
                  dangerous: info.dangerous,
                });
              },
            });
            input.onEvent({
              type: "tool_result",
              id: t.id,
              name: t.name,
              result,
            });
            await fetch(
              `${root}/v1/agents/${agentId}/sessions/${sid}/tool-results`,
              {
                method: "POST",
                headers,
                body: JSON.stringify({
                  id: t.id,
                  name: t.name,
                  result,
                }),
              },
            );
          } else if (data.type === "error") {
            input.onEvent({
              type: "error",
              text: data.text || "remote error",
            });
            finish();
          } else if (data.type === "done") {
            finish();
          }
        } catch {
          /* ignore */
        }
      })();
    };
    es.onerror = () => {
      if (!settled) {
        input.onEvent({ type: "error", text: "SSE 连接中断" });
      }
      finish();
    };
  });

  if (parts.length) {
    await appendAgentMessage({
      session_id: input.sessionId,
      role: "assistant",
      parts,
    });
  }
  input.onEvent({ type: "done" });
}
