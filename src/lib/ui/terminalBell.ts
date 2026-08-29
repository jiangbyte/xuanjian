/**
 * @file 终端响铃（BEL）处理
 * @author Charlie
 * @description xterm.js 5+ 不再内置响铃；由应用侧决定视觉闪烁 / 轻提示音 / 静音。
 */

export type TermBellMode = "none" | "visual" | "sound" | "both";

const BELL_MODES = new Set<TermBellMode>(["none", "visual", "sound", "both"]);

export function resolveTermBellMode(
  value: string | null | undefined,
): TermBellMode {
  const v = value?.trim() as TermBellMode | undefined;
  if (v && BELL_MODES.has(v)) return v;
  return "visual";
}

let lastBellAt = 0;
let audioCtx: AudioContext | null = null;

function playSoftBell() {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t0 = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.04, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
    osc.start(t0);
    osc.stop(t0 + 0.09);
  } catch {
    /* AudioContext 可能被策略拦截 */
  }
}

/**
 * 处理一次终端 BEL：节流后按模式视觉闪烁和/或轻提示音。
 */
export function handleTerminalBell(
  mode: TermBellMode,
  surface: HTMLElement | null,
) {
  if (mode === "none") return;
  const now = Date.now();
  if (now - lastBellAt < 280) return;
  lastBellAt = now;

  if (mode === "visual" || mode === "both") {
    if (surface) {
      surface.classList.remove("terminal-bell-flash");
      // 强制重启动画
      void surface.offsetWidth;
      surface.classList.add("terminal-bell-flash");
      window.setTimeout(() => {
        surface.classList.remove("terminal-bell-flash");
      }, 180);
    }
  }

  if (mode === "sound" || mode === "both") {
    playSoftBell();
  }
}
