/**
 * @file 本机平台探测
 * @description 统一 Windows / macOS / Linux 判定，供标题栏、路径、探测命令等使用。
 */

export type HostOs = "windows" | "macos" | "linux" | "unknown";

let cached: HostOs | null = null;

/** 从 UA / platform 同步推断（Rust hydrate 前可用） */
function detectFromNavigator(): HostOs {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform || navigator.platform || "";
  const ua = navigator.userAgent || "";
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(platform) || /Mac OS|Macintosh/i.test(ua)) return "macos";
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return "linux";
  return "unknown";
}

/** 当前本机 OS（同步；启动后可用 hydrateHostOs 校正） */
export function getHostOs(): HostOs {
  if (cached) return cached;
  cached = detectFromNavigator();
  return cached;
}

/** 用 Rust `std::env::consts::OS` 校正缓存 */
export function hydrateHostOs(os: string) {
  const n = os.toLowerCase();
  if (n === "windows") cached = "windows";
  else if (n === "macos" || n === "darwin") cached = "macos";
  else if (n === "linux") cached = "linux";
  else cached = "unknown";
}

export function isWindowsOs() {
  return getHostOs() === "windows";
}

export function isMacOs() {
  return getHostOs() === "macos";
}

export function isLinuxOs() {
  return getHostOs() === "linux";
}

/** 修饰键标签：macOS 用 ⌘，其它用 Ctrl */
export function modKeyLabel() {
  return isMacOs() ? "⌘" : "Ctrl";
}

/** 快捷键文案，如 modShift("C") → "⌘+Shift+C" / "Ctrl+Shift+C" */
export function modShortcut(...parts: string[]) {
  return [modKeyLabel(), ...parts].join("+");
}
