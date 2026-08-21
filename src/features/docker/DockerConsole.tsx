/**
 * @file Docker 编排控制台
 * @author Charlie
 * @description 项目列表 + Compose/Dockerfile 表单编排；本地 SQLite 持久化。
 */

import { save } from "@tauri-apps/plugin-dialog";
import {
  Box,
  Container,
  FileCode2,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  SectionAsideHeader,
  sectionAsideClass,
  sectionAsideIconBtnClass,
} from "@/components/SectionSidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BatchActionBar } from "@/features/share/BatchActionBar";
import {
  createDockerProject,
  type DockerProjectKind,
  type DockerProjectRow,
  deleteDockerProject,
  listDockerProjects,
  updateDockerProject,
} from "@/lib/db";
import { dialogs } from "@/lib/dialogs";
import {
  selectionCheckboxClass,
  selectionNavClass,
  selectionRow,
} from "@/lib/selection";
import { exportToFile, formatImportToast, importFromFile } from "@/lib/share";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import {
  type ComposeDoc,
  type DockerfilesMap,
  emptyComposeDoc,
} from "./model/composeTypes";
import { parseComposeYaml, stringifyComposeYaml } from "./model/composeYaml";
import { DOCKER_TEMPLATES, templatesForKind } from "./templates";

const ComposeStudio = lazy(() =>
  import("./compose/ComposeStudio").then((m) => ({ default: m.ComposeStudio })),
);
const DockerfileStudio = lazy(() =>
  import("./dockerfile/DockerfileStudio").then((m) => ({
    default: m.DockerfileStudio,
  })),
);

type StudioTab = "compose" | "dockerfile";

const KIND_OPTIONS: {
  id: DockerProjectKind;
  labelKey: string;
  descKey: string;
}[] = [
  {
    id: "compose",
    labelKey: "docker.kindCompose",
    descKey: "docker.kindComposeDesc",
  },
  {
    id: "dockerfile",
    labelKey: "docker.kindDockerfile",
    descKey: "docker.kindDockerfileDesc",
  },
  {
    id: "full",
    labelKey: "docker.kindFull",
    descKey: "docker.kindFullDesc",
  },
];

function tabForKind(kind: DockerProjectKind): StudioTab {
  return kind === "dockerfile" ? "dockerfile" : "compose";
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Docker 编排主控制台 */
export function DockerConsole() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<DockerProjectRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<StudioTab>("compose");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [doc, setDoc] = useState<ComposeDoc>(emptyComposeDoc);
  const [dockerfiles, setDockerfiles] = useState<DockerfilesMap>({});
  const [templateOpen, setTemplateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<DockerProjectKind>("compose");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const syncedIdRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    const rows = await listDockerProjects();
    setProjects(rows);
    return rows;
  }, []);

  useEffect(() => {
    reload()
      .then((rows) => {
        if (rows[0]) setActiveId(rows[0].id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [reload]);

  const active = useMemo(
    () => projects.find((p) => p.id === activeId) ?? null,
    [projects, activeId],
  );

  useEffect(() => {
    if (!active) {
      syncedIdRef.current = null;
      setName("");
      setDescription("");
      setDoc(emptyComposeDoc());
      setDockerfiles({});
      setDirty(false);
      return;
    }
    if (syncedIdRef.current === active.id) return;
    syncedIdRef.current = active.id;
    setName(active.name);
    setDescription(active.description);
    setDoc(parseJson(active.compose_json, emptyComposeDoc()));
    setDockerfiles(parseJson(active.dockerfiles_json, {}));
    setTab(tabForKind(active.kind));
    setDirty(false);
  }, [active]);

  const projectKind: DockerProjectKind = active?.kind ?? "full";
  const showCompose = projectKind === "compose" || projectKind === "full";
  const showDockerfile = projectKind === "dockerfile" || projectKind === "full";
  const showStudioTabs = projectKind === "full";
  const studioTab: StudioTab = showStudioTabs ? tab : tabForKind(projectKind);

  const markDirtyDoc = (next: ComposeDoc) => {
    setDoc(next);
    setDirty(true);
  };
  const markDirtyDf = (next: DockerfilesMap) => {
    setDockerfiles(next);
    setDirty(true);
  };

  const saveProject = useCallback(async () => {
    if (!activeId) return;
    setSaving(true);
    try {
      await updateDockerProject(activeId, {
        name: name.trim() || t("docker.untitled"),
        description,
        compose_json: JSON.stringify(doc),
        dockerfiles_json: JSON.stringify(dockerfiles),
        layout_json: "{}",
      });
      setDirty(false);
      await reload();
      toast.success(t("docker.saved"));
    } catch (e) {
      await dialogs.alert(String(e));
    } finally {
      setSaving(false);
    }
  }, [activeId, name, description, doc, dockerfiles, reload, t]);

  useEffect(() => {
    if (!dirty || !activeId) return;
    const timer = window.setTimeout(() => {
      void saveProject();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, doc, dockerfiles, name, description, activeId, saveProject]);

  const createFromTemplate = async (templateId: string) => {
    const tpl = DOCKER_TEMPLATES.find((x) => x.id === templateId);
    if (!tpl) return;
    try {
      const id = await createDockerProject({
        name: t(tpl.nameKey),
        description: t(tpl.descriptionKey),
        kind: tpl.kind,
        compose_json: JSON.stringify(tpl.compose),
        dockerfiles_json: JSON.stringify(tpl.dockerfiles),
        layout_json: "{}",
      });
      setTemplateOpen(false);
      await reload();
      syncedIdRef.current = null;
      setActiveId(id);
      setTab(tabForKind(tpl.kind));
    } catch (e) {
      await dialogs.alert(String(e));
    }
  };

  const createBlank = async () => {
    const blankId =
      createKind === "compose"
        ? "blank-compose"
        : createKind === "dockerfile"
          ? "blank-dockerfile"
          : "blank-full";
    await createFromTemplate(blankId);
  };

  const removeProject = async () => {
    if (!activeId) return;
    const ok = await dialogs.confirm(t("docker.deleteConfirm", { name }));
    if (!ok) return;
    await deleteDockerProject(activeId);
    syncedIdRef.current = null;
    setActiveId(null);
    const rows = await reload();
    if (rows[0]) setActiveId(rows[0].id);
  };

  const exportCompose = async () => {
    const path = await save({
      defaultPath: "docker-compose.yml",
      filters: [{ name: "YAML", extensions: ["yml", "yaml"] }],
    });
    if (!path) return;
    await api.writeLocalFile(path, stringifyComposeYaml(doc));
    toast.success(t("docker.exported"));
  };

  const importComposeYaml = (text: string) => {
    try {
      const next = parseComposeYaml(text);
      markDirtyDoc(next);
      toast.success(t("docker.imported"));
    } catch (e) {
      void dialogs.alert(String(e));
    }
  };

  const exportDockerfile = async (pathName: string, content: string) => {
    const path = await save({
      defaultPath: pathName.replace(/\//g, "_") || "Dockerfile",
    });
    if (!path) return;
    await api.writeLocalFile(path, content);
    toast.success(t("docker.exported"));
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className={sectionAsideClass}>
        <SectionAsideHeader
          title={t("docker.title")}
          icon={
            <Container size={15} className="shrink-0 text-muted-foreground" />
          }
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={sectionAsideIconBtnClass}
            onClick={() => {
              importFromFile()
                .then(async (r) => {
                  if (!r) return;
                  await reload();
                  toast.success(
                    `${t("share.importDone")} (${formatImportToast(r)})`,
                  );
                })
                .catch((e) => toast.error(String(e)));
            }}
            title={t("share.import")}
          >
            <Upload size={14} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={sectionAsideIconBtnClass}
            onClick={() => {
              setCreateKind("compose");
              setTemplateOpen(true);
            }}
            title={t("docker.new")}
          >
            <Plus size={14} />
          </Button>
        </SectionAsideHeader>
        <BatchActionBar
          className="gap-1.5 px-2"
          selectedCount={selectedIds.size}
          totalCount={projects.length}
          onSelectAll={() => setSelectedIds(new Set(projects.map((p) => p.id)))}
          onClear={() => setSelectedIds(new Set())}
          onExport={() => {
            const ids = [...selectedIds];
            if (!ids.length) {
              toast.error(t("batch.needSelect"));
              return;
            }
            exportToFile(
              {
                sections: {
                  hosts: false,
                  scripts: false,
                  notes: false,
                  dockerProjects: true,
                },
                dockerProjectIds: ids,
              },
              "xuanjian-docker.json",
            )
              .then((ok) => {
                if (ok) toast.success(t("share.exportDone"));
              })
              .catch((e) => toast.error(String(e)));
          }}
          onDelete={() => {
            const ids = [...selectedIds];
            if (!ids.length) return;
            void (async () => {
              if (
                !(await dialogs.confirm(
                  t("batch.deleteConfirm", { count: ids.length }),
                  { danger: true },
                ))
              )
                return;
              for (const id of ids) await deleteDockerProject(id);
              setSelectedIds(new Set());
              if (activeId != null && ids.includes(activeId)) {
                setActiveId(null);
              }
              await reload();
            })();
          }}
        />
        <nav className="flex-1 overflow-auto p-1">
          {projects.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t("docker.emptyProjects")}
            </div>
          ) : (
            projects.map((p) => {
              const selected = selectedIds.has(p.id);
              const active = activeId === p.id;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                    !selected &&
                      (active
                        ? selectionNavClass
                        : "text-sidebar-foreground hover:bg-sidebar-accent"),
                    selectionRow(selected, selected && active && "font-medium"),
                  )}
                >
                  <Checkbox
                    className={cn(selected && selectionCheckboxClass)}
                    checked={selected}
                    onCheckedChange={(v) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (v === true) next.add(p.id);
                        else next.delete(p.id);
                        return next;
                      });
                    }}
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => {
                      if (dirty && activeId) void saveProject();
                      syncedIdRef.current = null;
                      setActiveId(p.id);
                    }}
                    title={p.description || p.name}
                  >
                    <span className="block truncate">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.kind === "compose"
                        ? t("docker.kindCompose")
                        : p.kind === "dockerfile"
                          ? t("docker.kindDockerfile")
                          : t("docker.kindFull")}
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        {!active ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">
              {t("docker.emptyProjects")}
            </p>
            <Button type="button" onClick={() => setTemplateOpen(true)}>
              <Plus size={14} className="mr-1" />
              {t("docker.new")}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 flex-col border-b border-border">
              <div className="flex items-center gap-2 px-3 py-2">
                <Input
                  className="h-8 max-w-[200px] font-medium"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                />
                <Input
                  className="h-8 max-w-[240px] text-xs"
                  value={description}
                  placeholder={t("docker.description")}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setDirty(true);
                  }}
                />
                <Badge variant="secondary" className="shrink-0">
                  {projectKind === "compose"
                    ? t("docker.kindCompose")
                    : projectKind === "dockerfile"
                      ? t("docker.kindDockerfile")
                      : t("docker.kindFull")}
                </Badge>
                <div className="ml-auto flex items-center gap-1">
                  {dirty ? (
                    <span className="mr-1 text-xs text-muted-foreground">
                      {t("docker.unsaved")}
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    disabled={!dirty || saving}
                    title={t("docker.save")}
                    aria-label={t("docker.save")}
                    onClick={() => void saveProject()}
                  >
                    {saving ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Save size={14} />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    title={t("docker.delete")}
                    aria-label={t("docker.delete")}
                    onClick={() => void removeProject()}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
              {showStudioTabs ? (
                <div className="flex border-t border-border px-2">
                  <button
                    type="button"
                    className={cn(
                      "relative flex min-w-[9rem] flex-1 items-center justify-center gap-2 px-6 py-2.5 text-sm transition-colors sm:max-w-[14rem]",
                      studioTab === "compose"
                        ? "font-medium text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                    onClick={() => setTab("compose")}
                  >
                    <Box size={15} />
                    {t("docker.composeTab")}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "relative flex min-w-[9rem] flex-1 items-center justify-center gap-2 px-6 py-2.5 text-sm transition-colors sm:max-w-[14rem]",
                      studioTab === "dockerfile"
                        ? "font-medium text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                    onClick={() => setTab("dockerfile")}
                  >
                    <FileCode2 size={15} />
                    {t("docker.dockerfileTab")}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="min-h-0 flex-1">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    …
                  </div>
                }
              >
                {studioTab === "compose" && showCompose ? (
                  <ComposeStudio
                    key={`compose-${activeId}`}
                    doc={doc}
                    dockerfiles={dockerfiles}
                    onDocChange={markDirtyDoc}
                    onImportYaml={importComposeYaml}
                    onExportYaml={() => void exportCompose()}
                  />
                ) : studioTab === "dockerfile" && showDockerfile ? (
                  <DockerfileStudio
                    key={`df-${activeId}`}
                    dockerfiles={dockerfiles}
                    onChange={markDirtyDf}
                    onExport={(p, c) => void exportDockerfile(p, c)}
                  />
                ) : null}
              </Suspense>
            </div>
          </>
        )}
      </main>

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="flex h-[min(560px,85vh)] w-[min(760px,calc(100%-2rem))] max-w-none flex-col gap-5 overflow-hidden p-6 sm:max-w-none">
          <DialogHeader className="shrink-0">
            <DialogTitle>{t("docker.newProject")}</DialogTitle>
          </DialogHeader>
          <div className="grid shrink-0 gap-3 sm:grid-cols-3">
            {KIND_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={cn(
                  "rounded-md border px-3.5 py-3 text-left transition-colors",
                  createKind === opt.id
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-muted",
                )}
                onClick={() => setCreateKind(opt.id)}
              >
                <div className="whitespace-nowrap text-sm font-semibold">
                  {t(opt.labelKey)}
                </div>
                <div className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
                  {t(opt.descKey)}
                </div>
              </button>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto">
            {templatesForKind(createKind).map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="rounded-md border border-border px-4 py-3 text-left hover:bg-muted"
                onClick={() => void createFromTemplate(tpl.id)}
              >
                <div className="whitespace-nowrap text-sm font-medium">
                  {t(tpl.nameKey)}
                </div>
                <div className="mt-0.5 whitespace-nowrap text-xs text-muted-foreground">
                  {t(tpl.descriptionKey)}
                </div>
              </button>
            ))}
          </div>
          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => void createBlank()}
            >
              {t("docker.createBlank")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
