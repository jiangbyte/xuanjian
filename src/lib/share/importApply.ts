/**
 * @file 应用 xuanjian-export JSON（同名跳过）
 * @author Charlie
 */

import {
  createDockerProject,
  listDockerProjects,
} from "@/lib/db/dockerProjects";
import { createGroup, createHost, listGroups, listHosts } from "@/lib/db/hosts";
import {
  createNote,
  createNoteCategory,
  listNoteCategories,
  listNotes,
} from "@/lib/db/notes";
import {
  createScript,
  createScriptPackage,
  listScriptPackages,
  listScripts,
} from "@/lib/db/scripts";
import {
  EXPORT_FORMAT,
  type ImportResult,
  type XuanjianExport,
} from "@/lib/share/types";
import { api } from "@/lib/tauri";

function emptyResult(): ImportResult {
  return { created: 0, skipped: 0, errors: [] };
}

function mergeResult(a: ImportResult, b: ImportResult): ImportResult {
  return {
    created: a.created + b.created,
    skipped: a.skipped + b.skipped,
    errors: [...a.errors, ...b.errors],
  };
}

/** 解析并校验导出文件 */
export function parseExport(raw: string): XuanjianExport {
  const data = JSON.parse(raw) as XuanjianExport;
  if (!data || data.format !== EXPORT_FORMAT) {
    throw new Error("invalid export format");
  }
  if (typeof data.version !== "number" || data.version < 1) {
    throw new Error("unsupported export version");
  }
  return data;
}

async function importHosts(doc: XuanjianExport): Promise<ImportResult> {
  const result = emptyResult();
  const section = doc.hosts;
  if (!section) return result;

  const groups = await listGroups();
  const groupByName = new Map(groups.map((g) => [g.name, g.id]));
  for (const g of section.groups ?? []) {
    const name = g.name?.trim();
    if (!name) continue;
    if (groupByName.has(name)) {
      result.skipped += 1;
      continue;
    }
    try {
      const id = await createGroup(name);
      groupByName.set(name, id);
      result.created += 1;
    } catch (e) {
      result.errors.push(`group ${name}: ${String(e)}`);
    }
  }

  const existing = await listHosts();
  const hostByName = new Map(existing.map((h) => [h.name, h.id]));
  // 先创建无 jump，再二次绑定 jump
  const pendingJump: { id: number; jumpName: string }[] = [];

  for (const item of section.items ?? []) {
    const name = item.name?.trim();
    if (!name || !item.host?.trim()) {
      result.errors.push("host missing name/host");
      continue;
    }
    if (hostByName.has(name)) {
      result.skipped += 1;
      continue;
    }
    try {
      let password_enc: string | null = null;
      let passphrase_enc: string | null = null;
      if (item.password) {
        password_enc = await api.encryptSecret(item.password);
      }
      if (item.passphrase) {
        passphrase_enc = await api.encryptSecret(item.passphrase);
      }
      const groupName = item.group?.trim();
      const group_id =
        groupName && groupByName.has(groupName)
          ? groupByName.get(groupName)!
          : null;
      const id = await createHost({
        name,
        host: item.host.trim(),
        port: item.port ?? 22,
        username: item.username?.trim() || "root",
        auth_type: item.auth_type || "password",
        password_enc,
        passphrase_enc,
        private_key_path: item.private_key_path ?? null,
        group_id,
        tags: item.tags ?? [],
        remark: item.remark ?? null,
        color: item.color ?? null,
        connect_timeout: item.connect_timeout ?? 30,
        keepalive_interval: item.keepalive_interval ?? 60,
        terminal_type: item.terminal_type ?? "xterm-256color",
        startup_cmd: item.startup_cmd ?? null,
        remote_path: item.remote_path ?? null,
        jump_host_id: null,
      });
      hostByName.set(name, id);
      if (item.jump_host?.trim()) {
        pendingJump.push({ id, jumpName: item.jump_host.trim() });
      }
      result.created += 1;
    } catch (e) {
      result.errors.push(`host ${name}: ${String(e)}`);
    }
  }

  if (pendingJump.length) {
    const { updateHost } = await import("@/lib/db/hosts");
    const all = await listHosts();
    const byName = new Map(all.map((h) => [h.name, h]));
    for (const p of pendingJump) {
      const jump = byName.get(p.jumpName);
      const self = all.find((h) => h.id === p.id);
      if (!jump || !self) continue;
      try {
        await updateHost(p.id, {
          name: self.name,
          host: self.host,
          port: self.port,
          username: self.username,
          auth_type: self.auth_type,
          password_enc: self.password_enc,
          private_key_path: self.private_key_path,
          passphrase_enc: self.passphrase_enc,
          group_id: self.group_id,
          remark: self.remark,
          color: self.color,
          connect_timeout: self.connect_timeout,
          keepalive_interval: self.keepalive_interval,
          terminal_type: self.terminal_type,
          startup_cmd: self.startup_cmd,
          remote_path: self.remote_path,
          jump_host_id: jump.id,
        });
      } catch (e) {
        result.errors.push(`jump ${self.name}: ${String(e)}`);
      }
    }
  }

  return result;
}

async function importScripts(doc: XuanjianExport): Promise<ImportResult> {
  const result = emptyResult();
  const section = doc.scripts;
  if (!section) return result;

  const packages = await listScriptPackages();
  const pkgByName = new Map(packages.map((p) => [p.name, p.id]));
  for (const p of section.packages ?? []) {
    const name = p.name?.trim();
    if (!name) continue;
    if (pkgByName.has(name)) {
      result.skipped += 1;
      continue;
    }
    try {
      const id = await createScriptPackage(name);
      pkgByName.set(name, id);
      result.created += 1;
    } catch (e) {
      result.errors.push(`package ${name}: ${String(e)}`);
    }
  }

  const existing = await listScripts();
  const keySet = new Set(
    existing.map((s) => `${s.package_name ?? ""}::${s.name}`),
  );
  for (const item of section.items ?? []) {
    const name = item.name?.trim();
    if (!name || item.body == null) {
      result.errors.push("script missing name/body");
      continue;
    }
    const pkgName = item.package?.trim() || "";
    const key = `${pkgName}::${name}`;
    if (keySet.has(key)) {
      result.skipped += 1;
      continue;
    }
    try {
      const package_id =
        pkgName && pkgByName.has(pkgName) ? pkgByName.get(pkgName)! : null;
      await createScript({
        name,
        description: item.description ?? null,
        kind: item.kind || "snippet",
        body: item.body,
        package_id,
        paste_only: !!item.paste_only,
        send_mode: item.send_mode === "line" ? "line" : "once",
      });
      keySet.add(key);
      result.created += 1;
    } catch (e) {
      result.errors.push(`script ${name}: ${String(e)}`);
    }
  }
  return result;
}

async function importNotes(doc: XuanjianExport): Promise<ImportResult> {
  const result = emptyResult();
  const section = doc.notes;
  if (!section) return result;

  const cats = await listNoteCategories();
  const catByName = new Map(cats.map((c) => [c.name, c.id]));
  for (const c of section.categories ?? []) {
    const name = c.name?.trim();
    if (!name) continue;
    if (catByName.has(name)) {
      result.skipped += 1;
      continue;
    }
    try {
      const id = await createNoteCategory(name);
      catByName.set(name, id);
      result.created += 1;
    } catch (e) {
      result.errors.push(`category ${name}: ${String(e)}`);
    }
  }

  const existing = await listNotes();
  const titleSet = new Set(existing.map((n) => n.title));
  for (const item of section.items ?? []) {
    const title = item.title?.trim();
    if (!title) {
      result.errors.push("note missing title");
      continue;
    }
    if (titleSet.has(title)) {
      result.skipped += 1;
      continue;
    }
    try {
      const catName = item.category?.trim();
      const category_id =
        catName && catByName.has(catName) ? catByName.get(catName)! : null;
      await createNote({
        title,
        body: item.body ?? "",
        pinned: !!item.pinned,
        category_id,
      });
      titleSet.add(title);
      result.created += 1;
    } catch (e) {
      result.errors.push(`note ${title}: ${String(e)}`);
    }
  }
  return result;
}

async function importDocker(doc: XuanjianExport): Promise<ImportResult> {
  const result = emptyResult();
  if (!doc.dockerProjects?.length) return result;
  const existing = await listDockerProjects();
  const nameSet = new Set(existing.map((p) => p.name));
  for (const p of doc.dockerProjects) {
    const name = p.name?.trim();
    if (!name) {
      result.errors.push("docker project missing name");
      continue;
    }
    if (nameSet.has(name)) {
      result.skipped += 1;
      continue;
    }
    try {
      await createDockerProject({
        name,
        description: p.description ?? "",
        kind: p.kind ?? "full",
        compose_json: JSON.stringify(p.compose ?? {}),
        dockerfiles_json: JSON.stringify(p.dockerfiles ?? {}),
        layout_json: JSON.stringify(p.layout ?? {}),
      });
      nameSet.add(name);
      result.created += 1;
    } catch (e) {
      result.errors.push(`docker ${name}: ${String(e)}`);
    }
  }
  return result;
}

/** 导入整份或分段导出；同名跳过 */
export async function applyImport(doc: XuanjianExport): Promise<ImportResult> {
  let result = emptyResult();
  result = mergeResult(result, await importHosts(doc));
  result = mergeResult(result, await importScripts(doc));
  result = mergeResult(result, await importNotes(doc));
  result = mergeResult(result, await importDocker(doc));
  return result;
}
