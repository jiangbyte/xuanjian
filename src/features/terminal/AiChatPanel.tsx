/**
 * @file 终端右侧 AI 对话面板
 * @author Charlie
 * @description 侧栏内完整 Agent 对话：历史抽屉、气泡/思考/工具卡、模型·Agent·权限选择。
 */

import {
  Brain,
  History,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
import { MessageBlock, reduceParts, toolLabel } from "@/features/agent";
import {
  formatTokenCount,
  loadThinkingMode,
  mergeUsage,
  saveLastAgentSessionId,
  saveThinkingMode,
  type LlmUsage,
  type ThinkingMode,
} from "@/lib/agent/contextBudget";
import {
  buildContextMeterView,
  buildProjectedMessagesFromUi,
  measureSurfaceTokens,
} from "@/lib/agent/contextBudget/meter";
import { buildAgentHistory } from "@/lib/agent/history";
import { buildOrchestratorSystemPrompt } from "@/lib/agent/runtime/prompts";
import { toolsForOrchestrator } from "@/lib/agent/subagents";
import { runAgentTurn } from "@xuanjian/agent-adapters";
import {
  steerAgent,
  buildPlanExecutePrompt,
  type AgentActivityPhase,
} from "@xuanjian/agent-core";
import { getBlockingUi, subscribeBlockingUi } from "@/lib/ui/blockingUi";
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
  parseMessageParts,
  updateAgentSession,
  type AgentMessageRow,
  type AgentPermissionMode,
  type AgentSessionRow,
  type AiModelRow,
  type AiProviderRow,
  type MessagePart,
} from "@/lib/db";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/features/workspace/WorkspaceSwitcher";
import { useUiStore } from "@/stores/ui";

type LiveMsg = {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
};

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
  const [executedPlanKeys, setExecutedPlanKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activitySinceRef = useRef(Date.now());
  const [activityTick, setActivityTick] = useState(0);
  const [blockingUi, setBlockingUiState] = useState(getBlockingUi);
  const confirmWaiters = useRef(new Map<string, (ok: boolean) => void>());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sampledSurfaceRef = useRef<number | null>(null);

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
    const [p, m, s] = await Promise.all([
      listAiProviders(),
      listAiModels(),
      listAgentSessions(),
    ]);
    setProviders(p);
    setModels(m);
    setSessions(s);
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
    [tabs, modelRef, permissionMode, loadSession, reloadMeta, t],
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

  useEffect(() => subscribeBlockingUi(setBlockingUiState), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, activity.label, blockingUi.active]);

  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setActivityTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  const activityElapsed = useMemo(() => {
    if (!busy) return "";
    void activityTick;
    const ms = Date.now() - activitySinceRef.current;
    if (ms < 3000) return "";
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  }, [busy, activityTick, activity.phase, activity.label]);

  const activityStatusLabel = useMemo(() => {
    if (blockingUi.active) {
      if (blockingUi.source === "dialog") {
        return t("terminal.aiWaitingDialog");
      }
      if (blockingUi.source === "transfer") {
        const prog = blockingUi.detail;
        return prog
          ? `${t("terminal.aiWaitingTransfer")} (${prog})`
          : t("terminal.aiWaitingTransfer");
      }
    }
    if (activity.phase === "awaiting_confirm") {
      return activity.label || t("terminal.aiAwaitingConfirm");
    }
    return activity.label || t("terminal.aiWorking");
  }, [activity.label, activity.phase, blockingUi, t]);

  const filteredSessions = useMemo(() => {
    const q = histQ.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, histQ]);

  const runTurn = useCallback(
    async (opts: {
      content: string;
      permissionMode?: AgentPermissionMode;
      titleHint?: string;
    }) => {
      const content = opts.content.trim();
      if (!content) return;
      const activeMode = opts.permissionMode ?? permissionMode;
      if (opts.permissionMode) setPermissionMode(opts.permissionMode);

      setBusy(true);
      setLastUsage(null);
      setSessionUsage(null);
      sampledSurfaceRef.current = null;
      setActivity({
        phase: "planning",
        label: t("terminal.aiActivityStarting"),
      });
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const sid = await ensureSession();

        const history = await buildAgentHistory(sid);

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
          model_ref: modelRef || null,
          permission_mode: activeMode,
          title: (opts.titleHint ?? content).slice(0, 40),
        });

        await runAgentTurn({
          sessionId: sid,
          userText: content,
          modelRef: modelRef || null,
          permissionMode: activeMode,
          thinkingMode,
          history:
            history as import("@xuanjian/agent-core").RunAgentInput["history"],
          signal: ac.signal,
          onConfirmTool: (req) =>
            new Promise<boolean>((resolve) => {
              confirmWaiters.current.set(req.id, resolve);
            }),
          onEvent: (e) => {
            if (e.type === "usage") {
              const system = buildOrchestratorSystemPrompt(activeMode);
              const tools = toolsForOrchestrator(activeMode);
              const projectedMsgs = buildProjectedMessagesFromUi({
                messages: messagesRef.current,
                busy: true,
              });
              sampledSurfaceRef.current = measureSurfaceTokens({
                system,
                tools,
                messages: projectedMsgs,
              });
              setLastUsage(e.usage as LlmUsage);
              setSessionUsage((prev) => mergeUsage(prev, e.usage as LlmUsage));
              return;
            }
            if (e.type === "activity") {
              activitySinceRef.current = Date.now();
              setActivity({
                phase: e.phase,
                label: e.label,
                detail: e.detail,
              });
              return;
            }
            if (e.type === "done") {
              setActivity({ phase: "idle", label: "" });
              return;
            }
            setMessages((prev) => {
              const next = [...prev];
              const idx = next.findIndex((m) => m.id === asstId);
              if (idx < 0) return prev;
              next[idx] = {
                ...next[idx],
                parts: reduceParts(next[idx].parts, e),
              };
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
    },
    [permissionMode, ensureSession, modelRef, thinkingMode, reloadMeta, t],
  );

  const executePlan = useCallback(
    (items: string[], planKey: string) => {
      if (busy || executedPlanKeys.has(planKey) || items.length === 0) return;
      setExecutedPlanKeys((prev) => new Set(prev).add(planKey));
      void runTurn({
        content: buildPlanExecutePrompt(items),
        permissionMode: "confirm",
        titleHint: `执行计划：${items[0]?.slice(0, 24) ?? ""}`,
      });
    },
    [busy, executedPlanKeys, runTurn],
  );

  const send = async () => {
    const content = text.trim();
    if (!content) return;
    if (busy) {
      if (sessionId) steerAgent(sessionId, content);
      setText("");
      const steerMsg: LiveMsg = {
        id: `u-steer-${Date.now()}`,
        role: "user",
        parts: [{ type: "text", text: content }],
      };
      setMessages((prev) => [...prev, steerMsg]);
      return;
    }
    setText("");
    await runTurn({ content });
  };

  const modelShort = useMemo(() => {
    const o = modelOptions.find((x) => x.value === modelRef);
    if (!o) return t("terminal.aiPickModel");
    const parts = o.label.split("/");
    return parts[parts.length - 1] || o.label;
  }, [modelOptions, modelRef, t]);

  const modelContextTag = useMemo(() => {
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
    return row?.context_tag || "128k";
  }, [modelRef, models]);

  const contextBudget = useMemo(() => {
    const system = buildOrchestratorSystemPrompt(permissionMode);
    const tools = toolsForOrchestrator(permissionMode);
    const projectedMsgs = buildProjectedMessagesFromUi({
      messages,
      busy,
      draft: text,
    });
    const meter = buildContextMeterView({
      system,
      tools,
      messages: projectedMsgs,
      contextTag: modelContextTag,
      lastUsage,
      sampledSurfaceTokens: sampledSurfaceRef.current,
    });
    return {
      ...meter,
      sessionInput: sessionUsage ? sessionUsage.totalPrompt : undefined,
      sessionOutput: sessionUsage?.output,
    };
  }, [
    messages,
    text,
    busy,
    modelContextTag,
    permissionMode,
    lastUsage,
    sessionUsage,
    activityTick,
  ]);

  const agentShort = t("terminal.aiLocalAgent");

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
                      title:
                        activeTab?.title?.trim() || t("terminal.aiNewChat"),
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
              <TooltipContent side="left">
                {t("terminal.aiNewChat")}
              </TooltipContent>
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
              <TooltipContent side="left">
                {t("terminal.aiHistory")}
              </TooltipContent>
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
                          await updateAgentSession(s.id, {
                            tab_id: activeTabId,
                          });
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

        <div className="h-full overflow-x-hidden overflow-y-auto px-2.5 py-2">
          {messages.length === 0 && !busy ? (
            <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1 px-3 text-center">
              <Sparkles size={18} className="text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">
                {t("terminal.aiEmptyHint")}
              </p>
            </div>
          ) : (
            <div className="min-w-0 max-w-full space-y-2.5">
              {messages.map((m) => (
                <MessageBlock
                  key={m.id}
                  messageId={m.id}
                  role={m.role}
                  parts={m.parts}
                  onConfirm={resolveConfirm}
                  onExecutePlan={executePlan}
                  executedPlanKeys={executedPlanKeys}
                  busy={busy}
                  permissionMode={permissionMode}
                />
              ))}
              {busy ? (
                <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
                  <Loader2 size={12} className="animate-spin text-primary" />
                  <span className="min-w-0 flex-1 truncate">
                    {activityStatusLabel}
                    {activity.detail &&
                    !blockingUi.active &&
                    activity.phase !== "awaiting_confirm" ? (
                      <span className="opacity-70"> · {activity.detail}</span>
                    ) : null}
                    {activityElapsed ? (
                      <span className="opacity-60"> · {activityElapsed}</span>
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
                  {p.agent && p.agent !== "orchestrator" ? ` · ${p.agent}` : ""}
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
              {activityStatusLabel}
              {activityElapsed ? (
                <span className="font-normal opacity-70">
                  {" "}
                  · {activityElapsed}
                </span>
              ) : null}
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
              onValueChange={(v) => setPermissionMode(v as AgentPermissionMode)}
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
            <span
              className="flex h-7 min-w-0 flex-1 items-center truncate px-1.5 text-[11px] text-muted-foreground"
              title={agentShort}
            >
              {t("terminal.aiLocalAgent")}
            </span>
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
                <SelectItem value="high">
                  {t("terminal.aiThinkHigh")}
                </SelectItem>
                <SelectItem value="max">{t("terminal.aiThinkMax")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 上下文容量：有 API 样本后显示占用（对齐 dsh ContextMeter） */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 border-b border-border/70 px-2 py-1 text-left hover:bg-muted/40"
              >
                <div className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  {contextBudget.pressureTokens != null ? (
                    <>
                      <div
                        className="pointer-events-none absolute inset-y-0 z-10 w-px bg-muted-foreground/40"
                        style={{
                          left: `${Math.min(99, contextBudget.thresholdPercent)}%`,
                        }}
                        title={`压缩阈值 ${contextBudget.thresholdPercent}%`}
                      />
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
                          width: `${Math.min(100, Math.max(1, contextBudget.percent))}%`,
                        }}
                      />
                    </>
                  ) : null}
                </div>
                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                  {contextBudget.pressureTokens != null
                    ? `${contextBudget.percent}% · ${formatTokenCount(contextBudget.projectedTokens)}/${formatTokenCount(contextBudget.contextWindow)}`
                    : `—/${formatTokenCount(contextBudget.contextWindow)}`}
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
                value={contextBudget.systemTokens}
              />
              <BudgetRow
                label={t("terminal.aiContextTools")}
                value={contextBudget.toolsTokens}
              />
              <BudgetRow
                label={t("terminal.aiContextMessages")}
                value={contextBudget.messageTokens}
              />
              {contextBudget.pressureTokens != null ? (
                <>
                  <div className="border-t border-border pt-1.5 font-medium">
                    {t("terminal.aiContextLastApi")}
                  </div>
                  <BudgetRow
                    label={t("terminal.aiContextApiInput")}
                    value={contextBudget.pressureTokens}
                  />
                  <BudgetRow
                    label="投影占用"
                    value={contextBudget.projectedTokens}
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
                {contextBudget.pressureTokens != null
                  ? "占用率 = API prompt 样本 + 表层增量；下方组成为 chars÷4 启发式，相加不等于占用总量。"
                  : "发送一轮后由模型返回的 prompt usage 锚定占用率；下方组成为 chars÷4 启发式预览。"}
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
              disabled={!text.trim()}
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
