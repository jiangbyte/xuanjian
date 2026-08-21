import {
  readText,
  writeText,
} from "@tauri-apps/plugin-clipboard-manager";

/** Native clipboard via Tauri — avoids browser permission prompts. */
export async function clipboardReadText(): Promise<string> {
  try {
    return (await readText()) ?? "";
  } catch {
    return "";
  }
}

export async function clipboardWriteText(text: string): Promise<void> {
  await writeText(text);
}
