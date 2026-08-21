/**
 * @file Docker 编排控制台
 * @author Charlie
 * @description 项目列表 + Compose/Dockerfile 表单编排；本地 SQLite 持久化。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Box,
  Container,
  FileCode2,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { dialogs } from "@/lib/dialogs";
import { api } from "@/lib/tauri";
import {
  createDockerProject,
  deleteDockerProject,
  listDockerProjects,
  updateDockerProject,
  type DockerProjectRow,
} from "@/lib/db";
import { toast } from "sonner";
import {
  emptyComposeDoc,
  type ComposeDoc,
  type DockerfilesMap,
} from "./model/composeTypes";
import {
  parseComposeYaml,
  stringifyComposeYaml,
} from "./model/composeYaml";
import { ComposeStudio } from "./compose/ComposeStudio";
import { DockerfileStudio } from "./dockerfile/DockerfileStudio";
import { DOCKER_TEMPLATES } from "./templates";

type StudioTab = "compose" | "dockerfile";

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
    setDirty(false);
  }, [active]);

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
        compose_json: JSON.stringify(tpl.compose),
        dockerfiles_json: JSON.stringify(tpl.dockerfiles),
        layout_json: "{}",
      });
      setTemplateOpen(false);
      await reload();
      syncedIdRef.current = null;
      setActiveId(id);
      setTab("compose");
    } catch (e) {
      await dialogs.alert(String(e));
    }
  };

  const createBlank = async () => {
    await createFromTemplate("blank");
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
      <aside className="flex w-44 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center justify-between gap-1 border-b border-sidebar-border px-2 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Container size={15} className="shrink-0 text-sidebar-primary" />
            <span className="truncate text-sm font-semibold text-sidebar-foreground">
              {t("docker.title")}
            </span>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={() => setTemplateOpen(true)}
            title={t("docker.new")}
          >
            <Plus size={14} />
          </Button>
        </div>
        <nav className="flex-1 overflow-auto p-1">
          {projects.length === 0 ? (
            <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">
              {t("docker.emptyProjects")}
            </div>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  if (dirty && activeId) void saveProject();
                  syncedIdRef.current = null;
                  setActiveId(p.id);
                }}
                className={cn(
                  "mb-0.5 w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  activeId === p.id
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                )}
                title={p.description || p.name}
              >
                {p.name}
              </button>
            ))
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
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
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
              <div className="flex rounded-md border border-border p-0.5">
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 rounded px-3 py-1 text-xs",
                    tab === "compose" && "bg-accent font-medium",
                  )}
                  onClick={() => setTab("compose")}
                >
                  <Box size={12} />
                  Compose
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 rounded px-3 py-1 text-xs",
                    tab === "dockerfile" && "bg-accent font-medium",
                  )}
                  onClick={() => setTab("dockerfile")}
                >
                  <FileCode2 size={12} />
                  Dockerfile
                </button>
              </div>
              <div className="ml-auto flex items-center gap-1">
                {dirty ? (
                  <span className="mr-1 text-[11px] text-muted-foreground">
                    {t("docker.unsaved")}
                  </span>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={!dirty || saving}
                  onClick={() => void saveProject()}
                >
                  {saving ? (
                    <Loader2 size={14} className="mr-1 animate-spin" />
                  ) : (
                    <Save size={14} className="mr-1" />
                  )}
                  {t("docker.save")}
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => void removeProject()}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              {tab === "compose" ? (
                <ComposeStudio
                  key={`compose-${activeId}`}
                  doc={doc}
                  dockerfiles={dockerfiles}
                  onDocChange={markDirtyDoc}
                  onImportYaml={importComposeYaml}
                  onExportYaml={() => void exportCompose()}
                />
              ) : (
                <DockerfileStudio
                  key={`df-${activeId}`}
                  dockerfiles={dockerfiles}
                  onChange={markDirtyDf}
                  onExport={(p, c) => void exportDockerfile(p, c)}
                />
              )}
            </div>
          </>
        )}
      </main>

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("docker.newProject")}</DialogTitle>
          </DialogHeader>
          <div className="grid max-h-[50vh] gap-2 overflow-auto py-2">
            {DOCKER_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="rounded-md border border-border px-3 py-2 text-left hover:bg-accent/60"
                onClick={() => void createFromTemplate(tpl.id)}
              >
                <div className="text-sm font-medium">{t(tpl.nameKey)}</div>
                <div className="text-xs text-muted-foreground">
                  {t(tpl.descriptionKey)}
                </div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void createBlank()}
            >
              {t("docker.tplBlank")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
