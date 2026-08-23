/**
 * @file 全局阻塞操作（对话框、传输等）与 Agent 墙钟暂停
 * @author Charlie
 */

export type BlockingSource = "dialog" | "transfer" | "confirm";

type BlockingState = {
  active: boolean;
  source?: BlockingSource;
  detail?: string;
};

type Listener = (state: BlockingState) => void;

let state: BlockingState = { active: false };
const listeners = new Set<Listener>();

let pauseWallClock: (() => void) | null = null;
let resumeWallClock: (() => void) | null = null;
let wallPausedByBlocking = false;

export function registerAgentWallClockHooks(
  pause: () => void,
  resume: () => void,
) {
  pauseWallClock = pause;
  resumeWallClock = resume;
}

export function subscribeBlockingUi(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

function emit() {
  for (const l of listeners) l(state);
}

function syncWallClock() {
  if (!pauseWallClock || !resumeWallClock) return;
  if (state.active && !wallPausedByBlocking) {
    pauseWallClock();
    wallPausedByBlocking = true;
  } else if (!state.active && wallPausedByBlocking) {
    resumeWallClock();
    wallPausedByBlocking = false;
  }
}

/** 标记 UI 正在等待用户操作或后台传输 */
export function setBlockingUi(
  active: boolean,
  source?: BlockingSource,
  detail?: string,
) {
  state = active
    ? { active: true, source, detail }
    : { active: false };
  syncWallClock();
  emit();
}

export function getBlockingUi(): BlockingState {
  return state;
}
