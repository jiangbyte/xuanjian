/**
 * @file 终端右侧 AI 对话面板
 * @author Charlie
 * @description 侧栏内完整 Agent 对话：历史抽屉、气泡/思考/工具卡、模型·Agent·权限选择。
 */

import {
  Bot,
  Brain,
  History,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Square,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  estimateContextBudget,
  formatTokenCount,
  historyTextFromUiMessages,
  inTurnPartsEstimate,
  loadThinkingMode,
  mergeUsage,
  parseContextWindow,
  saveLastAgentSessionId,
  saveThinkingMode,
  type LlmUsage,
  type ThinkingMode,
} from "@/lib/agent/contextBudget";
import { buildOrchestratorSystemPrompt } from "@/lib/agent/prompts";
import { toolsForOrchestrator } from "@/lib/agent/subagents";
import { runAgentTurn } from "@/lib/agent/runtime";
import type { AgentActivityPhase } from "@/lib/agent/types";
import { discoverRemoteAgents } from "@/lib/agent/remoteClient";
import { BUILTIN_MCP_SERVER } from "@/lib/agent/mcpBuiltin";
import {
  appendAgentMessage,
  clearAgentSessionTabBinding,
  createAgentSession,
  deleteAgentSession,
  encodeModelRef,
  findAgentSessionByTabId,
  listAgentMessages,
  listAgentSessions,
  listAiModels,
  listAiProviders,
  listRemoteAgents,
  parseMessageParts,
  updateAgentSession,
  upsertRemoteAgent,
  type AgentMessageRow,
  type AgentPermissionMode,
  type AgentRuntimeKind,
  type AgentSessionRow,
  type AiModelRow,
  type AiProviderRow,
  type MessagePart,
  type RemoteAgentRow,
} from "@/lib/db";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/features/workspace/WorkspaceSwitcher";
import { useUiStore } from "@/stores/ui";

type LiveMsg = {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
};

void BUILTIN_MCP_SERVER;

export function AiChatPanel() {
  const { t } = useTranslation();
  const activeTabId = useUiStore((s) => s.activeTabId);
  const tabs = useUiStore((s) => s.tabs);
  const activeTab = tabs.find((x) => x.id === activeTabId) ?? null;

  const [sessions, setSessions] = useState<AgentSessionRow[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<LiveMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<{
    phase: AgentActivityPhase;
    label: string;
    detail?: string;
  }>({ phase: "idle", label: "" });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [histQ, setHistQ] = useState("");

  const [providers, setProviders] = useState<AiProviderRow[]>([]);
  const [models, setModels] = useState<AiModelRow[]>([]);
  const [remoteAgents, setRemoteAgents] = useState<RemoteAgentRow[]>([]);

  const [runtime, setRuntime] = useState<AgentRuntimeKind>("local");
  const [remoteAgentId, setRemoteAgentId] = useState<string>("");
  const [modelRef, setModelRef] = useState<string>("");
  const [permissionMode, setPermissionMode] =
    useState<AgentPermissionMode>("confirm");
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>(() =>
    loadThinkingMode(),
  );
  /** 最近一次模型调用的 API usage（含 cache） */
  const [lastUsage, setLastUsage] = useState<LlmUsage | null>(null);
  /** 当前会话累计 usage（本轮 busy 内多次 ReAct） */
  const [sessionUsage, setSessionUsage] = useState<LlmUsage | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const confirmWaiters = useRef(
    new Map<string, (ok: boolean) => void>(),
  );

  const resolveConfirm = useCallback((id: string, ok: boolean) => {
    const w = confirmWaiters.current.get(id);
    if (w) {
      confirmWaiters.current.delete(id);
      w(ok);
    }
  }, []);

  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
    for (const [, resolve] of confirmWaiters.current) resolve(false);
    confirmWaiters.current.clear();
    setActivity({ phase: "idle", label: "" });
    setBusy(false);
  }, []);

  const modelOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (const p of providers.filter((x) => x.enabled)) {
      for (const m of models.filter(
        (x) => x.provider_id === p.id && x.enabled,
      )) {
        opts.push({
          value: encodeModelRef(p.id, m.model_id),
          label: `${p.name}/${m.label || m.model_id}`,
        });
      }
    }
    return opts;
  }, [providers, models]);

  const pendingConfirms = useMemo(() => {
    const out: Extract<MessagePart, { type: "tool_pending" }>[] = [];
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const p of m.parts) {
        if (p.type === "tool_pending") out.push(p);
      }
    }
    return out;
  }, [messages]);

  const reloadMeta = useCallback(async () => {
    const [p, m, s, ra] = await Promise.all([
      listAiProviders(),
      listAiModels(),
      listAgentSessions(),
      listRemoteAgents(),
    ]);
    setProviders(p);
    setModels(m);
    setSessions(s);
    setRemoteAgents(ra);
    if (!modelRef && p.length && m.length) {
      const first = m.find((x) => x.enabled);
      if (first) setModelRef(encodeModelRef(first.provider_id, first.model_id));
    }
  }, [modelRef]);

  const loadSession = useCallback(async (id: number) => {
    setSessionId(id);
    saveLastAgentSessionId(id);
    setLastUsage(null);
    setSessionUsage(null);
    const rows = await listAgentMessages(id);
    setMessages(
      rows.map((r: AgentMessageRow) => ({
        id: String(r.id),
        role: r.role === "user" ? "user" : "assistant",
        parts: parseMessageParts(r.parts_json),
      })),
    );
    const sess = (await listAgentSessions()).find((x) => x.id === id);
    if (sess) {
      setRuntime(sess.runtime);
      setRemoteAgentId(sess.remote_agent_id ?? "");
      setModelRef(sess.model_ref ?? "");
      setPermissionMode(sess.permission_mode);
    }
  }, []);

  const ensureSession = useCallback(async () => {
    if (sessionId != null) {
      saveLastAgentSessionId(sessionId);
      return sessionId;
    }
    if (!activeTabId) {
      throw new Error("no active terminal tab");
    }
    const id = await createAgentSession({
      title: activeTab?.title?.trim() || t("terminal.aiNewChat"),
      runtime,
      remote_agent_id: remoteAgentId || null,
      model_ref: modelRef || null,
      permission_mode: permissionMode,
      host_id: activeTab?.hostId ?? null,
      tab_id: activeTabId,
    });
    await clearAgentSessionTabBinding(activeTabId, id);
    await reloadMeta();
    setSessionId(id);
    saveLastAgentSessionId(id);
    return id;
  }, [
    sessionId,
    activeTabId,
    activeTab,
    runtime,
    remoteAgentId,
    modelRef,
    permissionMode,
    reloadMeta,
    t,
  ]);

  const bindTabSession = useCallback(
    async (tabId: string | null) => {
      if (!tabId) {
        setSessionId(null);
        setMessages([]);
        setLastUsage(null);
        setSessionUsage(null);
        return;
      }
      const tab = tabs.find((t) => t.id === tabId);
      const existing = await findAgentSessionByTabId(tabId);
      if (existing) {
        await loadSession(existing.id);
        return;
      }
      const id = await createAgentSession({
        title: tab?.title?.trim() || t("terminal.aiNewChat"),
        runtime,
        remote_agent_id: remoteAgentId || null,
        model_ref: modelRef || null,
        permission_mode: permissionMode,
        host_id: tab?.hostId ?? null,
        tab_id: tabId,
      });
      await reloadMeta();
      setSessionId(id);
      setMessages([]);
      setLastUsage(null);
      setSessionUsage(null);
      saveLastAgentSessionId(id);
    },
    [
      tabs,
      runtime,
      remoteAgentId,
      modelRef,
      permissionMode,
      loadSession,
      reloadMeta,
      t,
    ],
  );

  useEffect(() => {
    void reloadMeta().catch(console.error);
  }, [reloadMeta]);

  const lastBoundTabRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeTabId === lastBoundTabRef.current) return;
    lastBoundTabRef.current = activeTabId;
    void bindTabSession(activeTabId).catch(console.error);
  }, [activeTabId, bindTabSession]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, activity.label]);

  const filteredSessions = useMemo(() => {
    const q = histQ.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, histQ]);

  const send = async () => {
    const content = text.trim();
    if (!content || busy) return;
    setText("");
    setBusy(true);
    setLastUsage(null);
    setSessionUsage(null);
    setActivity({ phase: "planning", label: t("terminal.aiActivityStarting") });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const sid = await ensureSession();
      await appendAgentMessage({
        session_id: sid,
        role: "user",
        parts: [{ type: "text", text: content }],
      });
      const userMsg: LiveMsg = {
        id: `u-${Date.now()}`,
        role: "user",
        parts: [{ type: "text", text: content }],
      };
      const asstId = `a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: asstId, role: "assistant", parts: [] },
      ]);

      await updateAgentSession(sid, {
        runtime,
        remote_agent_id: remoteAgentId || null,
        model_ref: modelRef || null,
        permission_mode: permissionMode,
        title: content.slice(0, 40),
      });

      const history = [...messages, userMsg]
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.parts
            .filter((p): p is Extract<MessagePart, { type: "text" }> =>
              p.type === "text",
            )
            .map((p) => p.text)
            .join("\n"),
        }))
        .filter((m) => m.content.trim());

      await runAgentTurn({
        sessionId: sid,
        userText: content,
        runtime,
        remoteAgentId: remoteAgentId || null,
        modelRef: modelRef || null,
        permissionMode,
        thinkingMode,
        history: history.slice(0, -1),
        signal: ac.signal,
        onConfirmTool: (req) =>
          new Promise<boolean>((resolve) => {
            confirmWaiters.current.set(req.id, resolve);
          }),
        onEvent: (e) => {
          if (e.type === "usage") {
            setLastUsage(e.usage);
            setSessionUsage((prev) => mergeUsage(prev, e.usage));
            return;
          }
          if (e.type === "activity") {
            setActivity({
              phase: e.phase,
              label: e.label,
              detail: e.detail,
            });
            return;
          }
          setMessages((prev) => {
            const next = [...prev];
            const idx = next.findIndex((m) => m.id === asstId);
            if (idx < 0) return prev;
            const cur = { ...next[idx], parts: [...next[idx].parts] };

            const agentOf =
              "agent" in e ? (e as { agent?: string }).agent : undefined;
            // 待确认必须顶层可见，不可塞进 SubAgent 折叠子轨迹
            const nestIntoSub = Boolean(
              agentOf &&
                agentOf !== "orchestrator" &&
                (e.type === "thinking" ||
                  e.type === "text" ||
                  e.type === "tool_call" ||
                  e.type === "tool_result"),
            );

            const pushChild = (child: MessagePart) => {
              const si = cur.parts.findIndex(
                (p) =>
                  p.type === "subagent" &&
                  p.status === "running" &&
                  p.agent === (e as { agent?: string }).agent,
              );
              if (si < 0) {
                cur.parts.push(child);
                return;
              }
              const sub = cur.parts[si];
              if (sub.type !== "subagent") return;
              cur.parts[si] = {
                ...sub,
                children: [...(sub.children ?? []), child],
              };
            };

            const removePendingEverywhere = (id: string) => {
              cur.parts = cur.parts.filter(
                (p) => !(p.type === "tool_pending" && p.id === id),
              );
              for (let i = 0; i < cur.parts.length; i++) {
                const p = cur.parts[i];
                if (p.type !== "subagent" || !p.children?.length) continue;
                cur.parts[i] = {
                  ...p,
                  children: p.children.filter(
                    (c) => !(c.type === "tool_pending" && c.id === id),
                  ),
                };
              }
            };

            if (e.type === "thinking") {
              const part: MessagePart = {
                type: "thinking",
                text: e.text,
                agent: e.agent,
              };
              if (nestIntoSub) pushChild(part);
              else cur.parts.push(part);
            } else if (e.type === "text") {
              if (nestIntoSub) {
                pushChild({
                  type: "text",
                  text: e.text,
                  agent: e.agent,
                });
              } else {
                const last = cur.parts[cur.parts.length - 1];
                if (last?.type === "text" && last.agent === e.agent) {
                  cur.parts[cur.parts.length - 1] = {
                    type: "text",
                    text: last.text + e.text,
                    agent: e.agent,
                  };
                } else {
                  cur.parts.push({
                    type: "text",
                    text: e.text,
                    agent: e.agent,
                  });
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
              if (nestIntoSub) pushChild(part);
              else cur.parts.push(part);
            } else if (e.type === "tool_pending") {
              // 始终顶层展示，避免藏在「展开子轨迹」里
              const pending: MessagePart = {
                type: "tool_pending",
                id: e.id,
                name: e.name,
                args: e.args,
                dangerous: e.dangerous,
                agent: e.agent,
              };
              removePendingEverywhere(e.id);
              const i = cur.parts.findIndex(
                (p) =>
                  (p.type === "tool_call" || p.type === "tool_pending") &&
                  p.id === e.id,
              );
              if (i >= 0) cur.parts[i] = pending;
              else cur.parts.push(pending);
            } else if (e.type === "tool_result") {
              const resultPart: MessagePart = {
                type: "tool_result",
                id: e.id,
                name: e.name,
                result: e.result,
                agent: e.agent,
              };
              removePendingEverywhere(e.id);
              if (nestIntoSub) pushChild(resultPart);
              else cur.parts.push(resultPart);
            } else if (e.type === "subagent_start") {
              cur.parts.push({
                type: "subagent",
                id: e.id,
                agent: e.agent,
                label: e.label,
                task: e.task,
                status: "running",
                children: [],
              });
            } else if (e.type === "subagent_end") {
              const i = cur.parts.findIndex(
                (p) => p.type === "subagent" && p.id === e.id,
              );
              if (i >= 0 && cur.parts[i].type === "subagent") {
                cur.parts[i] = {
                  ...cur.parts[i],
                  status: e.ok ? "done" : "error",
                  summary: e.summary,
                  children: e.children ?? cur.parts[i].children,
                };
              }
            } else if (e.type === "plan") {
              cur.parts.push({ type: "plan", items: e.items });
            } else if (e.type === "status") {
              cur.parts.push({ type: "status", text: e.text });
            } else if (e.type === "error") {
              cur.parts.push({ type: "text", text: `错误：${e.text}` });
            }
            next[idx] = cur;
            return next;
          });
        },
      });
      await reloadMeta();
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("已取消")) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            parts: [{ type: "text", text: msg }],
          },
        ]);
      }
    } finally {
      abortRef.current = null;
      setActivity({ phase: "idle", label: "" });
      setBusy(false);
    }
  };

  const refreshRemote = async () => {
    try {
      const list = await discoverRemoteAgents();
      for (const a of list) {
        await upsertRemoteAgent({
          id: a.id,
          name: a.name,
          description: a.description,
        });
      }
      await reloadMeta();
    } catch (e) {
      console.error(e);
    }
  };

  const modelShort = useMemo(() => {
    const o = modelOptions.find((x) => x.value === modelRef);
    if (!o) return t("terminal.aiPickModel");
    const parts = o.label.split("/");
    return parts[parts.length - 1] || o.label;
  }, [modelOptions, modelRef, t]);

  const contextLimit = useMemo(() => {
    const decoded = modelRef.includes(":")
      ? {
          providerId: Number(modelRef.slice(0, modelRef.indexOf(":"))),
          modelId: modelRef.slice(modelRef.indexOf(":") + 1),
        }
      : null;
    const row = models.find(
      (m) =>
        decoded &&
        m.provider_id === decoded.providerId &&
        m.model_id === decoded.modelId,
    );
    return parseContextWindow(row?.context_tag || "128k");
  }, [modelRef, models]);

  const contextBudget = useMemo(() => {
    const hist = historyTextFromUiMessages(messages);
    const inTurn = inTurnPartsEstimate(messages);
    return estimateContextBudget({
      systemPrompt: buildOrchestratorSystemPrompt(permissionMode),
      history: hist,
      inTurnExtra: inTurn,
      tools: toolsForOrchestrator(permissionMode),
      draft: text,
      contextLimit,
      lastUsage,
      sessionUsage,
    });
  }, [
    messages,
    text,
    contextLimit,
    permissionMode,
    lastUsage,
    sessionUsage,
  ]);

  const agentShort =
    runtime === "local"
      ? t("terminal.aiLocalAgent")
      : remoteAgents.find((a) => a.id === remoteAgentId)?.name ||
        t("terminal.aiLocalAgent");

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* 顶栏 */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center gap-2 px-2.5 py-2">
          <Sparkles size={14} className="shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium leading-tight">
              {t("terminal.aiTitle")}
            </div>
            {activeTab ? (
              <div className="truncate text-[11px] leading-tight text-muted-foreground">
                {activeTab.title}
                {activeTab.hostId != null ? ` · #${activeTab.hostId}` : ""}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-7"
                  onClick={async () => {
                    if (!activeTabId) {
                      setSessionId(null);
                      setMessages([]);
                      setLastUsage(null);
                      setSessionUsage(null);
                      saveLastAgentSessionId(null);
                      return;
                    }
                    const id = await createAgentSession({
                      title: activeTab?.title?.trim() || t("terminal.aiNewChat"),
                      runtime,
                      remote_agent_id: remoteAgentId || null,
                      model_ref: modelRef || null,
                      permission_mode: permissionMode,
                      host_id: activeTab?.hostId ?? null,
                      tab_id: activeTabId,
                    });
                    await clearAgentSessionTabBinding(activeTabId, id);
                    await reloadMeta();
                    setSessionId(id);
                    setMessages([]);
                    setLastUsage(null);
                    setSessionUsage(null);
                    saveLastAgentSessionId(id);
                  }}
                  aria-label={t("terminal.aiNewChat")}
                >
                  <Plus size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{t("terminal.aiNewChat")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={historyOpen ? "secondary" : "ghost"}
                  className="size-7"
                  onClick={() => setHistoryOpen((v) => !v)}
                  aria-label={t("terminal.aiHistory")}
                >
                  <History size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{t("terminal.aiHistory")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <WorkspaceSwitcher />
      </div>

      {/* 消息区 */}
      <div className="relative min-h-0 flex-1">
        {historyOpen ? (
          <div className="absolute inset-0 z-20 flex flex-col bg-sidebar">
            <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
              <input
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                placeholder={t("terminal.aiSearchHistory")}
                value={histQ}
                onChange={(e) => setHistQ(e.currentTarget.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setHistoryOpen(false)}
              >
                {t("terminal.aiClose")}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {filteredSessions.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {t("terminal.aiNoHistory")}
                </p>
              ) : (
                filteredSessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={cn(
                      "mb-0.5 flex w-full flex-col rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-sidebar-accent",
                      sessionId === s.id && "bg-sidebar-accent",
                    )}
                    onClick={() => {
                      void (async () => {
                        await loadSession(s.id);
                        if (activeTabId) {
                          await updateAgentSession(s.id, { tab_id: activeTabId });
                          await clearAgentSessionTabBinding(activeTabId, s.id);
                          await reloadMeta();
                        }
                        setHistoryOpen(false);
                      })();
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (window.confirm(t("terminal.aiDeleteChat"))) {
                        void deleteAgentSession(s.id).then(reloadMeta);
                        if (sessionId === s.id) {
                          setSessionId(null);
                          setMessages([]);
                          saveLastAgentSessionId(null);
                        }
                      }
                    }}
                  >
                    <span className="truncate font-medium">{s.title}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {s.updated_at || s.created_at}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}

        <div className="h-full overflow-auto px-2.5 py-2">
        {messages.length === 0 && !busy ? (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1 px-3 text-center">
            <Sparkles size={18} className="text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              {t("terminal.aiEmptyHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {messages.map((m) => (
              <MessageBlock
                key={m.id}
                role={m.role}
                parts={m.parts}
                onConfirm={resolveConfirm}
              />
            ))}
            {busy ? (
              <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
                <Loader2 size={12} className="animate-spin text-primary" />
                <span className="min-w-0 flex-1 truncate">
                  {activity.label || t("terminal.aiWorking")}
                  {activity.detail ? (
                    <span className="opacity-70"> · {activity.detail}</span>
                  ) : null}
                </span>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
        </div>
      </div>

      {/* 底栏：单卡工具条 + 输入，压缩占位；ReAct 状态仍在消息区展示 */}
      <div className="shrink-0 border-t border-border bg-sidebar px-2 py-1.5">
        {pendingConfirms.length > 0 ? (
          <div className="mb-1.5 space-y-1.5">
            {pendingConfirms.map((p) => (
              <div
                key={p.id}
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px]"
              >
                <div className="font-medium text-foreground">
                  待确认{p.dangerous ? " · 危险" : ""}
                  {p.agent && p.agent !== "orchestrator"
                    ? ` · ${p.agent}`
                    : ""}
                </div>
                <div className="mt-0.5 truncate text-muted-foreground">
                  {toolLabel(p.name, p.args)}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => resolveConfirm(p.id, true)}
                  >
                    允许执行
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => resolveConfirm(p.id, false)}
                  >
                    拒绝
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-6 gap-1 px-1.5 text-[10px]"
                    onClick={cancelRun}
                    title={t("terminal.aiCancel")}
                  >
                    <Square size={10} className="fill-current" />
                    {t("terminal.aiCancel")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : busy ? (
          <div className="mb-1.5 flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-[11px] text-foreground">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
            <span className="min-w-0 flex-1 truncate font-medium">
              {activity.label || t("terminal.aiWorking")}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 gap-1 px-1.5 text-[10px]"
              onClick={cancelRun}
              title={t("terminal.aiCancel")}
            >
              <Square size={10} className="fill-current" />
              {t("terminal.aiCancel")}
            </Button>
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-background">
          {/* 一行：权限 · Agent · 模型 · 思考 */}
          <div className="flex items-center gap-0.5 border-b border-border/70 px-1 py-0.5">
            <Select
              value={permissionMode}
              onValueChange={(v) =>
                setPermissionMode(v as AgentPermissionMode)
              }
            >
              <SelectTrigger className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1.5 text-[11px] shadow-none focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top" align="start">
                <SelectItem value="confirm">
                  {t("terminal.aiPermConfirm")}
                </SelectItem>
                <SelectItem value="plan">{t("terminal.aiPermPlan")}</SelectItem>
                <SelectItem value="full">{t("terminal.aiPermFull")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={runtime === "local" ? "local" : `remote:${remoteAgentId}`}
              onValueChange={(v) => {
                if (v === "local") {
                  setRuntime("local");
                  setRemoteAgentId("");
                } else if (v === "__refresh__") {
                  void refreshRemote();
                } else {
                  setRuntime("remote");
                  setRemoteAgentId(v.replace(/^remote:/, ""));
                }
              }}
            >
              <SelectTrigger
                className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1.5 text-[11px] shadow-none focus:ring-0"
                title={agentShort}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top" align="center">
                <SelectItem value="local">
                  {t("terminal.aiLocalAgent")}
                </SelectItem>
                {remoteAgents
                  .filter((a) => a.enabled)
                  .map((a) => (
                    <SelectItem key={a.id} value={`remote:${a.id}`}>
                      {a.name}
                    </SelectItem>
                  ))}
                <SelectItem value="__refresh__">
                  {t("terminal.aiRefreshRemote")}
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={modelRef || undefined}
              onValueChange={setModelRef}
              disabled={modelOptions.length === 0}
            >
              <SelectTrigger
                className="h-7 min-w-0 flex-[1.4] border-0 bg-transparent px-1.5 text-[11px] shadow-none focus:ring-0"
                title={modelShort}
              >
                <SelectValue placeholder={t("terminal.aiPickModel")} />
              </SelectTrigger>
              <SelectContent side="top">
                {modelOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={thinkingMode}
              onValueChange={(v) => {
                const mode = v as ThinkingMode;
                setThinkingMode(mode);
                saveThinkingMode(mode);
              }}
            >
              <SelectTrigger
                className="h-7 w-[58px] shrink-0 gap-0.5 border-0 bg-transparent px-1 text-[11px] shadow-none focus:ring-0"
                title={t("terminal.aiThinkingMode")}
              >
                <Brain size={12} className="shrink-0 opacity-70" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top" align="end">
                <SelectItem value="off">{t("terminal.aiThinkOff")}</SelectItem>
                <SelectItem value="high">{t("terminal.aiThinkHigh")}</SelectItem>
                <SelectItem value="max">{t("terminal.aiThinkMax")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 上下文容量：细条，点击看拆分 */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 border-b border-border/70 px-2 py-1 text-left hover:bg-muted/40"
              >
                <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      contextBudget.percent >= 90
                        ? "bg-destructive"
                        : contextBudget.percent >= 70
                          ? "bg-amber-500"
                          : "bg-primary",
                    )}
                    style={{
                      width: `${Math.min(100, Math.max(2, contextBudget.percent))}%`,
                    }}
                  />
                </div>
                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                  {contextBudget.percent}% ·{" "}
                  {contextBudget.lastApiPrompt != null
                    ? formatTokenCount(contextBudget.lastApiPrompt)
                    : `~${formatTokenCount(contextBudget.total)}`}
                  /{formatTokenCount(contextBudget.limit)}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              className="w-56 space-y-1.5 p-3 text-xs"
            >
              <div className="font-medium">{t("terminal.aiContextTitle")}</div>
              <BudgetRow
                label={t("terminal.aiContextSystem")}
                value={contextBudget.system}
              />
              <BudgetRow
                label={t("terminal.aiContextTools")}
                value={contextBudget.tools}
              />
              <BudgetRow
                label={t("terminal.aiContextMessages")}
                value={contextBudget.messages}
              />
              {contextBudget.inTurn > 0 ? (
                <BudgetRow
                  label={t("terminal.aiContextInTurn")}
                  value={contextBudget.inTurn}
                />
              ) : null}
              <BudgetRow
                label={t("terminal.aiContextDraft")}
                value={contextBudget.draft}
              />
              {contextBudget.lastApiPrompt != null ? (
                <>
                  <div className="border-t border-border pt-1.5 font-medium">
                    {t("terminal.aiContextLastApi")}
                  </div>
                  <BudgetRow
                    label={t("terminal.aiContextApiInput")}
                    value={contextBudget.lastApiPrompt}
                  />
                  {contextBudget.lastApiOutput != null ? (
                    <BudgetRow
                      label={t("terminal.aiContextApiOutput")}
                      value={contextBudget.lastApiOutput}
                    />
                  ) : null}
                  {(contextBudget.cacheRead ?? 0) > 0 ? (
                    <BudgetRow
                      label={t("terminal.aiContextCacheRead")}
                      value={contextBudget.cacheRead ?? 0}
                    />
                  ) : null}
                  {(contextBudget.cacheWrite ?? 0) > 0 ? (
                    <BudgetRow
                      label={t("terminal.aiContextCacheWrite")}
                      value={contextBudget.cacheWrite ?? 0}
                    />
                  ) : null}
                </>
              ) : null}
              {contextBudget.sessionInput != null &&
              contextBudget.sessionInput > 0 ? (
                <>
                  <div className="border-t border-border pt-1.5 font-medium">
                    {t("terminal.aiContextSession")}
                  </div>
                  <BudgetRow
                    label={t("terminal.aiContextApiInput")}
                    value={contextBudget.sessionInput}
                  />
                  {contextBudget.sessionOutput != null ? (
                    <BudgetRow
                      label={t("terminal.aiContextApiOutput")}
                      value={contextBudget.sessionOutput}
                    />
                  ) : null}
                </>
              ) : null}
              <div className="border-t border-border pt-1.5 text-[10px] text-muted-foreground">
                {t("terminal.aiContextHint")}
              </div>
            </PopoverContent>
          </Popover>

          <div className="flex items-end gap-1 px-1.5 pb-1.5 pt-1">
            <Textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              placeholder={t("terminal.aiInputHint")}
              className="min-h-[36px] flex-1 resize-none border-0 bg-transparent px-1 py-1 text-xs shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button
              type="button"
              size="icon-sm"
              className="mb-0.5 size-7 shrink-0"
              disabled={busy || !text.trim()}
              onClick={() => void send()}
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Send size={13} />
              )}
            </Button>
          </div>
        </div>
        {modelOptions.length === 0 ? (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t("terminal.aiNoModel")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function BudgetRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">~{formatTokenCount(value)}</span>
    </div>
  );
}

function MessageBlock({
  role,
  parts,
  onConfirm,
}: {
  role: "user" | "assistant";
  parts: MessagePart[];
  onConfirm?: (id: string, ok: boolean) => void;
}) {
  if (role === "user") {
    const text = parts
      .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    return (
      <div className="ml-4 rounded-lg rounded-br-sm bg-primary/10 px-2.5 py-1.5 text-[12px] leading-[1.55] text-foreground">
        {text}
      </div>
    );
  }
  return (
    <div className="mr-1 space-y-1.5 text-[12px] leading-[1.55]">
      {parts.map((p, i) => (
        <PartView key={i} part={p} onConfirm={onConfirm} />
      ))}
    </div>
  );
}

function toolLabel(name: string, args: unknown): string {
  if (
    (name === "terminal_run" || name === "session_exec") &&
    args &&
    typeof args === "object" &&
    "command" in args
  ) {
    return `${name === "terminal_run" ? "终端执行" : "旁路执行"} · ${String((args as { command: string }).command)}`;
  }
  if (name === "run_script" && args && typeof args === "object") {
    const a = args as {
      script_name?: string;
      script_id?: number;
    };
    const title = a.script_name || (a.script_id != null ? `#${a.script_id}` : "");
    return title ? `执行脚本 · ${title}` : "执行脚本";
  }
  if (name === "get_script" && args && typeof args === "object" && "script_id" in args) {
    return `读取脚本 · #${String((args as { script_id: unknown }).script_id)}`;
  }
  const labels: Record<string, string> = {
    terminal_tail: "读取终端输出",
    list_sessions: "列出会话",
    host_info: "主机信息",
    list_hosts: "主机列表",
    host_metrics: "指标探测",
    run_batch: "批量执行脚本",
    create_inspection_report: "生成巡检报告",
    docker_compose_up: "Compose up",
    list_scripts: "脚本库列表",
    get_script: "读取脚本",
    list_cmd_history: "历史命令",
    run_script: "执行脚本",
    list_files: "列出文件",
    read_file: "读取文件",
    file_info: "文件信息",
    ping: "Ping",
    dns_lookup: "DNS 查询",
    tcp_probe: "TCP 探测",
    tls_cert: "TLS 证书",
    docker_ps: "Docker 列表",
    docker_logs: "Docker 日志",
    docker_inspect: "Docker Inspect",
    search_notes: "搜索笔记",
    search_session_logs: "搜索录制",
    search_cmd_history: "搜索历史命令",
    port_snapshot: "端口快照",
    disk_snapshot: "磁盘快照",
    upload_file: "上传文件",
    upload_tree: "上传目录树",
    sync_to_remote: "同步到远程",
    write_remote_file: "写远程文件",
    deploy: "部署",
  };
  return labels[name] ?? name;
}

function PartView({
  part,
  onConfirm,
}: {
  part: MessagePart;
  onConfirm?: (id: string, ok: boolean) => void;
}) {
  const [open, setOpen] = useState(part.type === "thinking");
  if (part.type === "text") {
    return (
      <MarkdownViewer
        source={part.text}
        density="compact"
        className="text-sidebar-foreground"
      />
    );
  }
  if (part.type === "thinking") {
    return (
      <button
        type="button"
        className="w-full rounded-md border border-dashed border-border bg-muted/40 px-2 py-1.5 text-left text-[12px] leading-[1.55] text-muted-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium text-foreground/80">
          Thought
          {part.agent && part.agent !== "orchestrator"
            ? ` · ${part.agent}`
            : ""}
        </span>
        {open ? (
          <pre className="mt-1 whitespace-pre-wrap font-sans text-[12px] leading-[1.55]">
            {part.text}
          </pre>
        ) : (
          <span className="ml-1 opacity-70">
            {part.text.slice(0, 64)}
            {part.text.length > 64 ? "…" : ""}
          </span>
        )}
      </button>
    );
  }
  if (part.type === "subagent") {
    return (
      <div
        className={cn(
          "rounded-md border px-2 py-1.5 text-[11px]",
          part.status === "running" && "border-primary/40 bg-primary/5",
          part.status === "done" && "border-border bg-muted/30",
          part.status === "error" && "border-destructive/40 bg-destructive/5",
        )}
      >
        <div className="flex items-center gap-1.5 font-medium">
          {part.status === "running" ? (
            <Loader2 size={12} className="animate-spin text-primary" />
          ) : (
            <Bot size={12} className="text-primary" />
          )}
          <span>
            SubAgent · {part.label}
            {part.status === "running"
              ? " · 执行中"
              : part.status === "error"
                ? " · 失败"
                : " · 完成"}
          </span>
        </div>
        <div className="mt-0.5 text-muted-foreground">{part.task}</div>
        {part.summary ? (
          <div className="mt-1.5 border-t border-border/60 pt-1.5">
            <MarkdownViewer source={part.summary} density="compact" />
          </div>
        ) : null}
        {part.children && part.children.length > 0 ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-[10px] text-muted-foreground">
              展开子轨迹 ({part.children.length})
            </summary>
            <div className="mt-1 space-y-1 border-l border-border pl-2">
              {part.children.map((c, i) => (
                <PartView key={i} part={c} onConfirm={onConfirm} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    );
  }
  if (part.type === "plan") {
    const md = part.items
      .map((it, i) => `${i + 1}. ${it.replace(/\n+/g, " ")}`)
      .join("\n");
    return (
      <div className="rounded-md border border-border bg-muted/50 px-2 py-1.5 text-[11px]">
        <div className="mb-1 font-medium">计划（未执行）</div>
        <MarkdownViewer
          source={md}
          density="compact"
          className="text-sidebar-foreground"
        />
      </div>
    );
  }
  if (part.type === "tool_pending") {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px]">
        <div className="font-medium">
          待确认{part.dangerous ? " · 危险" : ""}
          {part.agent && part.agent !== "orchestrator"
            ? ` · ${part.agent}`
            : ""}
        </div>
        <div className="mt-0.5 text-foreground">
          {toolLabel(part.name, part.args)}
        </div>
        <pre className="mt-1 max-h-20 overflow-auto font-mono text-[10px] text-muted-foreground">
          {JSON.stringify(part.args, null, 0)}
        </pre>
        <div className="mt-1.5 flex gap-1.5">
          <Button
            type="button"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => onConfirm?.(part.id, true)}
          >
            允许执行
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px]"
            onClick={() => onConfirm?.(part.id, false)}
          >
            拒绝
          </Button>
        </div>
      </div>
    );
  }
  if (part.type === "tool_call") {
    return (
      <div className="flex items-start gap-1.5 rounded-md border border-border px-2 py-1 text-[12px] leading-[1.55]">
        <Wrench size={12} className="mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="font-medium">
            Action · {toolLabel(part.name, part.args)}
          </div>
          <pre className="truncate font-mono text-[11px] text-muted-foreground">
            {JSON.stringify(part.args)}
          </pre>
        </div>
      </div>
    );
  }
  if (part.type === "tool_result") {
    return (
      <details className="rounded-md bg-muted/40 px-2 py-1.5 text-[12px] leading-[1.55]">
        <summary className="cursor-pointer font-medium">
          Observation · {part.name}
        </summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug">
          {part.result}
        </pre>
      </details>
    );
  }
  if (part.type === "status") {
    return (
      <div className="text-[11px] font-medium text-muted-foreground">
        {part.text}
      </div>
    );
  }
  return null;
}
