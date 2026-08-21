/**
 * @file 脚本片段控制台
 * @author Charlie
 * @description 管理脚本包与片段：搜索、编辑（Monaco）、新建/删除，并打开运行目标弹窗。
 */

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { dialogs } from "@/lib/dialogs";
import { useTranslation } from "react-i18next";
import { FolderPlus, Loader2, Play, Plus, Search, Terminal, Zap } from "lucide-react";
import Editor from "@monaco-editor/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
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
import { RunScriptTargetModal } from "@/features/scripts/RunScriptTargetModal";

const NONE = "none";

/** 脚本包与片段管理主界面 */
export function ScriptsConsole() {
  const { t } = useTranslation();
  const { open: openMenu } = useContextMenu();
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
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-nowrap items-center gap-3">
          <InputGroup className="min-w-0 flex-1">
            <InputGroupAddon>
              <Search size={14} />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={t("scripts.search")}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </InputGroup>
          <Button
            onClick={() => {
              setCreating(true);
              setEditing(null);
            }}
          >
            <Plus size={14} />
            {t("scripts.newSnippet")}
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              const name = await dialogs.prompt(t("scripts.packageNamePrompt"), {
                title: t("scripts.newPackage"),
              });
              if (!name?.trim()) return;
              try {
                const id = await createScriptPackage(name);
                await reload();
                setPackageId(id);
              } catch (e) {
                await dialogs.alert(String(e));
              }
            }}
          >
            <FolderPlus size={14} />
            {t("scripts.newPackage")}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-background">
          <div className="px-3 py-3">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              {t("scripts.packages")}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
            <SidebarNavItem
              active={packageId == null}
              label={t("scripts.allPackages")}
              count={scripts.length}
              onClick={() => setPackageId(null)}
            />
            {packages.map((p) => (
              <SidebarNavItem
                key={p.id}
                active={packageId === p.id}
                label={p.name}
                count={packageCounts.get(p.id) || 0}
                onClick={() => setPackageId(p.id)}
                onContextMenu={(e) =>
                  openContextMenu(e, openMenu, [
                    {
                      id: "rename",
                      label: t("scripts.renamePackage"),
                      onClick: async () => {
                        const name = await dialogs.prompt(
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
                          !(await dialogs.confirm(
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
              />
            ))}
            <SidebarNavItem
              active={packageId === -1}
              label={t("scripts.ungrouped")}
              count={packageCounts.get("none") || 0}
              onClick={() => setPackageId(-1)}
            />
          </div>
        </aside>

        <div className="flex-1 overflow-auto p-5">
          <h2 className="mb-1 text-lg font-semibold">{title}</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {t("scripts.count", { count: filtered.length })}
          </p>
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-10">
              <span className="text-muted-foreground">{t("scripts.empty")}</span>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((script) => (
                <Card
                  key={script.id}
                  className="cursor-pointer p-4"
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
                            !(await dialogs.confirm(t("scripts.deleteConfirm"), {
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
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Zap size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{script.name}</p>
                      {script.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {script.description}
                        </p>
                      )}
                      <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
                        {previewScriptBody(script.body)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {script.package_name && (
                          <Badge variant="secondary">
                            {script.package_name}
                          </Badge>
                        )}
                        {script.paste_only ? (
                          <Badge variant="secondary">
                            {t("scripts.pasteOnlyShort")}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRunTarget(script);
                      }}
                    >
                      <Play size={13} />
                      {t("scripts.run")}
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(script);
                        setCreating(false);
                      }}
                    >
                      {t("scripts.edit")}
                    </Button>
                  </div>
                </Card>
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
                    !(await dialogs.confirm(t("scripts.deleteConfirm"), {
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

function SidebarNavItem({
  active,
  label,
  count,
  onClick,
  onContextMenu,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-foreground hover:bg-muted",
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="truncate">{label}</span>
      <Badge variant="secondary" className="shrink-0">
        {count}
      </Badge>
    </button>
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>
              {initial ? t("scripts.editSnippet") : t("scripts.newSnippet")}
            </span>
            {onRun ? (
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("scripts.run")}
                onClick={onRun}
              >
                <Play size={16} />
              </Button>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block">{t("scripts.name")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">{t("scripts.package")}</Label>
              <Select
                value={packageId === "" ? NONE : String(packageId)}
                onValueChange={(v) =>
                  setPackageId(v === NONE ? "" : Number(v))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("scripts.ungrouped")}</SelectItem>
                  {packages.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block">{t("scripts.description")}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              placeholder={t("scripts.descriptionHint")}
              rows={2}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">{t("scripts.body")}</Label>
            <div className="overflow-hidden rounded-md border border-border">
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
            <p className="mt-1 text-xs text-muted-foreground">
              {t("scripts.varsHint")}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-2 self-end pb-2">
              <Checkbox
                id="pasteOnly"
                checked={pasteOnly}
                onCheckedChange={(v) => setPasteOnly(v === true)}
              />
              <Label htmlFor="pasteOnly">{t("scripts.pasteOnly")}</Label>
            </div>
            <div>
              <Label className="mb-1.5 block">{t("scripts.sendMode")}</Label>
              <Select
                value={sendMode}
                onValueChange={(v) => setSendMode(v as "once" | "line")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">{t("scripts.sendOnce")}</SelectItem>
                  <SelectItem value="line">{t("scripts.sendLine")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("scripts.sendModeHint")}
          </p>
          <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            <div className="mb-1 flex items-center gap-1.5 text-foreground">
              <Terminal size={13} />
              {t("scripts.runTarget")}
            </div>
            {t("scripts.runTargetHint")}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {onDelete ? (
            <Button
              variant="destructive"
              className="mr-auto"
              onClick={() => onDelete()}
              disabled={saving}
            >
              {t("scripts.delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              {t("hosts.cancel")}
            </Button>
            <Button
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
              {saving ? <Loader2 className="animate-spin" /> : null}
              {t("hosts.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
