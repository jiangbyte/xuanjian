/**
 * @file 脚本片段控制台
 * @author Charlie
 * @description 管理脚本包与片段：搜索、编辑（Monaco）、新建/删除，并打开运行目标弹窗。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus, Play, Plus, Search, Terminal, X, Zap } from "lucide-react";
import Editor from "@monaco-editor/react";
import {
  createScript,
  createScriptPackage,
  deleteScript,
  deleteScriptPackage,
  listScriptPackages,
  listScripts,
  renameScriptPackage,
  ScriptInput,
  ScriptPackageRow,
  ScriptRow,
  updateScript,
} from "@/lib/db";
import { previewScriptBody } from "@/lib/scriptVars";
import { openContextMenu, useContextMenu } from "@/components/ContextMenu";
import { resolveMonacoTheme, useSettingsStore } from "@/stores/settings";
import { Select } from "@/components/Select";
import { useDialog } from "@/components/Dialog";
import { RunScriptTargetModal } from "@/features/scripts/RunScriptTargetModal";

/** 脚本包与片段管理主界面 */
export function ScriptsConsole() {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
  const dialog = useDialog();
  const [packages, setPackages] = useState<ScriptPackageRow[]>([]);
  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [packageId, setPackageId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ScriptRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [runTarget, setRunTarget] = useState<ScriptRow | null>(null);

  const reload = async () => {
    setPackages(await listScriptPackages());
    setScripts(await listScripts());
  };

  useEffect(() => {
    reload().catch(console.error);
  }, []);

  const packageCounts = useMemo(() => {
    const map = new Map<number | "none", number>();
    map.set("none", 0);
    for (const p of packages) map.set(p.id, 0);
    for (const s of scripts) {
      if (s.package_id == null) map.set("none", (map.get("none") || 0) + 1);
      else map.set(s.package_id, (map.get(s.package_id) || 0) + 1);
    }
    return map;
  }, [packages, scripts]);

  const filtered = useMemo(() => {
    let list = [...scripts];
    if (packageId === -1) list = list.filter((s) => s.package_id == null);
    else if (packageId != null)
      list = list.filter((s) => s.package_id === packageId);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.body.toLowerCase().includes(q) ||
          (s.description || "").toLowerCase().includes(q) ||
          (s.package_name || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [scripts, packageId, search]);

  const title = useMemo(() => {
    if (packageId === -1) return t("scripts.ungrouped");
    if (packageId != null) {
      return (
        packages.find((p) => p.id === packageId)?.name || t("scripts.title")
      );
    }
    return t("scripts.allPackages");
  }, [packageId, packages, t]);

  return (
    <div className="flex h-full flex-col">
      {/* —— 工具栏 —— */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="field-icon-wrap flex-1">
          <Search size={14} className="field-icon" />
          <input
            className="field"
            placeholder={t("scripts.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setCreating(true);
            setEditing(null);
          }}
        >
          <Plus size={14} />
          {t("scripts.newSnippet")}
        </button>
        <button
          className="btn"
          onClick={async () => {
            const name = await dialog.prompt(t("scripts.packageNamePrompt"), {
              title: t("scripts.newPackage"),
            });
            if (!name?.trim()) return;
            try {
              const id = await createScriptPackage(name);
              await reload();
              setPackageId(id);
            } catch (e) {
              await dialog.alert(String(e));
            }
          }}
        >
          <FolderPlus size={14} />
          {t("scripts.newPackage")}
        </button>
      </div>

      {/* —— 包侧栏 + 脚本列表 / 编辑器 —— */}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)]">
          <div className="px-3 py-3">
            <span className="text-xs font-medium uppercase tracking-wide muted">
              {t("scripts.packages")}
            </span>
          </div>
          <div className="side-nav flex-1 overflow-y-auto px-2 pb-3">
            <button
              type="button"
              className={`list-row ${packageId == null ? "is-active" : ""}`}
              onClick={() => setPackageId(null)}
            >
              <span className="min-w-0 flex-1 truncate text-left text-sm">
                {t("scripts.allPackages")}
              </span>
              <span className="count-badge">{scripts.length}</span>
            </button>
            {packages.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`list-row ${packageId === p.id ? "is-active" : ""}`}
                onClick={() => setPackageId(p.id)}
                onContextMenu={(e) =>
                  openContextMenu(e, openMenu, [
                    {
                      id: "rename",
                      label: t("scripts.renamePackage"),
                      onClick: async () => {
                        const name = await dialog.prompt(
                          t("scripts.packageNamePrompt"),
                          {
                            title: t("scripts.renamePackage"),
                            defaultValue: p.name,
                          },
                        );
                        if (!name?.trim()) return;
                        await renameScriptPackage(p.id, name);
                        await reload();
                      },
                    },
                    {
                      id: "delete",
                      label: t("scripts.deletePackage"),
                      danger: true,
                      onClick: async () => {
                        if (
                          !(await dialog.confirm(
                            t("scripts.deletePackageConfirm"),
                            {
                              danger: true,
                            },
                          ))
                        )
                          return;
                        await deleteScriptPackage(p.id);
                        if (packageId === p.id) setPackageId(null);
                        await reload();
                      },
                    },
                  ])
                }
              >
                <span className="min-w-0 flex-1 truncate text-left text-sm">
                  {p.name}
                </span>
                <span className="count-badge">
                  {packageCounts.get(p.id) || 0}
                </span>
              </button>
            ))}
            <button
              type="button"
              className={`list-row ${packageId === -1 ? "is-active" : ""}`}
              onClick={() => setPackageId(-1)}
            >
              <span className="min-w-0 flex-1 truncate text-left text-sm">
                {t("scripts.ungrouped")}
              </span>
              <span className="count-badge">
                {packageCounts.get("none") || 0}
              </span>
            </button>
          </div>
        </aside>

        <div className="flex-1 overflow-auto p-5">
          <h2 className="mb-1 text-lg font-semibold">{title}</h2>
          <p className="mb-4 text-xs muted">
            {t("scripts.count", { count: filtered.length })}
          </p>
          {filtered.length === 0 ? (
            <div className="empty-state">{t("scripts.empty")}</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((script) => (
                <div
                  key={script.id}
                  className="host-card cursor-pointer"
                  onClick={() => {
                    setEditing(script);
                    setCreating(false);
                  }}
                  onContextMenu={(e) =>
                    openContextMenu(e, openMenu, [
                      {
                        id: "run",
                        label: t("scripts.run"),
                        onClick: () => setRunTarget(script),
                      },
                      {
                        id: "edit",
                        label: t("scripts.edit"),
                        onClick: () => {
                          setEditing(script);
                          setCreating(false);
                        },
                      },
                      "sep",
                      {
                        id: "delete",
                        label: t("scripts.delete"),
                        danger: true,
                        onClick: async () => {
                          if (
                            !(await dialog.confirm(t("scripts.deleteConfirm"), {
                              danger: true,
                            }))
                          )
                            return;
                          await deleteScript(script.id);
                          await reload();
                        },
                      },
                    ])
                  }
                >
                  <div className="flex items-start gap-3">
                    <div className="host-avatar">
                      <Zap size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">
                        {script.name}
                      </div>
                      {script.description && (
                        <div className="mt-0.5 truncate text-xs muted">
                          {script.description}
                        </div>
                      )}
                      <div className="mt-2 truncate font-mono text-xs muted">
                        {previewScriptBody(script.body)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {script.package_name && (
                          <span className="chip">{script.package_name}</span>
                        )}
                        {script.paste_only ? (
                          <span className="chip">
                            {t("scripts.pasteOnlyShort")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRunTarget(script);
                      }}
                    >
                      <Play size={13} />
                      {t("scripts.run")}
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(script);
                        setCreating(false);
                      }}
                    >
                      {t("scripts.edit")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {(creating || editing) && (
        <ScriptEditorModal
          packages={packages}
          initial={editing}
          defaultPackageId={
            packageId != null && packageId !== -1
              ? packageId
              : (packages[0]?.id ?? null)
          }
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (input) => {
            if (editing) await updateScript(editing.id, input);
            else await createScript(input);
            setCreating(false);
            setEditing(null);
            await reload();
          }}
          onDelete={
            editing
              ? async () => {
                  if (
                    !(await dialog.confirm(t("scripts.deleteConfirm"), {
                      danger: true,
                    }))
                  )
                    return;
                  await deleteScript(editing.id);
                  setEditing(null);
                  await reload();
                }
              : undefined
          }
          onRun={editing ? () => setRunTarget(editing) : undefined}
        />
      )}

      {runTarget && (
        <RunScriptTargetModal
          script={runTarget}
          onClose={() => setRunTarget(null)}
        />
      )}
    </div>
  );
}

/** 新建 / 编辑脚本片段的模态编辑器 */
function ScriptEditorModal({
  initial,
  packages,
  defaultPackageId,
  onClose,
  onSave,
  onDelete,
  onRun,
}: {
  initial: ScriptRow | null;
  packages: ScriptPackageRow[];
  defaultPackageId: number | null;
  onClose: () => void;
  onSave: (input: ScriptInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onRun?: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [body, setBody] = useState(initial?.body || "");
  const [packageId, setPackageId] = useState<number | "">(
    initial?.package_id ?? defaultPackageId ?? "",
  );
  const [pasteOnly, setPasteOnly] = useState(Boolean(initial?.paste_only));
  const [sendMode, setSendMode] = useState<"once" | "line">(
    initial?.send_mode === "line" ? "line" : "once",
  );
  const [saving, setSaving] = useState(false);
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const editorWordWrap = useSettingsStore((s) => s.editorWordWrap);
  const appTheme = useSettingsStore((s) => s.theme);
  const monacoTheme = resolveMonacoTheme(editorTheme);
  void appTheme;

  return (
    <div
      className="overlay flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="modal-card flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-base font-semibold">
            {initial ? t("scripts.editSnippet") : t("scripts.newSnippet")}
          </h3>
          <div className="flex items-center gap-1">
            {onRun && (
              <button
                className="icon-btn"
                title={t("scripts.run")}
                onClick={onRun}
              >
                <Play size={16} />
              </button>
            )}
            <button className="icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="field-label">
              {t("scripts.name")}
              <input
                className="field"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field-label">
              {t("scripts.package")}
              <Select
                className="w-full"
                value={packageId === "" ? "" : String(packageId)}
                options={[
                  { value: "", label: t("scripts.ungrouped") },
                  ...packages.map((p) => ({
                    value: String(p.id),
                    label: p.name,
                  })),
                ]}
                onChange={(v) => setPackageId(v ? Number(v) : "")}
              />
            </label>
          </div>
          <label className="field-label">
            {t("scripts.description")}
            <textarea
              className="field min-h-[56px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("scripts.descriptionHint")}
            />
          </label>
          <div className="field-label">
            {t("scripts.body")}
            <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
              <Editor
                height="260px"
                language="shell"
                theme={monacoTheme}
                value={body}
                onChange={(v) => setBody(v ?? "")}
                options={{
                  fontSize: editorFontSize,
                  minimap: { enabled: false },
                  wordWrap: editorWordWrap ? "on" : "off",
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  lineNumbers: "on",
                  renderLineHighlight: "line",
                  padding: { top: 8, bottom: 8 },
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                }}
              />
            </div>
            <span className="text-[11px] muted">{t("scripts.varsHint")}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={pasteOnly}
                onChange={(e) => setPasteOnly(e.target.checked)}
              />
              {t("scripts.pasteOnly")}
            </label>
            <label className="field-label">
              {t("scripts.sendMode")}
              <Select
                className="w-full"
                value={sendMode}
                options={[
                  { value: "once", label: t("scripts.sendOnce") },
                  { value: "line", label: t("scripts.sendLine") },
                ]}
                onChange={(v) => setSendMode(v as "once" | "line")}
              />
            </label>
          </div>
          <p className="text-[11px] muted">{t("scripts.sendModeHint")}</p>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs muted">
            <div className="mb-1 flex items-center gap-1.5 text-[var(--text)]">
              <Terminal size={13} />
              {t("scripts.runTarget")}
            </div>
            {t("scripts.runTargetHint")}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          {onDelete && (
            <button
              className="btn btn-danger mr-auto"
              onClick={() => onDelete()}
              disabled={saving}
            >
              {t("scripts.delete")}
            </button>
          )}
          <button className="btn" onClick={onClose} disabled={saving}>
            {t("hosts.cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={saving || !name.trim() || !body.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  name: name.trim(),
                  description: description.trim() || null,
                  kind: "snippet",
                  body,
                  package_id: packageId === "" ? null : packageId,
                  paste_only: pasteOnly,
                  send_mode: sendMode,
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            {t("hosts.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
