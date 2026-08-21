import {
  appendLogChunks,
  createSessionLog,
  finalizeSessionLog,
  getHost,
  pruneSessionLogs,
} from "./db";
import { api, onSessionOutput } from "./tauri";
import { useUiStore } from "../stores/ui";

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

/** Survive Vite HMR so we never stack duplicate session-output listeners. */
type RecorderGlobal = {
  bySession: Map<string, ActiveRec>;
  unlistenOut: (() => void) | null;
  listenInstalled: boolean;
  writeWrapped: boolean;
  originalWrite: (sessionId: string, data: string) => Promise<unknown>;
};

const GKEY = "__xuanjian_session_recorder_v2__";

/** True after this JS module instance has bound a listener (resets on Vite HMR). */
let boundInThisModule = false;

function g(): RecorderGlobal {
  const root = globalThis as unknown as Record<string, RecorderGlobal | undefined>;
  // Drop leftover listeners from older recorder builds (dev HMR / prior bugs).
  for (const legacy of [
    "__xuanjian_session_recorder_v1__",
    "__xuanjian_session_recorder__",
  ]) {
    const old = root[legacy];
    if (old?.unlistenOut) {
      try {
        old.unlistenOut();
      } catch {
        /* ignore */
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

function enqueue(
  rec: ActiveRec,
  direction: "in" | "out",
  data: string,
) {
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

/** @deprecated kept for callers; prefer internal recordOut */
export function recordSessionOutput(sessionId: string, data: string) {
  recordOut(sessionId, data);
}

export function recordSessionInput(sessionId: string, data: string) {
  recordIn(sessionId, data);
}

function ensureOutputListener() {
  // Already bound for this module instance — do not stack.
  if (boundInThisModule) return;
  boundInThisModule = true;

  const state = g();
  // Drop any listener left by a previous HMR module instance.
  if (state.unlistenOut) {
    try {
      state.unlistenOut();
    } catch {
      /* ignore */
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
    // Re-point wrap to current recordIn after HMR.
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
      /* ignore */
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
 * Install once per app load. On HMR, re-binds a single listener (replacing the old).
 * React StrictMode remount must not stack listeners.
 */
export function initSessionRecorder(): () => void {
  ensureOutputListener();
  ensureWriteWrap();
  return () => {
    /* keep listener for app lifetime / HMR-safe singleton */
  };
}
