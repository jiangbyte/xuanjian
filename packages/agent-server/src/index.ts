/**
 * @file 玄鉴 Agent 远程编排服务（SSE + 工具回调桌面端）
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.AGENT_SERVER_PORT ?? "18766");
const TOKEN = process.env.AGENT_SERVER_TOKEN ?? "";

type AgentDef = { id: string; name: string; description: string };
type Session = {
  id: string;
  agentId: string;
  events: Array<Record<string, unknown>>;
  listeners: Set<(data: string) => void>;
  pendingTool: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    resolve: (result: string) => void;
  } | null;
};

const AGENTS: AgentDef[] = [
  {
    id: "xuanjian-ops",
    name: "玄鉴运维 Agent",
    description: "远程编排；工具在桌面端执行",
  },
];

const sessions = new Map<string, Session>();

function auth(req: IncomingMessage): boolean {
  if (!TOKEN) return true;
  const h = req.headers.authorization ?? "";
  if (h === `Bearer ${TOKEN}`) return true;
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  return url.searchParams.get("token") === TOKEN;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function pushEvent(session: Session, event: Record<string, unknown>) {
  session.events.push(event);
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const l of session.listeners) l(line);
}

async function runTurn(session: Session, userText: string) {
  pushEvent(session, { type: "thinking", text: "分析任务中…" });
  pushEvent(session, {
    type: "token",
    text: `已收到：${userText.slice(0, 200)}。远程 Agent 服务仅做编排演示；复杂任务请使用本地 Agent。`,
  });
  pushEvent(session, { type: "done" });
}

const server = createServer(async (req, res) => {
  if (!auth(req)) {
    json(res, 401, { error: "unauthorized" });
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && parts.join("/") === "v1/agents") {
    json(res, 200, { agents: AGENTS });
    return;
  }

  const mCreate = url.pathname.match(
    /^\/v1\/agents\/([^/]+)\/sessions$/,
  );
  if (req.method === "POST" && mCreate) {
    const agentId = decodeURIComponent(mCreate[1]);
    if (!AGENTS.some((a) => a.id === agentId)) {
      json(res, 404, { error: "agent not found" });
      return;
    }
    const id = randomUUID();
    sessions.set(id, {
      id,
      agentId,
      events: [],
      listeners: new Set(),
      pendingTool: null,
    });
    json(res, 200, { id });
    return;
  }

  const mMsg = url.pathname.match(
    /^\/v1\/agents\/([^/]+)\/sessions\/([^/]+)\/messages$/,
  );
  if (req.method === "POST" && mMsg) {
    const sid = decodeURIComponent(mMsg[2]);
    const session = sessions.get(sid);
    if (!session) {
      json(res, 404, { error: "session not found" });
      return;
    }
    const body = JSON.parse((await readBody(req)) || "{}") as {
      content?: string;
    };
    void runTurn(session, body.content ?? "");
    json(res, 200, { ok: true });
    return;
  }

  const mTool = url.pathname.match(
    /^\/v1\/agents\/([^/]+)\/sessions\/([^/]+)\/tool-results$/,
  );
  if (req.method === "POST" && mTool) {
    const sid = decodeURIComponent(mTool[2]);
    const session = sessions.get(sid);
    if (!session?.pendingTool) {
      json(res, 400, { error: "no pending tool" });
      return;
    }
    const body = JSON.parse((await readBody(req)) || "{}") as {
      result?: string;
    };
    session.pendingTool.resolve(body.result ?? "");
    session.pendingTool = null;
    json(res, 200, { ok: true });
    return;
  }

  const mEvents = url.pathname.match(
    /^\/v1\/agents\/([^/]+)\/sessions\/([^/]+)\/events$/,
  );
  if (req.method === "GET" && mEvents) {
    const sid = decodeURIComponent(mEvents[2]);
    const session = sessions.get(sid);
    if (!session) {
      json(res, 404, { error: "session not found" });
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (line: string) => res.write(line);
    session.listeners.add(send);
    req.on("close", () => session.listeners.delete(send));
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`xuanjian agent-server listening on http://127.0.0.1:${PORT}`);
});
