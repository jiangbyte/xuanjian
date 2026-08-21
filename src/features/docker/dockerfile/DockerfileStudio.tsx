/**
 * @file Dockerfile 工作室
 * @author Charlie
 * @description 指令列表编辑 + Monaco 源码双向同步；管理项目内多 Dockerfile。
 */

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  FilePlus,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import Editor from "@/components/MonacoEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { clipboardWriteText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { resolveMonacoTheme, useSettingsStore } from "@/stores/settings";
import type { DockerfilesMap } from "../model/composeTypes";
import {
  createInstruction,
  type DockerfileInstruction,
  parseDockerfile,
  stringifyDockerfile,
} from "../model/dockerfileModel";

const KINDS: DockerfileInstruction["kind"][] = [
  "FROM",
  "ARG",
  "ENV",
  "WORKDIR",
  "COPY",
  "ADD",
  "RUN",
  "EXPOSE",
  "USER",
  "VOLUME",
  "LABEL",
  "HEALTHCHECK",
  "SHELL",
  "CMD",
  "ENTRYPOINT",
  "COMMENT",
];

type Props = {
  dockerfiles: DockerfilesMap;
  onChange: (next: DockerfilesMap) => void;
  onExport: (path: string, content: string) => void;
};

/** Dockerfile 可视化编辑 */
export function DockerfileStudio({ dockerfiles, onChange, onExport }: Props) {
  const { t } = useTranslation();
  const monacoTheme = useSettingsStore((s) =>
    resolveMonacoTheme(s.editorTheme),
  );
  const paths = Object.keys(dockerfiles).sort();
  const [activePath, setActivePath] = useState(paths[0] ?? "");
  const content = dockerfiles[activePath] ?? "";
  const [instructions, setInstructions] = useState<DockerfileInstruction[]>(
    () => parseDockerfile(content),
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const list = parseDockerfile(content);
    return list[0]?.id ?? null;
  });
  const [source, setSource] = useState(content);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const applyingSource = useRef(false);
  const pathRef = useRef(activePath);

  useEffect(() => {
    if (!activePath && paths[0]) setActivePath(paths[0]);
    if (activePath && !dockerfiles[activePath] && paths[0]) {
      setActivePath(paths[0]);
    }
  }, [paths, activePath, dockerfiles]);

  useEffect(() => {
    if (pathRef.current !== activePath) {
      pathRef.current = activePath;
      const text = dockerfiles[activePath] ?? "";
      const next = parseDockerfile(text);
      setSource(text);
      setInstructions(next);
      setSelectedId(next[0]?.id ?? null);
      setSourceError(null);
      return;
    }
    if (applyingSource.current) {
      applyingSource.current = false;
      return;
    }
    const text = dockerfiles[activePath] ?? "";
    if (text !== source) {
      const next = parseDockerfile(text);
      setSource(text);
      setInstructions(next);
      setSelectedId((id) =>
        next.some((i) => i.id === id) ? id : (next[0]?.id ?? null),
      );
    }
  }, [activePath, dockerfiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(
    () => instructions.find((i) => i.id === selectedId) ?? null,
    [instructions, selectedId],
  );

  const commitInstructions = (next: DockerfileInstruction[]) => {
    setInstructions(next);
    const text = stringifyDockerfile(next);
    setSource(text);
    setSourceError(null);
    if (!activePath) return;
    onChange({ ...dockerfiles, [activePath]: text });
  };

  const applySource = (text: string) => {
    setSource(text);
    try {
      const next = parseDockerfile(text);
      applyingSource.current = true;
      setInstructions(next);
      setSourceError(null);
      if (activePath) onChange({ ...dockerfiles, [activePath]: text });
    } catch (e) {
      setSourceError(String(e));
    }
  };

  const addFile = () => {
    let path = "Dockerfile";
    let i = 2;
    while (dockerfiles[path]) {
      path = `Dockerfile.${i}`;
      i += 1;
    }
    const text = 'FROM alpine:latest\nCMD ["sh"]\n';
    onChange({ ...dockerfiles, [path]: text });
    setActivePath(path);
  };

  const renameFile = (nextPath: string) => {
    if (!activePath || !nextPath.trim() || nextPath === activePath) return;
    if (dockerfiles[nextPath]) {
      toast.error(t("docker.fileExists"));
      return;
    }
    const next = { ...dockerfiles };
    next[nextPath] = next[activePath];
    delete next[activePath];
    onChange(next);
    setActivePath(nextPath);
  };

  const removeFile = () => {
    if (!activePath) return;
    const next = { ...dockerfiles };
    delete next[activePath];
    onChange(next);
    setActivePath(Object.keys(next).sort()[0] ?? "");
  };

  const move = (id: string, dir: -1 | 1) => {
    const idx = instructions.findIndex((i) => i.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= instructions.length) return;
    const next = [...instructions];
    const tmp = next[idx];
    next[idx] = next[j];
    next[j] = tmp;
    commitInstructions(next);
  };

  const updateSelected = (ins: DockerfileInstruction) => {
    commitInstructions(instructions.map((i) => (i.id === ins.id ? ins : i)));
  };

  const copyDf = async () => {
    await clipboardWriteText(source);
    toast.success(t("docker.copied"));
  };

  const importFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "*/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const path = activePath || file.name || "Dockerfile";
      onChange({ ...dockerfiles, [path]: text });
      setActivePath(path);
    };
    input.click();
  };

  if (!paths.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-muted-foreground">
          {t("docker.noDockerfile")}
        </p>
        <Button type="button" onClick={addFile}>
          <FilePlus size={14} className="mr-1" />
          {t("docker.addDockerfile")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={42} minSize={28}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
              <Select value={activePath} onValueChange={setActivePath}>
                <SelectTrigger className="h-7 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paths.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-7 w-36 text-xs"
                key={activePath}
                defaultValue={activePath}
                onBlur={(e) => renameFile(e.target.value.trim())}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={addFile}
              >
                <FilePlus size={13} />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={removeFile}
              >
                <Trash2 size={13} />
              </Button>
              <div className="ml-auto flex gap-1">
                <Select
                  onValueChange={(k) => {
                    const ins = createInstruction(
                      k as DockerfileInstruction["kind"],
                    );
                    commitInstructions([...instructions, ins]);
                    setSelectedId(ins.id);
                  }}
                >
                  <SelectTrigger className="h-7 w-36">
                    <SelectValue placeholder={t("docker.addInstruction")} />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => {
                    const ins = createInstruction("RUN");
                    commitInstructions([...instructions, ins]);
                    setSelectedId(ins.id);
                  }}
                >
                  <Plus size={13} className="mr-1" />
                  {t("docker.add")}
                </Button>
              </div>
            </div>

            <ResizablePanelGroup
              orientation="vertical"
              className="min-h-0 flex-1"
            >
              <ResizablePanel defaultSize={48} minSize={25}>
                <div className="h-full overflow-auto p-1">
                  {instructions.map((ins, idx) => {
                    const stage =
                      ins.kind === "FROM" ? ins.as || ins.image : null;
                    return (
                      <button
                        key={ins.id}
                        type="button"
                        onClick={() => setSelectedId(ins.id)}
                        className={cn(
                          "mb-0.5 flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                          selectedId === ins.id
                            ? "bg-accent font-medium text-accent-foreground"
                            : "hover:bg-muted",
                          ins.kind === "FROM" &&
                            idx > 0 &&
                            "mt-2 border-t border-border pt-2",
                        )}
                      >
                        <span className="w-5 shrink-0 tabular-nums text-muted-foreground">
                          {idx + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold">{ins.kind}</span>
                          <span className="ml-1 text-muted-foreground">
                            {stage ?? summarize(ins)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={52} minSize={25}>
                <div className="h-full overflow-auto border-t border-border p-3">
                  {selected ? (
                    <InstructionForm
                      ins={selected}
                      onChange={updateSelected}
                      onDelete={() => {
                        const next = instructions.filter(
                          (i) => i.id !== selected.id,
                        );
                        commitInstructions(next);
                        setSelectedId(next[0]?.id ?? null);
                      }}
                      onUp={() => move(selected.id, -1)}
                      onDown={() => move(selected.id, 1)}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      {t("docker.selectInstruction")}
                    </div>
                  )}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel defaultSize={58} minSize={30}>
          <div
            className={cn(
              "flex h-full min-h-0 flex-col",
              sourceError && "ring-1 ring-inset ring-destructive/40",
            )}
          >
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
              <span className="truncate text-xs font-medium text-muted-foreground">
                {activePath}
                {sourceError ? ` · ${sourceError}` : ""}
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
                  onClick={() => onExport(activePath, source)}
                >
                  <Download size={14} />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title={t("docker.copy")}
                  aria-label={t("docker.copy")}
                  onClick={copyDf}
                >
                  <Copy size={14} />
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <Editor
                height="100%"
                language="dockerfile"
                theme={monacoTheme}
                value={source}
                onChange={(v) => applySource(v ?? "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
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

function summarize(ins: DockerfileInstruction): string {
  switch (ins.kind) {
    case "RUN":
      return ins.command.slice(0, 40);
    case "COPY":
    case "ADD":
      return `${ins.src} → ${ins.dest}`;
    case "ENV":
      return ins.pairs.map((p) => p.key).join(",");
    case "WORKDIR":
      return ins.path;
    case "EXPOSE":
      return ins.ports.join(",");
    case "CMD":
    case "ENTRYPOINT":
      return ins.value.slice(0, 40);
    case "COMMENT":
      return ins.text.slice(0, 40);
    case "ARG":
      return ins.name;
    case "USER":
      return ins.user;
    default:
      return "";
  }
}

function InstructionForm({
  ins,
  onChange,
  onDelete,
  onUp,
  onDown,
}: {
  ins: DockerfileInstruction;
  onChange: (i: DockerfileInstruction) => void;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <div className="text-sm font-semibold">{ins.kind}</div>
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={onUp}
          >
            <ArrowUp size={12} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={onDown}
          >
            <ArrowDown size={12} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={onDelete}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {ins.kind === "FROM" && (
        <>
          <Field label="image">
            <Input
              className="h-8"
              value={ins.image}
              onChange={(e) => onChange({ ...ins, image: e.target.value })}
            />
          </Field>
          <Field label="AS">
            <Input
              className="h-8"
              value={ins.as ?? ""}
              onChange={(e) =>
                onChange({ ...ins, as: e.target.value || undefined })
              }
            />
          </Field>
          <Field label="platform">
            <Input
              className="h-8"
              value={ins.platform ?? ""}
              onChange={(e) =>
                onChange({ ...ins, platform: e.target.value || undefined })
              }
            />
          </Field>
        </>
      )}
      {ins.kind === "ARG" && (
        <>
          <Field label="name">
            <Input
              className="h-8"
              value={ins.name}
              onChange={(e) => onChange({ ...ins, name: e.target.value })}
            />
          </Field>
          <Field label="default">
            <Input
              className="h-8"
              value={ins.defaultValue ?? ""}
              onChange={(e) =>
                onChange({
                  ...ins,
                  defaultValue: e.target.value || undefined,
                })
              }
            />
          </Field>
        </>
      )}
      {ins.kind === "ENV" && (
        <Field label="KEY=VALUE">
          <Textarea
            className="min-h-[80px] text-xs"
            value={ins.pairs.map((p) => `${p.key}=${p.value}`).join("\n")}
            onChange={(e) =>
              onChange({
                ...ins,
                pairs: e.target.value
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => {
                    const i = line.indexOf("=");
                    return i >= 0
                      ? { key: line.slice(0, i), value: line.slice(i + 1) }
                      : { key: line, value: "" };
                  }),
              })
            }
          />
        </Field>
      )}
      {ins.kind === "WORKDIR" && (
        <Field label="path">
          <Input
            className="h-8"
            value={ins.path}
            onChange={(e) => onChange({ ...ins, path: e.target.value })}
          />
        </Field>
      )}
      {(ins.kind === "COPY" || ins.kind === "ADD") && (
        <>
          <Field label="src">
            <Input
              className="h-8"
              value={ins.src}
              onChange={(e) => onChange({ ...ins, src: e.target.value })}
            />
          </Field>
          <Field label="dest">
            <Input
              className="h-8"
              value={ins.dest}
              onChange={(e) => onChange({ ...ins, dest: e.target.value })}
            />
          </Field>
          {ins.kind === "COPY" && (
            <>
              <Field label="--from">
                <Input
                  className="h-8"
                  value={ins.from ?? ""}
                  onChange={(e) =>
                    onChange({ ...ins, from: e.target.value || undefined })
                  }
                />
              </Field>
              <Field label="--chown">
                <Input
                  className="h-8"
                  value={ins.chown ?? ""}
                  onChange={(e) =>
                    onChange({ ...ins, chown: e.target.value || undefined })
                  }
                />
              </Field>
            </>
          )}
        </>
      )}
      {ins.kind === "RUN" && (
        <Field label="command">
          <Textarea
            className="min-h-[100px] text-xs font-mono"
            value={ins.command}
            onChange={(e) => onChange({ ...ins, command: e.target.value })}
          />
        </Field>
      )}
      {ins.kind === "EXPOSE" && (
        <Field label="ports">
          <Input
            className="h-8"
            value={ins.ports.join(" ")}
            onChange={(e) =>
              onChange({
                ...ins,
                ports: e.target.value.split(/\s+/).filter(Boolean),
              })
            }
          />
        </Field>
      )}
      {ins.kind === "USER" && (
        <Field label="user">
          <Input
            className="h-8"
            value={ins.user}
            onChange={(e) => onChange({ ...ins, user: e.target.value })}
          />
        </Field>
      )}
      {ins.kind === "VOLUME" && (
        <Field label="paths">
          <Input
            className="h-8"
            value={ins.paths.join(" ")}
            onChange={(e) =>
              onChange({
                ...ins,
                paths: e.target.value.split(/\s+/).filter(Boolean),
              })
            }
          />
        </Field>
      )}
      {ins.kind === "LABEL" && (
        <Field label="labels">
          <Textarea
            className="min-h-[80px] text-xs"
            value={ins.pairs.map((p) => `${p.key}=${p.value}`).join("\n")}
            onChange={(e) =>
              onChange({
                ...ins,
                pairs: e.target.value
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => {
                    const i = line.indexOf("=");
                    return i >= 0
                      ? { key: line.slice(0, i), value: line.slice(i + 1) }
                      : { key: line, value: "" };
                  }),
              })
            }
          />
        </Field>
      )}
      {ins.kind === "HEALTHCHECK" && (
        <Field label="args">
          <Textarea
            className="min-h-[80px] text-xs"
            value={ins.args}
            onChange={(e) => onChange({ ...ins, args: e.target.value })}
          />
        </Field>
      )}
      {ins.kind === "SHELL" && (
        <Field label="form JSON">
          <Input
            className="h-8"
            value={JSON.stringify(ins.form)}
            onChange={(e) => {
              try {
                const form = JSON.parse(e.target.value);
                if (Array.isArray(form)) onChange({ ...ins, form });
              } catch {
                /* ignore */
              }
            }}
          />
        </Field>
      )}
      {(ins.kind === "CMD" || ins.kind === "ENTRYPOINT") && (
        <>
          <Field label="form">
            <Select
              value={ins.form}
              onValueChange={(v) =>
                onChange({ ...ins, form: v as "exec" | "shell" })
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shell">shell</SelectItem>
                <SelectItem value="exec">exec</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="value">
            <Textarea
              className="min-h-[80px] text-xs font-mono"
              value={ins.value}
              onChange={(e) => onChange({ ...ins, value: e.target.value })}
            />
          </Field>
        </>
      )}
      {ins.kind === "COMMENT" && (
        <Field label={t("docker.comment")}>
          <Input
            className="h-8"
            value={ins.text}
            onChange={(e) => onChange({ ...ins, text: e.target.value })}
          />
        </Field>
      )}
      {ins.kind === "RAW" && (
        <Field label="raw">
          <Textarea
            className="min-h-[80px] text-xs font-mono"
            value={ins.text}
            onChange={(e) => onChange({ ...ins, text: e.target.value })}
          />
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
