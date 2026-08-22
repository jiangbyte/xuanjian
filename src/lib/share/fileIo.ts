/**
 * @file 分享导入导出文件对话框辅助
 * @author Charlie
 */

import { save } from "@tauri-apps/plugin-dialog";
import {
  type BuildExportOptions,
  buildExport,
  stringifyExport,
} from "@/lib/share/exportBuilders";
import { applyImport, parseExport } from "@/lib/share/importApply";
import type { ImportResult } from "@/lib/share/types";
import { api } from "@/lib/tauri";

/** 弹出保存对话框并写出 JSON */
export async function exportToFile(
  options: BuildExportOptions = {},
  defaultName = "xuanjian-export.json",
): Promise<boolean> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return false;
  const doc = await buildExport(options);
  await api.writeLocalFile(path, stringifyExport(doc));
  return true;
}

/** 选择本地 JSON 并导入 */
export function importFromFile(): Promise<ImportResult | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const raw = await file.text();
        const doc = await parseExport(raw);
        const result = await applyImport(doc);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

export function formatImportToast(r: ImportResult): string {
  const parts = [`+${r.created}`, `skip ${r.skipped}`];
  if (r.errors.length) parts.push(`err ${r.errors.length}`);
  return parts.join(" · ");
}
