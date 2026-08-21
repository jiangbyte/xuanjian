/**
 * @file 终端会话录制器
 * @author Charlie
 * @description 捕获会话输入/输出写入本地日志，支持 Vite HMR 下单例监听不重复叠加。
 * 提供按会话 / 标签启停录制，以及应用启动时的初始化入口。
 */

import {
  appendLogChunks,
  createSessionLog,
  finalizeOrphanOpenLogs,
  finalizeSessionLog,
  getHost,
  pruneSessionLogs,
} from "@/lib/db";
import { api, onSessionOutput } from "@/lib/tauri";
import { useUiStore } from "@/stores/ui";

type ActiveRec = {
  logId: number | null;
  sessionId: string;
  tabId: string;
  startedAtMs: number;
  nextSeq: number;
  pending: Array<{
    seq: number;
    direction: "in" | "out";
    data: string;
    tMs: number;
  }>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  ending: boolean;
  flushChain: Promise<void>;
};

/** 跨 Vite HMR 存活的全局状态，避免重复挂载 session-output 监听 */
type RecorderGlobal = {
  bySession: Map<string, ActiveRec>;
  unlistenOut: (() => void) | null;
  listenInstalled: boolean;
  writeWrapped: boolean;
  originalWrite: (sessionId: string, data: string) => Promise<unknown>;
};

const GKEY = "__xuanjian_session_recorder_v2__";

/** 本模块实例是否已绑定监听（Vite HMR 后会重置） */
let boundInThisModule = false;

function g(): RecorderGlobal {
  const root = globalThis as unknown as Record<
    string,
    RecorderGlobal | undefined
  >;
  // 清理旧版录制器残留的监听（开发 HMR / 历史 bug）
  for (const legacy of [
    "__xuanjian_session_recorder_v1__",
    "__xuanjian_session_recorder__",
  ]) {
    const old = root[legacy];
    if (old?.unlistenOut) {
      try {
        old.unlistenOut();
      } catch {
        /* 忽略 */
      }
      old.unlistenOut = null;
    }
    delete root[legacy];
  }
  if (!root[GKEY]) {
    root[GKEY] = {
      bySession: new Map(),
      unlistenOut: null,
      listenInstalled: false,
      writeWrapped: false,
      originalWrite: api.sessionWrite.bind(api),
    };
  }
  return root[GKEY]!;
}

const FLUSH_MS = 80;
const FLUSH_MAX = 16;

function tMsOf(rec: ActiveRec) {
  return Math.max(0, Date.now() - rec.startedAtMs);
}

async function flush(rec: ActiveRec) {
  if (rec.flushTimer) {
    clearTimeout(rec.flushTimer);
    rec.flushTimer = null;
  }
  if (rec.pending.length === 0 || rec.logId == null) return;
  const logId = rec.logId;
  const batch = rec.pending.splice(0, rec.pending.length);
  try {
    await appendLogChunks(logId, batch);
  } catch (e) {
    console.error("sessionRecorder flush failed", e);
    rec.pending.unshift(...batch);
  }
}

function scheduleFlush(rec: ActiveRec) {
  if (rec.logId == null) return;
  if (rec.pending.length >= FLUSH_MAX) {
    rec.flushChain = rec.flushChain.then(() => flush(rec));
    return;
  }
  if (rec.flushTimer) return;
  rec.flushTimer = setTimeout(() => {
    rec.flushTimer = null;
    rec.flushChain = rec.flushChain.then(() => flush(rec));
  }, FLUSH_MS);
}

function enqueue(rec: ActiveRec, direction: "in" | "out", data: string) {
  if (!data || rec.ending) return;
  rec.pending.push({
    seq: rec.nextSeq++,
    direction,
    data,
    tMs: tMsOf(rec),
  });
  scheduleFlush(rec);
}

function recordOut(sessionId: string, data: string) {
  const rec = g().bySession.get(sessionId);
  if (!rec) return;
  enqueue(rec, "out", data);
}

function recordIn(sessionId: string, data: string) {
  const rec = g().bySession.get(sessionId);
  if (!rec) return;
  enqueue(rec, "in", data);
}

/** @deprecated 保留给调用方；优先使用内部 recordOut */
export function recordSessionOutput(sessionId: string, data: string) {
  recordOut(sessionId, data);
}

/** 记录会话输入（键盘 / 脚本写入） */
export function recordSessionInput(sessionId: string, data: string) {
  recordIn(sessionId, data);
}

function ensureOutputListener() {
  // 本模块实例已绑定 — 勿重复叠加
  if (boundInThisModule) return;
  boundInThisModule = true;

  const state = g();
  // 卸掉上一轮 HMR 模块实例留下的监听
  if (state.unlistenOut) {
    try {
      state.unlistenOut();
    } catch {
      /* 忽略 */
    }
    state.unlistenOut = null;
  }
  state.listenInstalled = true;
  void onSessionOutput((p) => {
    recordOut(p.sessionId, p.data);
  })
    .then((un) => {
      if (!boundInThisModule) {
        un();
        return;
      }
      state.unlistenOut = un;
    })
    .catch((e) => {
      boundInThisModule = false;
      state.listenInstalled = false;
      console.error("sessionRecorder listen failed", e);
    });
}

function ensureWriteWrap() {
  const state = g();
  if (state.writeWrapped) {
    // HMR 后把包装重新指向当前 recordIn
    api.sessionWrite = async (sessionId: string, data: string) => {
      recordIn(sessionId, data);
      return state.originalWrite(sessionId, data);
    };
    return;
  }
  state.writeWrapped = true;
  api.sessionWrite = async (sessionId: string, data: string) => {
    recordIn(sessionId, data);
    return state.originalWrite(sessionId, data);
  };
}

/** 为指定会话创建日志并开始缓冲输入/输出块 */
export async function startSessionRecording(opts: {
  tabId: string;
  sessionId: string;
  kind: "local" | "ssh";
  hostId?: number | null;
  shellId?: string | null;
  title: string;
  remoteUser?: string | null;
  remoteHost?: string | null;
}): Promise<number | null> {
  ensureOutputListener();
  ensureWriteWrap();

  const state = g();
  if (state.bySession.has(opts.sessionId)) {
    await endSessionRecording(opts.sessionId, "closed");
  }

  const rec: ActiveRec = {
    logId: null,
    sessionId: opts.sessionId,
    tabId: opts.tabId,
    startedAtMs: Date.now(),
    nextSeq: 0,
    pending: [],
    flushTimer: null,
    ending: false,
    flushChain: Promise.resolve(),
  };
  state.bySession.set(opts.sessionId, rec);

  let remoteUser = opts.remoteUser ?? null;
  let remoteHost = opts.remoteHost ?? null;
  if (
    opts.kind === "ssh" &&
    opts.hostId != null &&
    (!remoteUser || !remoteHost)
  ) {
    try {
      const host = await getHost(opts.hostId);
      if (host) {
        remoteUser = remoteUser ?? host.username;
        remoteHost = remoteHost ?? host.host;
      }
    } catch {
      /* 忽略 */
    }
  }

  try {
    const logId = await createSessionLog({
      tabId: opts.tabId,
      sessionId: opts.sessionId,
      kind: opts.kind,
      hostId: opts.hostId ?? null,
      shellId: opts.shellId ?? null,
      title: opts.title,
      remoteUser,
      remoteHost,
    });
    const current = state.bySession.get(opts.sessionId);
    if (!current || current !== rec) {
      await finalizeSessionLog(logId, "closed");
      return logId;
    }
    rec.logId = logId;
    useUiStore.getState().updateTab(opts.tabId, { logId });
    await flush(rec);
    void pruneSessionLogs(1000).catch(console.error);
    return logId;
  } catch (e) {
    console.error("startSessionRecording failed", e);
    if (state.bySession.get(opts.sessionId) === rec) {
      state.bySession.delete(opts.sessionId);
    }
    return null;
  }
}

/** 根据已打开标签元数据启动录制 */
export async function startRecordingForOpenTab(
  tabId: string,
  sessionId: string,
): Promise<void> {
  const tab = useUiStore.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  await startSessionRecording({
    tabId,
    sessionId,
    kind: tab.kind,
    hostId: tab.hostId,
    shellId: tab.shellId,
    title: tab.title,
  });
}

/** 结束指定会话的录制并落盘 finalize */
export async function endSessionRecording(
  sessionId: string,
  status: "closed" | "error" = "closed",
): Promise<void> {
  const state = g();
  const rec = state.bySession.get(sessionId);
  if (!rec) return;
  rec.ending = true;
  state.bySession.delete(sessionId);
  if (rec.flushTimer) {
    clearTimeout(rec.flushTimer);
    rec.flushTimer = null;
  }
  await rec.flushChain;
  if (rec.logId == null) {
    for (let i = 0; i < 40 && rec.logId == null; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  await flush(rec);
  if (rec.logId != null) {
    try {
      await finalizeSessionLog(rec.logId, status);
    } catch (e) {
      console.error("finalizeSessionLog failed", e);
    }
  }
  void pruneSessionLogs(1000).catch(console.error);
}

/** 按标签 ID 结束录制（优先用 sessionId，否则扫全局映射） */
export async function endRecordingForTab(tabId: string): Promise<void> {
  const tab = useUiStore.getState().tabs.find((t) => t.id === tabId);
  if (tab?.sessionId) {
    await endSessionRecording(tab.sessionId, "closed");
    return;
  }
  for (const [sid, rec] of g().bySession) {
    if (rec.tabId === tabId) {
      await endSessionRecording(sid, "closed");
      return;
    }
  }
}

/**
 * 应用加载时安装一次。HMR 时重新绑定单一监听（替换旧的）。
 * React StrictMode 重挂载不得叠加监听。
 * 同时收尾无对应活跃会话的 orphan「进行中」日志。
 */
export function initSessionRecorder(): () => void {
  ensureOutputListener();
  ensureWriteWrap();
  void reconcileOrphanOpenLogs();
  return () => {
    /* 保持监听贯穿应用生命周期 / HMR 安全单例 */
  };
}

/** 将 DB 中 open、且不在当前录制/标签中的日志标为 closed */
export async function reconcileOrphanOpenLogs(): Promise<void> {
  try {
    const liveSessions = new Set<string>([...g().bySession.keys()]);
    for (const tab of useUiStore.getState().tabs) {
      if (tab.sessionId && (tab.status === "open" || tab.status === "connecting")) {
        liveSessions.add(tab.sessionId);
      }
    }
    await finalizeOrphanOpenLogs([...liveSessions]);
  } catch (e) {
    console.error("reconcileOrphanOpenLogs failed", e);
  }
}
