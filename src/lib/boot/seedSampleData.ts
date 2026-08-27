/**
 * @file 首次启动注入示例数据
 * @description 各模块为空时写入占位示例（与普通数据相同，可随意编辑、删除），仅执行一次。
 */

import {
  SAMPLE_DATA_BOOTSTRAP_KEY,
  SAMPLE_DOCKER_PROJECTS,
  sampleDockerProjectInput,
  sampleHostsExport,
  sampleNotesExport,
  sampleScriptsExport,
} from "@/lib/boot/sampleData";
import {
  createDockerProject,
  listDockerProjects,
} from "@/lib/db/dockerProjects";
import { listHosts } from "@/lib/db/hosts";
import { listNotes } from "@/lib/db/notes";
import { getSetting, setSetting } from "@/lib/db/settings";
import { listScripts } from "@/lib/db/scripts";
import { applyImport } from "@/lib/share/importApply";

/** 首次启动时为空的模块写入示例数据 */
export async function seedSampleDataIfNeeded(): Promise<void> {
  if ((await getSetting(SAMPLE_DATA_BOOTSTRAP_KEY)) === "1") return;

  const [hosts, scripts, notes, docker] = await Promise.all([
    listHosts(),
    listScripts(),
    listNotes(),
    listDockerProjects(),
  ]);

  try {
    if (hosts.length === 0) {
      await applyImport(sampleHostsExport());
    }
    if (scripts.length === 0) {
      await applyImport(sampleScriptsExport());
    }
    if (notes.length === 0) {
      await applyImport(sampleNotesExport());
    }
    if (docker.length === 0) {
      for (const item of SAMPLE_DOCKER_PROJECTS) {
        const input = sampleDockerProjectInput(
          item.name,
          item.description,
          item.templateId,
        );
        if (input) await createDockerProject(input);
      }
    }
  } catch (e) {
    console.error("[bootstrap] sample data seed failed", e);
  } finally {
    await setSetting(SAMPLE_DATA_BOOTSTRAP_KEY, "1");
  }
}
