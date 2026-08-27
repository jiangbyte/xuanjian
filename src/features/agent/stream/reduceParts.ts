/**
 * @file RuntimeEvent → MessagePart[] 纯函数 reducer
 */

import type { MessagePart } from "@/lib/db";
import type { RuntimeEvent } from "@xuanjian/agent-core";

/** 将单条 RuntimeEvent 合并进 assistant parts（不含 usage/activity/done） */
export function reduceParts(
  parts: MessagePart[],
  e: RuntimeEvent,
): MessagePart[] {
  if (
    e.type === "usage" ||
    e.type === "activity" ||
    e.type === "done"
  ) {
    return parts;
  }

  const cur = [...parts];
  const agentOf = "agent" in e ? (e as { agent?: string }).agent : undefined;
  const nestIntoSub = Boolean(
    agentOf &&
      agentOf !== "orchestrator" &&
      (e.type === "thinking" ||
        e.type === "thinking_delta" ||
        e.type === "text" ||
        e.type === "text_delta" ||
        e.type === "tool_call" ||
        e.type === "tool_result"),
  );

  const findRunningSubagent = (agent?: string) => {
    const si = cur.findIndex(
      (p) =>
        p.type === "subagent" &&
        p.status === "running" &&
        p.agent === agent,
    );
    if (si < 0) return null;
    const sub = cur[si];
    if (sub.type !== "subagent") return null;
    return { si, sub };
  };

  const pushChild = (child: MessagePart, agent?: string) => {
    const found = findRunningSubagent(agent ?? agentOf);
    if (!found) {
      cur.push(child);
      return;
    }
    const { si, sub } = found;
    cur[si] = {
      ...sub,
      children: [...(sub.children ?? []), child],
    };
  };

  const appendStreamInSub = (
    kind: "thinking" | "text",
    delta: string,
    agent?: string,
  ) => {
    const found = findRunningSubagent(agent);
    if (!found) {
      cur.push({ type: kind, text: delta, agent });
      return;
    }
    const { si, sub } = found;
    const children = [...(sub.children ?? [])];
    const last = children[children.length - 1];
    if (last?.type === kind && last.agent === agent) {
      children[children.length - 1] = {
        type: kind,
        text: last.text + delta,
        agent,
      };
    } else {
      children.push({ type: kind, text: delta, agent });
    }
    cur[si] = { ...sub, children };
  };

  const upsertChildToolPart = (part: MessagePart, agent?: string) => {
    if (
      part.type !== "tool_call" &&
      part.type !== "tool_pending" &&
      part.type !== "tool_result"
    ) {
      pushChild(part, agent);
      return;
    }
    const found = findRunningSubagent(agent);
    if (!found) {
      const i = cur.findIndex(
        (p) =>
          (p.type === "tool_call" || p.type === "tool_pending") &&
          p.id === part.id,
      );
      if (i >= 0) cur[i] = part;
      else cur.push(part);
      return;
    }
    const { si, sub } = found;
    const children = [...(sub.children ?? [])];
    const ci = children.findIndex(
      (c) =>
        (c.type === part.type ||
          (part.type === "tool_pending" &&
            (c.type === "tool_call" || c.type === "tool_pending")) ||
          (part.type === "tool_call" &&
            (c.type === "tool_call" || c.type === "tool_pending"))) &&
        c.id === part.id,
    );
    if (ci >= 0) children[ci] = part;
    else children.push(part);
    cur[si] = { ...sub, children };
  };

  const removePendingEverywhere = (id: string) => {
    for (let i = cur.length - 1; i >= 0; i--) {
      const p = cur[i];
      if (p.type === "tool_pending" && p.id === id) cur.splice(i, 1);
    }
    for (let i = 0; i < cur.length; i++) {
      const p = cur[i];
      if (p.type !== "subagent" || !p.children?.length) continue;
      cur[i] = {
        ...p,
        children: p.children.filter(
          (c) => !(c.type === "tool_pending" && c.id === id),
        ),
      };
    }
  };

  const appendStreamPart = (
    kind: "thinking" | "text",
    delta: string,
    agent?: string,
  ) => {
    if (nestIntoSub) {
      appendStreamInSub(kind, delta, agent);
      return;
    }
    const last = cur[cur.length - 1];
    if (last?.type === kind && last.agent === agent) {
      cur[cur.length - 1] = {
        type: kind,
        text: last.text + delta,
        agent,
      };
      return;
    }
    cur.push({ type: kind, text: delta, agent });
  };

  if (e.type === "thinking_delta") {
    appendStreamPart("thinking", e.text, e.agent);
  } else if (e.type === "text_delta") {
    appendStreamPart("text", e.text, e.agent);
  } else if (e.type === "thinking") {
    if (nestIntoSub) appendStreamInSub("thinking", e.text, e.agent);
    else cur.push({ type: "thinking", text: e.text, agent: e.agent });
  } else if (e.type === "text") {
    if (nestIntoSub) {
      appendStreamInSub("text", e.text, e.agent);
    } else {
      const last = cur[cur.length - 1];
      if (last?.type === "text" && last.agent === e.agent) {
        cur[cur.length - 1] = {
          type: "text",
          text: last.text + e.text,
          agent: e.agent,
        };
      } else {
        cur.push({ type: "text", text: e.text, agent: e.agent });
      }
    }
  } else if (e.type === "tool_call") {
    const part: MessagePart = {
      type: "tool_call",
      id: e.id,
      name: e.name,
      args: e.args,
      agent: e.agent,
    };
    removePendingEverywhere(e.id);
    if (nestIntoSub) upsertChildToolPart(part, e.agent);
    else {
      const i = cur.findIndex(
        (p) =>
          (p.type === "tool_call" || p.type === "tool_pending") &&
          p.id === e.id,
      );
      if (i >= 0) cur[i] = part;
      else cur.push(part);
    }
  } else if (e.type === "tool_pending") {
    const pending: MessagePart = {
      type: "tool_pending",
      id: e.id,
      name: e.name,
      args: e.args,
      dangerous: e.dangerous,
      agent: e.agent,
    };
    removePendingEverywhere(e.id);
    const i = cur.findIndex(
      (p) =>
        (p.type === "tool_call" || p.type === "tool_pending") &&
        p.id === e.id,
    );
    if (i >= 0) cur[i] = pending;
    else cur.push(pending);
  } else if (e.type === "tool_result") {
    const resultPart: MessagePart = {
      type: "tool_result",
      id: e.id,
      name: e.name,
      result: e.result,
      agent: e.agent,
    };
    removePendingEverywhere(e.id);
    if (nestIntoSub) upsertChildToolPart(resultPart, e.agent);
    else cur.push(resultPart);
  } else if (e.type === "subagent_start") {
    cur.push({
      type: "subagent",
      id: e.id,
      agent: e.agent,
      label: e.label,
      task: e.task,
      status: "running",
      children: [],
    });
  } else if (e.type === "subagent_end") {
    const i = cur.findIndex((p) => p.type === "subagent" && p.id === e.id);
    if (i >= 0 && cur[i].type === "subagent") {
      cur[i] = {
        ...cur[i],
        status: e.ok ? "done" : "error",
        summary: e.summary,
        children: e.children ?? cur[i].children,
      };
    }
  } else if (e.type === "plan") {
    cur.push({ type: "plan", items: e.items });
  } else if (e.type === "status") {
    cur.push({ type: "status", text: e.text });
  } else if (e.type === "error") {
    cur.push({ type: "text", text: `错误：${e.text}` });
  }

  return cur;
}
