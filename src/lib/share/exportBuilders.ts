/**
 * @file 构建 xuanjian-export JSON
 * @author Charlie
 */

import { listDockerProjects } from "@/lib/db/dockerProjects";
import { listGroups, listHosts } from "@/lib/db/hosts";
import { listNoteCategories, listNotes } from "@/lib/db/notes";
import { listScriptPackages, listScripts } from "@/lib/db/scripts";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  type ExportDockerProject,
  type ExportHostItem,
  type XuanjianExport,
} from "@/lib/share/types";
import { api } from "@/lib/tauri";

export type BuildExportOptions = {
  /** 是否导出主机明文口令（需二次确认） */
  includeHostSecrets?: boolean;
  sections?: {
    hosts?: boolean;
    scripts?: boolean;
    notes?: boolean;
    dockerProjects?: boolean;
  };
  /** 仅导出这些 id（缺省 = 该段全部） */
  hostIds?: number[];
  scriptIds?: number[];
  noteIds?: number[];
  dockerProjectIds?: number[];
};

function idSet(ids?: number[]): Set<number> | null {
  if (!ids) return null;
  return new Set(ids);
}

/** 从当前库构建导出对象 */
export async function buildExport(
  options: BuildExportOptions = {},
): Promise<XuanjianExport> {
  const sections = options.sections ?? {
    hosts: true,
    scripts: true,
    notes: true,
    dockerProjects: true,
  };
  const doc: XuanjianExport = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
  };

  if (sections.hosts !== false) {
    const groups = await listGroups();
    let hosts = await listHosts();
    const filter = idSet(options.hostIds);
    if (filter) hosts = hosts.filter((h) => filter.has(h.id));
    const byId = new Map((await listHosts()).map((h) => [h.id, h]));
    const usedGroupNames = new Set(
      hosts.map((h) => h.group_name).filter(Boolean) as string[],
    );
    const items: ExportHostItem[] = [];
    for (const h of hosts) {
      const jump = h.jump_host_id != null ? byId.get(h.jump_host_id) : null;
      const item: ExportHostItem = {
        name: h.name,
        host: h.host,
        port: h.port,
        username: h.username,
        auth_type: h.auth_type,
        group: h.group_name ?? null,
        tags: h.tags
          ? h.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        remark: h.remark ?? null,
        color: h.color ?? null,
        connect_timeout: h.connect_timeout ?? null,
        keepalive_interval: h.keepalive_interval ?? null,
        terminal_type: h.terminal_type ?? null,
        startup_cmd: h.startup_cmd ?? null,
        remote_path: h.remote_path ?? null,
        jump_host: jump?.name ?? null,
        private_key_path: h.private_key_path ?? null,
      };
      if (options.includeHostSecrets) {
        if (h.password_enc) {
          try {
            item.password = await api.decryptSecret(h.password_enc);
          } catch {
            item.password = null;
          }
        }
        if (h.passphrase_enc) {
          try {
            item.passphrase = await api.decryptSecret(h.passphrase_enc);
          } catch {
            item.passphrase = null;
          }
        }
      }
      items.push(item);
    }
    doc.hosts = {
      groups: groups
        .filter((g) => !filter || usedGroupNames.has(g.name))
        .map((g) => ({ name: g.name, sort_order: g.sort_order })),
      items,
    };
  }

  if (sections.scripts !== false) {
    const packages = await listScriptPackages();
    let scripts = await listScripts();
    const filter = idSet(options.scriptIds);
    if (filter) scripts = scripts.filter((s) => filter.has(s.id));
    const usedPkgs = new Set(
      scripts.map((s) => s.package_name).filter(Boolean) as string[],
    );
    doc.scripts = {
      packages: packages
        .filter((p) => !filter || usedPkgs.has(p.name))
        .map((p) => ({
          name: p.name,
          sort_order: p.sort_order,
        })),
      items: scripts.map((s) => ({
        name: s.name,
        description: s.description,
        kind: s.kind,
        body: s.body,
        package: s.package_name ?? null,
        paste_only: !!s.paste_only,
        send_mode: s.send_mode === "line" ? "line" : "once",
      })),
    };
  }

  if (sections.notes !== false) {
    const categories = await listNoteCategories();
    let notes = await listNotes();
    const filter = idSet(options.noteIds);
    if (filter) notes = notes.filter((n) => filter.has(n.id));
    const usedCats = new Set(
      notes.map((n) => n.category_name).filter(Boolean) as string[],
    );
    doc.notes = {
      categories: categories
        .filter((c) => !filter || usedCats.has(c.name))
        .map((c) => ({
          name: c.name,
          sort_order: c.sort_order,
        })),
      items: notes.map((n) => ({
        title: n.title,
        body: n.body,
        pinned: !!n.pinned,
        category: n.category_name ?? null,
      })),
    };
  }

  if (sections.dockerProjects !== false) {
    let projects = await listDockerProjects();
    const filter = idSet(options.dockerProjectIds);
    if (filter) projects = projects.filter((p) => filter.has(p.id));
    const dockerProjects: ExportDockerProject[] = projects.map((p) => {
      let compose: unknown = {};
      let dockerfiles: Record<string, string> = {};
      let layout: unknown = {};
      try {
        compose = JSON.parse(p.compose_json || "{}");
      } catch {
        compose = {};
      }
      try {
        dockerfiles = JSON.parse(p.dockerfiles_json || "{}");
      } catch {
        dockerfiles = {};
      }
      try {
        layout = JSON.parse(p.layout_json || "{}");
      } catch {
        layout = {};
      }
      return {
        name: p.name,
        description: p.description,
        kind: p.kind,
        compose,
        dockerfiles,
        layout,
      };
    });
    doc.dockerProjects = dockerProjects;
  }

  return doc;
}

export function stringifyExport(doc: XuanjianExport): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
