/**
 * @file 系统剪贴板封装
 * @author Charlie
 * @description 通过 Tauri 剪贴板插件读写文本，避免浏览器权限弹窗。
 * 读失败时返回空串；写操作直接透传插件 API。
 */

import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

/** 读取系统剪贴板文本；失败时返回空字符串 */
export async function clipboardReadText(): Promise<string> {
  try {
    return (await readText()) ?? "";
  } catch {
    return "";
  }
}

/** 将文本写入系统剪贴板 */
export async function clipboardWriteText(text: string): Promise<void> {
  await writeText(text);
}
