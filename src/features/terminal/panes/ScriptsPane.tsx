/**
 * @file 脚本快捷面板
 * @author Charlie
 * @description 按包分组列出本地脚本库，可搜索并在当前会话执行。
 * 搜索时强制展开分组以便看到匹配项。
 * 「管理脚本」跳转到独立脚本页。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Play, Search, Zap } from "lucide-react";
import {
  listScriptPackages,
  listScripts,
  ScriptPackageRow,
  ScriptRow,
} from "@/lib/db";
import { previewScriptBody } from "@/lib/scriptVars";
import { runScriptOnSession } from "@/lib/runScript";
import { useNavigate } from "react-router-dom";
import { useDialog } from "@/components/Dialog";

/** 包分组：有名包或未分组 */
type PackageGroup = {
  id: number | "none";
  name: string;
  scripts: ScriptRow[];
};

/**
 * 终端左侧脚本面板：分组列表 + 一键在当前会话运行。
 */
export function ScriptsPane({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const navigate = useNavigate();
  const [packages, setPackages] = useState<ScriptPackageRow[]>([]);
  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [q, setQ] = useState("");
  const [runningId, setRunningId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.all([listScriptPackages(), listScripts()])
      .then(([pkgs, rows]) => {
        setPackages(pkgs);
        setScripts(rows);
      })
      .catch(console.error);
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return scripts;
    return scripts.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.body.toLowerCase().includes(query) ||
        (s.package_name || "").toLowerCase().includes(query),
    );
  }, [scripts, q]);

  const groups = useMemo((): PackageGroup[] => {
    const map = new Map<number | "none", ScriptRow[]>();
    for (const p of packages) map.set(p.id, []);
    map.set("none", []);
    for (const s of filtered) {
      const key = s.package_id == null ? "none" : s.package_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }

    const result: PackageGroup[] = [];
    for (const p of packages) {
      const items = map.get(p.id) || [];
      if (items.length === 0) continue;
      result.push({ id: p.id, name: p.name, scripts: items });
    }
    const ungrouped = map.get("none") || [];
    if (ungrouped.length > 0) {
      result.push({
        id: "none",
        name: t("scripts.ungrouped"),
        scripts: ungrouped,
      });
    }
    return result;
  }, [packages, filtered, t]);

  const isCollapsed = (id: number | "none") => {
    // 搜索时强制展开，保证匹配项可见
    if (q.trim()) return false;
    return !!collapsed[String(id)];
  };

  const toggle = (id: number | "none") => {
    const key = String(id);
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const run = async (script: ScriptRow) => {
    if (!sessionId) {
      await dialog.alert(t("scripts.needSessionShort"));
      return;
    }
    if (runningId != null) return;
    setRunningId(script.id);
    try {
      await runScriptOnSession(sessionId, script, (label, def) =>
        dialog.prompt(label, { defaultValue: def }),
      );
    } catch (e) {
      await dialog.alert(String(e));
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="panel flex h-full flex-col">
      {/* —— 标题与管理入口 —— */}
      <div className="panel-header flex items-center gap-2">
        <span className="text-xs font-medium">{t("termTab.scripts")}</span>
        <button
          className="btn btn-sm ml-auto"
          onClick={() => navigate("/scripts")}
        >
          {t("termTab.manageScripts")}
        </button>
      </div>

      {/* —— 搜索 —— */}
      <div className="border-b border-[var(--border)] px-2 py-2">
        <div className="field-icon-wrap">
          <Search size={13} className="field-icon" />
          <input
            className="field field-sm"
            placeholder={t("scripts.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* —— 按包分组的脚本列表 —— */}
      <div className="panel-body panel-list min-h-0 flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs muted">
            {t("scripts.empty")}
          </div>
        ) : (
          groups.map((group) => {
            const closed = isCollapsed(group.id);
            return (
              <div key={String(group.id)} className="mb-1">
                <button
                  type="button"
                  className="list-row py-1.5"
                  onClick={() => toggle(group.id)}
                >
                  {closed ? (
                    <ChevronRight size={13} className="shrink-0 muted" />
                  ) : (
                    <ChevronDown size={13} className="shrink-0 muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">
                    {group.name}
                  </span>
                  <span className="count-badge">{group.scripts.length}</span>
                </button>
                {!closed &&
                  group.scripts.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="list-row items-start pl-6"
                      disabled={runningId != null}
                      onClick={() => run(s)}
                    >
                      <Zap
                        size={14}
                        className="mt-0.5 shrink-0 text-[var(--accent)]"
                      />
                      <div className="min-w-0 flex-1 text-left">
                        <div className="list-row-title truncate">{s.name}</div>
                        <div className="list-row-sub truncate font-mono">
                          {previewScriptBody(s.body, 48)}
                        </div>
                      </div>
                      <Play
                        size={13}
                        className={`mt-0.5 shrink-0 ${
                          runningId === s.id
                            ? "opacity-100 text-[var(--accent)]"
                            : "opacity-50"
                        }`}
                      />
                    </button>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
