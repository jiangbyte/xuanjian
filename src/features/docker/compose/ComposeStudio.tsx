/**
 * @file Compose 工作室
 * @author Charlie
 * @description 左侧资源类型页签 + 列表/表单，右侧 YAML 对照编辑。
 */

import {
  AlertTriangle,
  Copy,
  Download,
  Play,
  Plus,
  Terminal,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import Editor from "@/components/MonacoEditor";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { clipboardWriteText } from "@/lib/ui/clipboard";
import { api } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { resolveMonacoTheme, useSettingsStore } from "@/stores/settings";
import type { ComposeDoc, DockerfilesMap } from "../model/composeTypes";
import { emptyService } from "../model/composeTypes";
import {
  parseComposeYaml,
  stringifyComposeYaml,
  validateComposeDoc,
} from "../model/composeYaml";
import { ComposeInspector, type ComposeSelection } from "./ComposeInspector";

type ResourceKind = "service" | "network" | "volume";

type Props = {
  doc: ComposeDoc;
  dockerfiles: DockerfilesMap;
  onDocChange: (doc: ComposeDoc) => void;
  onImportYaml: (text: string) => void;
  onExportYaml: () => void;
};

function uniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}${i}`)) i += 1;
  return `${base}${i}`;
}

function firstSelection(doc: ComposeDoc): ComposeSelection {
  const svc = Object.keys(doc.services).sort()[0];
  if (svc) return { kind: "service", name: svc };
  const net = Object.keys(doc.networks).sort()[0];
  if (net) return { kind: "network", name: net };
  const vol = Object.keys(doc.volumes).sort()[0];
  if (vol) return { kind: "volume", name: vol };
  return null;
}

/** Compose：结构编辑 | YAML 对照 */
export function ComposeStudio({
  doc,
  dockerfiles,
  onDocChange,
  onImportYaml,
  onExportYaml,
}: Props) {
  const { t } = useTranslation();
  const monacoTheme = useSettingsStore((s) =>
    resolveMonacoTheme(s.editorTheme),
  );
  const activeSessionId = useUiStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.sessionId ?? null;
  });
  const [kind, setKind] = useState<ResourceKind>("service");
  const [selection, setSelection] = useState<ComposeSelection>(() =>
    firstSelection(doc),
  );
  const [yamlText, setYamlText] = useState(() => stringifyComposeYaml(doc));
  const [yamlError, setYamlError] = useState<string | null>(null);
  const applyingYaml = useRef(false);
  const seededRef = useRef(false);

  useEffect(() => {
    if (applyingYaml.current) {
      applyingYaml.current = false;
      return;
    }
    setYamlText(stringifyComposeYaml(doc));
    setYamlError(null);
  }, [doc]);

  useEffect(() => {
    if (!seededRef.current) {
      seededRef.current = true;
      const first = firstSelection(doc);
      if (first) {
        setSelection(first);
        setKind(first.kind);
      }
      return;
    }
    if (!selection) {
      const first = firstSelection(doc);
      if (first) {
        setSelection(first);
        setKind(first.kind);
      }
      return;
    }
    const exists =
      (selection.kind === "service" && doc.services[selection.name]) ||
      (selection.kind === "network" && doc.networks[selection.name]) ||
      (selection.kind === "volume" && doc.volumes[selection.name]);
    if (!exists) {
      const first = firstSelection(doc);
      setSelection(first);
      if (first) setKind(first.kind);
    }
  }, [doc, selection]);

  const issues = useMemo(() => validateComposeDoc(doc), [doc]);

  const applyYaml = useCallback(
    (text: string) => {
      setYamlText(text);
      try {
        const next = parseComposeYaml(text);
        applyingYaml.current = true;
        onDocChange(next);
        setYamlError(null);
      } catch (e) {
        setYamlError(String(e));
      }
    },
    [onDocChange],
  );

  const names =
    kind === "service"
      ? Object.keys(doc.services).sort()
      : kind === "network"
        ? Object.keys(doc.networks).sort()
        : Object.keys(doc.volumes).sort();

  const addCurrent = () => {
    if (kind === "service") {
      const name = uniqueName("service", new Set(Object.keys(doc.services)));
      onDocChange({
        ...doc,
        services: { ...doc.services, [name]: emptyService() },
      });
      setSelection({ kind: "service", name });
    } else if (kind === "network") {
      const name = uniqueName("network", new Set(Object.keys(doc.networks)));
      onDocChange({
        ...doc,
        networks: { ...doc.networks, [name]: { name } },
      });
      setSelection({ kind: "network", name });
    } else {
      const name = uniqueName("data", new Set(Object.keys(doc.volumes)));
      onDocChange({
        ...doc,
        volumes: { ...doc.volumes, [name]: { name } },
      });
      setSelection({ kind: "volume", name });
    }
  };

  const deleteSelected = () => {
    if (!selection) return;
    if (selection.kind === "service") {
      const services = { ...doc.services };
      delete services[selection.name];
      for (const s of Object.values(services)) {
        s.depends_on = (s.depends_on ?? []).filter(
          (d) => d.service !== selection.name,
        );
      }
      onDocChange({ ...doc, services });
    } else if (selection.kind === "network") {
      const networks = { ...doc.networks };
      delete networks[selection.name];
      const services = { ...doc.services };
      for (const [k, s] of Object.entries(services)) {
        services[k] = {
          ...s,
          networks: (s.networks ?? []).filter((n) => n.name !== selection.name),
        };
      }
      onDocChange({ ...doc, networks, services });
    } else {
      const volumes = { ...doc.volumes };
      delete volumes[selection.name];
      const services = { ...doc.services };
      for (const [k, s] of Object.entries(services)) {
        services[k] = {
          ...s,
          volumes: (s.volumes ?? []).filter(
            (v) => !(v.type === "volume" && v.source === selection.name),
          ),
        };
      }
      onDocChange({ ...doc, volumes, services });
    }
    setSelection(null);
  };

  const renameService = (oldName: string, newName: string) => {
    if (oldName === newName || doc.services[newName]) return;
    const services = { ...doc.services };
    services[newName] = services[oldName];
    delete services[oldName];
    for (const s of Object.values(services)) {
      s.depends_on = (s.depends_on ?? []).map((d) =>
        d.service === oldName ? { ...d, service: newName } : d,
      );
    }
    onDocChange({ ...doc, services });
    setSelection({ kind: "service", name: newName });
  };

  const renameNetwork = (oldName: string, newName: string) => {
    if (oldName === newName || doc.networks[newName]) return;
    const networks = { ...doc.networks };
    networks[newName] = { ...networks[oldName], name: newName };
    delete networks[oldName];
    const services = { ...doc.services };
    for (const [k, s] of Object.entries(services)) {
      services[k] = {
        ...s,
        networks: (s.networks ?? []).map((n) =>
          n.name === oldName ? { ...n, name: newName } : n,
        ),
      };
    }
    onDocChange({ ...doc, networks, services });
    setSelection({ kind: "network", name: newName });
  };

  const renameVolume = (oldName: string, newName: string) => {
    if (oldName === newName || doc.volumes[newName]) return;
    const volumes = { ...doc.volumes };
    volumes[newName] = { ...volumes[oldName], name: newName };
    delete volumes[oldName];
    const services = { ...doc.services };
    for (const [k, s] of Object.entries(services)) {
      services[k] = {
        ...s,
        volumes: (s.volumes ?? []).map((v) =>
          v.type === "volume" && v.source === oldName
            ? { ...v, source: newName }
            : v,
        ),
      };
    }
    onDocChange({ ...doc, volumes, services });
    setSelection({ kind: "volume", name: newName });
  };

  const copyYaml = async () => {
    await clipboardWriteText(stringifyComposeYaml(doc));
    toast.success(t("docker.copied"));
  };

  const copyUpCmd = async () => {
    await clipboardWriteText("docker compose up -d");
    toast.success(t("docker.copied"));
  };

  const execComposeUp = async () => {
    if (!activeSessionId) {
      toast.error(t("docker.composeUpNeedSession"));
      return;
    }
    try {
      const out = await api.sessionExec(
        activeSessionId,
        "docker compose up -d",
      );
      toast.success(t("docker.composeUpDone"));
      if (out.trim()) toast.message(out.slice(0, 400));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const importFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yml,.yaml,text/yaml";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      onImportYaml(await file.text());
    };
    input.click();
  };

  const switchKind = (next: ResourceKind) => {
    setKind(next);
    const list =
      next === "service"
        ? Object.keys(doc.services).sort()
        : next === "network"
          ? Object.keys(doc.networks).sort()
          : Object.keys(doc.volumes).sort();
    if (list[0]) setSelection({ kind: next, name: list[0] });
    else setSelection(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {(issues.length > 0 || yamlError) && (
        <div className="flex shrink-0 items-start gap-2 border-b border-border bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            {yamlError ? <div>{yamlError}</div> : null}
            {issues.slice(0, 4).map((iss, i) => (
              <div key={i}>
                [{iss.level}] {iss.service ? `${iss.service}: ` : ""}
                {iss.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={48} minSize={32}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
              {(
                [
                  ["service", t("docker.resourceServices")],
                  ["network", t("docker.resourceNetworks")],
                  ["volume", t("docker.resourceVolumes")],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => switchKind(id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-sm transition-colors",
                    kind === id
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {label}
                  <span className="ml-1 tabular-nums opacity-60">
                    {id === "service"
                      ? Object.keys(doc.services).length
                      : id === "network"
                        ? Object.keys(doc.networks).length
                        : Object.keys(doc.volumes).length}
                  </span>
                </button>
              ))}
              <div className="ml-auto flex items-center gap-0.5">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title={t("docker.add")}
                  aria-label={t("docker.add")}
                  onClick={addCurrent}
                >
                  <Plus size={14} />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={!selection}
                  title={t("docker.delete")}
                  aria-label={t("docker.delete")}
                  onClick={deleteSelected}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="flex w-36 shrink-0 flex-col border-r border-border bg-muted/15">
                <div className="min-h-0 flex-1 overflow-auto p-1">
                  {names.length === 0 ? (
                    <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                      {t("docker.emptyKind")}
                    </div>
                  ) : (
                    names.map((name) => {
                      const active =
                        selection?.kind === kind && selection.name === name;
                      let sub = "";
                      if (kind === "service") {
                        const svc = doc.services[name];
                        sub =
                          svc.image ||
                          (svc.build ? `build:${svc.build.context}` : "");
                      }
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setSelection({ kind, name })}
                          className={cn(
                            "mb-0.5 flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                            active
                              ? "bg-accent font-medium text-accent-foreground"
                              : "hover:bg-muted",
                          )}
                        >
                          <span className="truncate">{name}</span>
                          {sub ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {sub}
                            </span>
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <ComposeInspector
                  doc={doc}
                  selection={selection}
                  dockerfiles={dockerfiles}
                  onChange={onDocChange}
                  onRenameService={renameService}
                  onRenameNetwork={renameNetwork}
                  onRenameVolume={renameVolume}
                />
              </div>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel defaultSize={52} minSize={28}>
          <div
            className={cn(
              "flex h-full min-h-0 flex-col",
              yamlError && "ring-1 ring-inset ring-destructive/40",
            )}
          >
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                docker-compose.yml
              </span>
              <div className="ml-auto flex items-center gap-0.5">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title={t("docker.import")}
                  aria-label={t("docker.import")}
                  onClick={importFile}
                >
                  <Upload size={14} />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title={t("docker.export")}
                  aria-label={t("docker.export")}
                  onClick={onExportYaml}
                >
                  <Download size={14} />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title="YAML"
                  aria-label="YAML"
                  onClick={copyYaml}
                >
                  <Copy size={14} />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1 px-2 text-xs"
                  title={t("docker.composeUpExecute")}
                  onClick={() => execComposeUp().catch(console.error)}
                >
                  <Play size={12} />
                  {t("docker.composeUpExecute")}
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title={t("docker.copyUp")}
                  aria-label={t("docker.copyUp")}
                  onClick={copyUpCmd}
                >
                  <Terminal size={14} />
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <Editor
                height="100%"
                language="yaml"
                theme={monacoTheme}
                value={yamlText}
                onChange={(v) => applyYaml(v ?? "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                }}
              />
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
