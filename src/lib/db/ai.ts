/**
 * @file AI 供应商 / 模型 / MCP / Agent 会话数据访问
 * @author Charlie
 */

import { getDb } from "@/lib/db/client";

export type AiApiFormat = "openai" | "anthropic" | "responses";

export type AiProviderRow = {
  id: number;
  name: string;
  base_url: string;
  api_format: AiApiFormat;
  api_key_enc: string;
  enabled: number;
  sort_order: number;
  created_at?: string;
};

export type AiModelRow = {
  id: number;
  provider_id: number;
  model_id: string;
  label: string;
  /** 上下文窗口，存数字或 128k/1M 标签 */
  context_tag: string;
  /** 最大输出 token；0 表示用默认 */
  max_output_tokens: number;
  enabled: number;
  sort_order: number;
};

export type McpServerRow = {
  id: number;
  name: string;
  transport: "stdio" | "sse" | "http";
  command: string | null;
  args_json: string | null;
  url: string | null;
  env_json: string | null;
  enabled: number;
  scope: "local" | "remote";
  sort_order: number;
  created_at?: string;
};

export type AgentPermissionMode = "confirm" | "plan" | "full";

export type AgentSessionRow = {
  id: number;
  title: string;
  model_ref: string | null;
  permission_mode: AgentPermissionMode;
  host_id: number | null;
  tab_id: string | null;
  created_at?: string;
  updated_at?: string;
};

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

export type AgentMessageRow = {
  id: number;
  session_id: number;
  role: "user" | "assistant" | "system" | "tool";
  parts_json: string;
  created_at?: string;
};

export async function listAiProviders(): Promise<AiProviderRow[]> {
  const db = await getDb();
  return db.select<AiProviderRow[]>(
    "SELECT * FROM ai_providers ORDER BY sort_order, id",
  );
}

export async function createAiProvider(input: {
  name: string;
  base_url: string;
  api_format: AiApiFormat;
  api_key_enc?: string;
}): Promise<number> {
  const db = await getDb();
  const maxRows = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM ai_providers",
  );
  const sort = (maxRows[0]?.m ?? -1) + 1;
  const result = await db.execute(
    `INSERT INTO ai_providers (name, base_url, api_format, api_key_enc, sort_order)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.name.trim(),
      input.base_url.trim(),
      input.api_format,
      input.api_key_enc ?? "",
      sort,
    ],
  );
  return result.lastInsertId as number;
}

export async function updateAiProvider(
  id: number,
  patch: Partial<{
    name: string;
    base_url: string;
    api_format: AiApiFormat;
    api_key_enc: string;
    enabled: boolean;
  }>,
) {
  const db = await getDb();
  const cur = (
    await db.select<AiProviderRow[]>("SELECT * FROM ai_providers WHERE id = $1", [
      id,
    ])
  )[0];
  if (!cur) throw new Error("provider not found");
  await db.execute(
    `UPDATE ai_providers SET name=$1, base_url=$2, api_format=$3, api_key_enc=$4, enabled=$5 WHERE id=$6`,
    [
      patch.name ?? cur.name,
      patch.base_url ?? cur.base_url,
      patch.api_format ?? cur.api_format,
      patch.api_key_enc ?? cur.api_key_enc,
      patch.enabled == null ? cur.enabled : patch.enabled ? 1 : 0,
      id,
    ],
  );
}

export async function deleteAiProvider(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM ai_models WHERE provider_id = $1", [id]);
  await db.execute("DELETE FROM ai_providers WHERE id = $1", [id]);
}

export async function listAiModels(providerId?: number): Promise<AiModelRow[]> {
  const db = await getDb();
  const rows =
    providerId == null
      ? await db.select<AiModelRow[]>(
          "SELECT * FROM ai_models ORDER BY sort_order, id",
        )
      : await db.select<AiModelRow[]>(
          "SELECT * FROM ai_models WHERE provider_id = $1 ORDER BY sort_order, id",
          [providerId],
        );
  return rows.map((r) => ({
    ...r,
    max_output_tokens: r.max_output_tokens ?? 0,
    context_tag: r.context_tag ?? "",
  }));
}

export async function createAiModel(input: {
  provider_id: number;
  model_id: string;
  label?: string;
  context_tag?: string;
  max_output_tokens?: number;
}): Promise<number> {
  const db = await getDb();
  const maxRows = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM ai_models WHERE provider_id = $1",
    [input.provider_id],
  );
  const sort = (maxRows[0]?.m ?? -1) + 1;
  const result = await db.execute(
    `INSERT INTO ai_models (provider_id, model_id, label, context_tag, max_output_tokens, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.provider_id,
      input.model_id.trim(),
      input.label?.trim() || input.model_id.trim(),
      input.context_tag ?? "",
      input.max_output_tokens ?? 0,
      sort,
    ],
  );
  return result.lastInsertId as number;
}

export async function updateAiModel(
  id: number,
  patch: Partial<{
    model_id: string;
    label: string;
    context_tag: string;
    max_output_tokens: number;
    enabled: boolean;
  }>,
) {
  const db = await getDb();
  const cur = (
    await db.select<AiModelRow[]>("SELECT * FROM ai_models WHERE id = $1", [id])
  )[0];
  if (!cur) throw new Error("model not found");
  await db.execute(
    `UPDATE ai_models SET model_id=$1, label=$2, context_tag=$3, max_output_tokens=$4, enabled=$5 WHERE id=$6`,
    [
      patch.model_id ?? cur.model_id,
      patch.label ?? cur.label,
      patch.context_tag ?? cur.context_tag,
      patch.max_output_tokens ?? cur.max_output_tokens ?? 0,
      patch.enabled == null ? cur.enabled : patch.enabled ? 1 : 0,
      id,
    ],
  );
}

export async function deleteAiModel(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM ai_models WHERE id = $1", [id]);
}

export async function listMcpServers(): Promise<McpServerRow[]> {
  const db = await getDb();
  return db.select<McpServerRow[]>(
    "SELECT * FROM mcp_servers ORDER BY sort_order, id",
  );
}

export async function createMcpServer(input: {
  name: string;
  transport: McpServerRow["transport"];
  url?: string;
  command?: string;
  args_json?: string;
  scope?: "local" | "remote";
}): Promise<number> {
  const db = await getDb();
  const maxRows = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM mcp_servers",
  );
  const sort = (maxRows[0]?.m ?? -1) + 1;
  const result = await db.execute(
    `INSERT INTO mcp_servers (name, transport, url, command, args_json, scope, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.name.trim(),
      input.transport,
      input.url ?? null,
      input.command ?? null,
      input.args_json ?? null,
      input.scope ?? "local",
      sort,
    ],
  );
  return result.lastInsertId as number;
}

export async function updateMcpServer(
  id: number,
  patch: Partial<{
    name: string;
    transport: McpServerRow["transport"];
    url: string | null;
    command: string | null;
    enabled: boolean;
  }>,
) {
  const db = await getDb();
  const cur = (
    await db.select<McpServerRow[]>("SELECT * FROM mcp_servers WHERE id = $1", [
      id,
    ])
  )[0];
  if (!cur) throw new Error("mcp server not found");
  await db.execute(
    `UPDATE mcp_servers SET name=$1, transport=$2, url=$3, command=$4, enabled=$5 WHERE id=$6`,
    [
      patch.name ?? cur.name,
      patch.transport ?? cur.transport,
      patch.url === undefined ? cur.url : patch.url,
      patch.command === undefined ? cur.command : patch.command,
      patch.enabled == null ? cur.enabled : patch.enabled ? 1 : 0,
      id,
    ],
  );
}

export async function deleteMcpServer(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM mcp_servers WHERE id = $1", [id]);
}

export async function findAgentSessionByTabId(
  tabId: string,
): Promise<AgentSessionRow | null> {
  const db = await getDb();
  const rows = await db.select<AgentSessionRow[]>(
    "SELECT * FROM agent_sessions WHERE tab_id = $1 ORDER BY datetime(updated_at) DESC, id DESC LIMIT 1",
    [tabId],
  );
  return rows[0] ?? null;
}

export async function clearAgentSessionTabBinding(
  tabId: string,
  keepSessionId?: number,
) {
  const db = await getDb();
  if (keepSessionId != null) {
    await db.execute(
      "UPDATE agent_sessions SET tab_id = NULL WHERE tab_id = $1 AND id != $2",
      [tabId, keepSessionId],
    );
  } else {
    await db.execute(
      "UPDATE agent_sessions SET tab_id = NULL WHERE tab_id = $1",
      [tabId],
    );
  }
}

export async function listAgentSessions(): Promise<AgentSessionRow[]> {
  const db = await getDb();
  return db.select<AgentSessionRow[]>(
    "SELECT * FROM agent_sessions ORDER BY datetime(updated_at) DESC, id DESC",
  );
}

export async function createAgentSession(input?: {
  title?: string;
  model_ref?: string | null;
  permission_mode?: AgentPermissionMode;
  host_id?: number | null;
  tab_id?: string | null;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO agent_sessions
      (title, model_ref, permission_mode, host_id, tab_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input?.title?.trim() || "新对话",
      input?.model_ref ?? null,
      input?.permission_mode ?? "confirm",
      input?.host_id ?? null,
      input?.tab_id ?? null,
    ],
  );
  return result.lastInsertId as number;
}

export async function updateAgentSession(
  id: number,
  patch: Partial<{
    title: string;
    model_ref: string | null;
    permission_mode: AgentPermissionMode;
    host_id: number | null;
    tab_id: string | null;
  }>,
) {
  const db = await getDb();
  const cur = (
    await db.select<AgentSessionRow[]>(
      "SELECT * FROM agent_sessions WHERE id = $1",
      [id],
    )
  )[0];
  if (!cur) throw new Error("session not found");
  await db.execute(
    `UPDATE agent_sessions SET
      title=$1, model_ref=$2, permission_mode=$3, host_id=$4, tab_id=$5,
      updated_at=datetime('now')
     WHERE id=$6`,
    [
      patch.title ?? cur.title,
      patch.model_ref === undefined ? cur.model_ref : patch.model_ref,
      patch.permission_mode ?? cur.permission_mode,
      patch.host_id === undefined ? cur.host_id : patch.host_id,
      patch.tab_id === undefined ? cur.tab_id : patch.tab_id,
      id,
    ],
  );
}

export async function deleteAgentSession(id: number) {
  const db = await getDb();
  await db.execute("DELETE FROM agent_messages WHERE session_id = $1", [id]);
  await db.execute("DELETE FROM agent_sessions WHERE id = $1", [id]);
}

export async function listAgentMessages(
  sessionId: number,
): Promise<AgentMessageRow[]> {
  const db = await getDb();
  return db.select<AgentMessageRow[]>(
    "SELECT * FROM agent_messages WHERE session_id = $1 ORDER BY id",
    [sessionId],
  );
}

export async function appendAgentMessage(input: {
  session_id: number;
  role: AgentMessageRow["role"];
  parts: MessagePart[];
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO agent_messages (session_id, role, parts_json) VALUES ($1, $2, $3)`,
    [input.session_id, input.role, JSON.stringify(input.parts)],
  );
  await db.execute(
    `UPDATE agent_sessions SET updated_at=datetime('now') WHERE id=$1`,
    [input.session_id],
  );
  return result.lastInsertId as number;
}

export function parseMessageParts(partsJson: string): MessagePart[] {
  try {
    const v = JSON.parse(partsJson) as MessagePart[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [{ type: "text", text: partsJson }];
  }
}

/** model_ref 格式：`providerId:modelId` */
export function encodeModelRef(providerId: number, modelId: string) {
  return `${providerId}:${modelId}`;
}

export function decodeModelRef(
  ref: string | null | undefined,
): { providerId: number; modelId: string } | null {
  if (!ref) return null;
  const i = ref.indexOf(":");
  if (i <= 0) return null;
  const providerId = Number(ref.slice(0, i));
  const modelId = ref.slice(i + 1);
  if (!Number.isFinite(providerId) || !modelId) return null;
  return { providerId, modelId };
}
