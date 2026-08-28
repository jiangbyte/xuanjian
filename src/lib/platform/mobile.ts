/**
 * @file 移动端 / 窄屏 UI 判定
 * @description 支持 ?mobile=1 强制移动壳（桌面调试）；Android/iOS WebView 自动启用。
 */

import { isTauri } from "@tauri-apps/api/core";

const FORCE_KEY = "xuanjian.forceMobileUi";

/** 同步读取是否强制移动 UI（URL / localStorage） */
export function readForcedMobileUi(): boolean | null {
  try {
    const q = new URLSearchParams(window.location.search).get("mobile");
    if (q === "1" || q === "true") {
      localStorage.setItem(FORCE_KEY, "1");
      return true;
    }
    if (q === "0" || q === "false") {
      localStorage.setItem(FORCE_KEY, "0");
      return false;
    }
    const stored = localStorage.getItem(FORCE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    /* ignore */
  }
  return null;
}

/** UA / Tauri 环境是否像手机 */
export function detectMobileEnvironment(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  if (
    ua.includes("android") ||
    ua.includes("iphone") ||
    ua.includes("ipad") ||
    ua.includes("ipod")
  ) {
    return true;
  }
  // Tauri Android/iOS WebView 常见标识
  if (isTauri() && /mobile|wv\)/.test(ua)) return true;
  return false;
}

/** 当前是否应使用移动端壳 */
export function shouldUseMobileUi(): boolean {
  const forced = readForcedMobileUi();
  if (forced != null) return forced;
  return detectMobileEnvironment();
}
