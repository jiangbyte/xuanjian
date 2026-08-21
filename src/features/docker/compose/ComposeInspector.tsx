/**
 * @file Compose 属性检查器
 * @author Charlie
 * @description 编辑选中的 service / network / volume 字段。
 */

import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type {
  ComposeDoc,
  ComposeNetwork,
  ComposeService,
  ComposeVolume,
  DockerfilesMap,
  PortMapping,
  VolumeMount,
} from "../model/composeTypes";

type Selection =
  | { kind: "service"; name: string }
  | { kind: "network"; name: string }
  | { kind: "volume"; name: string }
  | null;

export type ComposeSelection = Selection;

type Props = {
  doc: ComposeDoc;
  selection: Selection;
  dockerfiles: DockerfilesMap;
  onChange: (doc: ComposeDoc) => void;
  onRenameService: (oldName: string, newName: string) => void;
  onRenameNetwork: (oldName: string, newName: string) => void;
  onRenameVolume: (oldName: string, newName: string) => void;
};

function KvEditor({
  value,
  onChange,
  keyPh,
  valPh,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPh?: string;
  valPh?: string;
}) {
  const entries = Object.entries(value);
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-1">
          <Input
            className="h-8 text-xs"
            value={k}
            placeholder={keyPh ?? "KEY"}
            onChange={(e) => {
              const next = { ...value };
              delete next[k];
              next[e.target.value] = v;
              onChange(next);
            }}
          />
          <Input
            className="h-8 text-xs"
            value={v}
            placeholder={valPh ?? "value"}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            onClick={() => {
              const next = { ...value };
              delete next[k];
              onChange(next);
            }}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => onChange({ ...value, "": "" })}
      >
        <Plus size={12} className="mr-1" />
        Add
      </Button>
    </div>
  );
}

function ListEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      {value.map((item, i) => (
        <div key={i} className="flex gap-1">
          <Input
            className="h-8 text-xs"
            value={item}
            placeholder={placeholder}
            onChange={(e) => {
              const next = [...value];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => onChange([...value, ""])}
      >
        <Plus size={12} className="mr-1" />
        Add
      </Button>
    </div>
  );
}

function updateService(
  doc: ComposeDoc,
  name: string,
  patch: Partial<ComposeService>,
): ComposeDoc {
  return {
    ...doc,
    services: {
      ...doc.services,
      [name]: { ...doc.services[name], ...patch },
    },
  };
}

/** 右侧属性面板 */
export function ComposeInspector({
  doc,
  selection,
  dockerfiles,
  onChange,
  onRenameService,
  onRenameNetwork,
  onRenameVolume,
}: Props) {
  const { t } = useTranslation();

  if (!selection) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        {t("docker.selectResource")}
      </div>
    );
  }

  if (selection.kind === "network") {
    const net = doc.networks[selection.name];
    if (!net) return null;
    const setNet = (patch: Partial<ComposeNetwork>) => {
      onChange({
        ...doc,
        networks: {
          ...doc.networks,
          [selection.name]: { ...net, ...patch, name: selection.name },
        },
      });
    };
    return (
      <div className="space-y-3 overflow-auto p-3">
        <div className="text-sm font-semibold">{t("docker.network")}</div>
        <Field label={t("docker.name")}>
          <Input
            className="h-8"
            defaultValue={selection.name}
            onBlur={(e) => {
              const n = e.target.value.trim();
              if (n && n !== selection.name) onRenameNetwork(selection.name, n);
            }}
          />
        </Field>
        <Field label={t("docker.driver")}>
          <Input
            className="h-8"
            value={net.driver ?? ""}
            onChange={(e) => setNet({ driver: e.target.value || undefined })}
          />
        </Field>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={Boolean(net.external)}
            onCheckedChange={(c) => setNet({ external: c === true })}
          />
          {t("docker.external")}
        </label>
      </div>
    );
  }

  if (selection.kind === "volume") {
    const vol = doc.volumes[selection.name];
    if (!vol) return null;
    const setVol = (patch: Partial<ComposeVolume>) => {
      onChange({
        ...doc,
        volumes: {
          ...doc.volumes,
          [selection.name]: { ...vol, ...patch, name: selection.name },
        },
      });
    };
    return (
      <div className="space-y-3 overflow-auto p-3">
        <div className="text-sm font-semibold">{t("docker.volume")}</div>
        <Field label={t("docker.name")}>
          <Input
            className="h-8"
            defaultValue={selection.name}
            onBlur={(e) => {
              const n = e.target.value.trim();
              if (n && n !== selection.name) onRenameVolume(selection.name, n);
            }}
          />
        </Field>
        <Field label={t("docker.driver")}>
          <Input
            className="h-8"
            value={vol.driver ?? ""}
            onChange={(e) => setVol({ driver: e.target.value || undefined })}
          />
        </Field>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={Boolean(vol.external)}
            onCheckedChange={(c) => setVol({ external: c === true })}
          />
          {t("docker.external")}
        </label>
      </div>
    );
  }

  const name = selection.name;
  const svc = doc.services[name];
  if (!svc) return null;
  const set = (patch: Partial<ComposeService>) =>
    onChange(updateService(doc, name, patch));
  const dfPaths = Object.keys(dockerfiles);

  return (
    <div className="h-full space-y-4 overflow-auto p-3">
      <div className="text-sm font-semibold">{t("docker.service")}</div>

      <Section title={t("docker.sectionBasic")}>
        <Field label={t("docker.name")}>
          <Input
            className="h-8"
            defaultValue={name}
            onBlur={(e) => {
              const n = e.target.value.trim();
              if (n && n !== name) onRenameService(name, n);
            }}
          />
        </Field>
        <Field label={t("docker.image")}>
          <Input
            className="h-8"
            value={svc.image ?? ""}
            onChange={(e) => set({ image: e.target.value || undefined })}
            placeholder="nginx:alpine"
          />
        </Field>
        <Field label={t("docker.containerName")}>
          <Input
            className="h-8"
            value={svc.container_name ?? ""}
            onChange={(e) =>
              set({ container_name: e.target.value || undefined })
            }
          />
        </Field>
        <Field label={t("docker.restart")}>
          <Select
            value={svc.restart ?? "none"}
            onValueChange={(v) =>
              set({ restart: v === "none" ? undefined : v })
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["none", "no", "always", "on-failure", "unless-stopped"].map(
                (r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("docker.profiles")}>
          <Input
            className="h-8"
            value={(svc.profiles ?? []).join(", ")}
            onChange={(e) =>
              set({
                profiles: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="dev, prod"
          />
        </Field>
      </Section>

      <Section title={t("docker.sectionBuild")}>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={Boolean(svc.build)}
            onCheckedChange={(c) =>
              set({
                build:
                  c === true
                    ? { context: ".", dockerfile: "Dockerfile" }
                    : undefined,
              })
            }
          />
          {t("docker.useBuild")}
        </label>
        {svc.build ? (
          <>
            <Field label={t("docker.buildContext")}>
              <Input
                className="h-8"
                value={svc.build.context}
                onChange={(e) =>
                  set({ build: { ...svc.build!, context: e.target.value } })
                }
              />
            </Field>
            <Field label={t("docker.dockerfile")}>
              {dfPaths.length ? (
                <Select
                  value={svc.build.dockerfile ?? "Dockerfile"}
                  onValueChange={(v) =>
                    set({ build: { ...svc.build!, dockerfile: v } })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dfPaths.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-8"
                  value={svc.build.dockerfile ?? ""}
                  onChange={(e) =>
                    set({
                      build: {
                        ...svc.build!,
                        dockerfile: e.target.value || undefined,
                      },
                    })
                  }
                />
              )}
            </Field>
            <Field label={t("docker.buildTarget")}>
              <Input
                className="h-8"
                value={svc.build.target ?? ""}
                onChange={(e) =>
                  set({
                    build: {
                      ...svc.build!,
                      target: e.target.value || undefined,
                    },
                  })
                }
              />
            </Field>
            <Field label={t("docker.buildArgs")}>
              <KvEditor
                value={svc.build.args ?? {}}
                onChange={(args) => set({ build: { ...svc.build!, args } })}
              />
            </Field>
          </>
        ) : null}
      </Section>

      <Section title={t("docker.sectionRun")}>
        <Field label={t("docker.command")}>
          <Input
            className="h-8"
            value={
              Array.isArray(svc.command)
                ? svc.command.join(" ")
                : (svc.command ?? "")
            }
            onChange={(e) => set({ command: e.target.value || undefined })}
          />
        </Field>
        <Field label={t("docker.entrypoint")}>
          <Input
            className="h-8"
            value={
              Array.isArray(svc.entrypoint)
                ? svc.entrypoint.join(" ")
                : (svc.entrypoint ?? "")
            }
            onChange={(e) => set({ entrypoint: e.target.value || undefined })}
          />
        </Field>
        <Field label={t("docker.workingDir")}>
          <Input
            className="h-8"
            value={svc.working_dir ?? ""}
            onChange={(e) => set({ working_dir: e.target.value || undefined })}
          />
        </Field>
        <Field label={t("docker.user")}>
          <Input
            className="h-8"
            value={svc.user ?? ""}
            onChange={(e) => set({ user: e.target.value || undefined })}
          />
        </Field>
        <Field label={t("docker.hostname")}>
          <Input
            className="h-8"
            value={svc.hostname ?? ""}
            onChange={(e) => set({ hostname: e.target.value || undefined })}
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          {(
            [
              ["privileged", "privileged"],
              ["stdin_open", "stdinOpen"],
              ["tty", "tty"],
            ] as const
          ).map(([key, labelKey]) => (
            <label key={key} className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={Boolean(svc[key])}
                onCheckedChange={(c) => set({ [key]: c === true || undefined })}
              />
              {t(`docker.${labelKey}`)}
            </label>
          ))}
        </div>
      </Section>

      <Section title={t("docker.ports")}>
        <PortEditor
          value={svc.ports ?? []}
          onChange={(ports) => set({ ports })}
        />
      </Section>

      <Section title={t("docker.environment")}>
        <KvEditor
          value={svc.environment ?? {}}
          onChange={(environment) => set({ environment })}
        />
        <Field label={t("docker.envFile")}>
          <ListEditor
            value={svc.env_file ?? []}
            onChange={(env_file) => set({ env_file })}
            placeholder=".env"
          />
        </Field>
      </Section>

      <Section title={t("docker.volumes")}>
        <VolumeEditor
          value={svc.volumes ?? []}
          volumeNames={Object.keys(doc.volumes)}
          onChange={(volumes) => set({ volumes })}
        />
      </Section>

      <Section title={t("docker.networks")}>
        <NetworkAttachEditor
          value={(svc.networks ?? []).map((n) => n.name)}
          networkNames={Object.keys(doc.networks)}
          onChange={(names) =>
            set({
              networks: names.map((n) => ({ name: n })),
            })
          }
        />
      </Section>

      <Section title={t("docker.dependsOn")}>
        <DependsEditor
          value={(svc.depends_on ?? []).map((d) => d.service)}
          serviceNames={Object.keys(doc.services).filter((s) => s !== name)}
          onChange={(names) =>
            set({
              depends_on: names.map((service) => ({ service })),
            })
          }
        />
      </Section>

      <Section title={t("docker.healthcheck")}>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={Boolean(svc.healthcheck)}
            onCheckedChange={(c) =>
              set({
                healthcheck:
                  c === true
                    ? {
                        test: ["CMD-SHELL", "curl -f http://localhost/ || exit 1"],
                        interval: "30s",
                        timeout: "5s",
                        retries: 3,
                      }
                    : undefined,
              })
            }
          />
          {t("docker.enableHealthcheck")}
        </label>
        {svc.healthcheck ? (
          <>
            <Field label="test">
              <Textarea
                className="min-h-[60px] text-xs"
                value={svc.healthcheck.test.join(" ")}
                onChange={(e) =>
                  set({
                    healthcheck: {
                      ...svc.healthcheck!,
                      test: e.target.value.split(/\s+/).filter(Boolean),
                    },
                  })
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="interval">
                <Input
                  className="h-8"
                  value={svc.healthcheck.interval ?? ""}
                  onChange={(e) =>
                    set({
                      healthcheck: {
                        ...svc.healthcheck!,
                        interval: e.target.value || undefined,
                      },
                    })
                  }
                />
              </Field>
              <Field label="timeout">
                <Input
                  className="h-8"
                  value={svc.healthcheck.timeout ?? ""}
                  onChange={(e) =>
                    set({
                      healthcheck: {
                        ...svc.healthcheck!,
                        timeout: e.target.value || undefined,
                      },
                    })
                  }
                />
              </Field>
              <Field label="retries">
                <Input
                  className="h-8"
                  type="number"
                  value={svc.healthcheck.retries ?? ""}
                  onChange={(e) =>
                    set({
                      healthcheck: {
                        ...svc.healthcheck!,
                        retries: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      },
                    })
                  }
                />
              </Field>
              <Field label="start_period">
                <Input
                  className="h-8"
                  value={svc.healthcheck.start_period ?? ""}
                  onChange={(e) =>
                    set({
                      healthcheck: {
                        ...svc.healthcheck!,
                        start_period: e.target.value || undefined,
                      },
                    })
                  }
                />
              </Field>
            </div>
          </>
        ) : null}
      </Section>

      <Section title={t("docker.sectionAdvanced")}>
        <Field label={t("docker.extraHosts")}>
          <ListEditor
            value={svc.extra_hosts ?? []}
            onChange={(extra_hosts) => set({ extra_hosts })}
            placeholder="host:ip"
          />
        </Field>
        <Field label={t("docker.dns")}>
          <ListEditor
            value={svc.dns ?? []}
            onChange={(dns) => set({ dns })}
            placeholder="8.8.8.8"
          />
        </Field>
        <Field label={t("docker.capAdd")}>
          <ListEditor
            value={svc.cap_add ?? []}
            onChange={(cap_add) => set({ cap_add })}
          />
        </Field>
        <Field label={t("docker.capDrop")}>
          <ListEditor
            value={svc.cap_drop ?? []}
            onChange={(cap_drop) => set({ cap_drop })}
          />
        </Field>
        <Field label={t("docker.labels")}>
          <KvEditor
            value={svc.labels ?? {}}
            onChange={(labels) => set({ labels })}
          />
        </Field>
        <Field label={t("docker.loggingDriver")}>
          <Input
            className="h-8"
            value={svc.logging?.driver ?? ""}
            onChange={(e) =>
              set({
                logging: {
                  ...svc.logging,
                  driver: e.target.value || undefined,
                },
              })
            }
            placeholder="json-file"
          />
        </Field>
      </Section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 border-b border-border pb-3 last:border-0">
      <div className="text-xs font-medium text-foreground">{title}</div>
      {children}
    </div>
  );
}

function PortEditor({
  value,
  onChange,
}: {
  value: PortMapping[];
  onChange: (v: PortMapping[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {value.map((p, i) => (
        <div key={i} className="flex gap-1">
          <Input
            className="h-8 text-xs"
            placeholder="host"
            value={p.published ?? ""}
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...p, published: e.target.value || undefined };
              onChange(next);
            }}
          />
          <Input
            className="h-8 text-xs"
            placeholder="container"
            value={p.target}
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...p, target: e.target.value };
              onChange(next);
            }}
          />
          <Select
            value={p.protocol ?? "tcp"}
            onValueChange={(v) => {
              const next = [...value];
              next[i] = {
                ...p,
                protocol: v as "tcp" | "udp",
              };
              onChange(next);
            }}
          >
            <SelectTrigger className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tcp">tcp</SelectItem>
              <SelectItem value="udp">udp</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() =>
          onChange([...value, { published: "", target: "80", protocol: "tcp" }])
        }
      >
        <Plus size={12} className="mr-1" />
        Add
      </Button>
    </div>
  );
}

function VolumeEditor({
  value,
  volumeNames,
  onChange,
}: {
  value: VolumeMount[];
  volumeNames: string[];
  onChange: (v: VolumeMount[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {value.map((v, i) => (
        <div key={i} className="space-y-1 rounded border border-border p-2">
          <div className="flex gap-1">
            <Select
              value={v.type}
              onValueChange={(type) => {
                const next = [...value];
                next[i] = { ...v, type: type as VolumeMount["type"] };
                onChange(next);
              }}
            >
              <SelectTrigger className="h-8 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="volume">volume</SelectItem>
                <SelectItem value="bind">bind</SelectItem>
                <SelectItem value="tmpfs">tmpfs</SelectItem>
              </SelectContent>
            </Select>
            {v.type === "volume" && volumeNames.length ? (
              <Select
                value={v.source}
                onValueChange={(source) => {
                  const next = [...value];
                  next[i] = { ...v, source };
                  onChange(next);
                }}
              >
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue placeholder="volume" />
                </SelectTrigger>
                <SelectContent>
                  {volumeNames.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                className="h-8 text-xs"
                placeholder="source"
                value={v.source}
                onChange={(e) => {
                  const next = [...value];
                  next[i] = { ...v, source: e.target.value };
                  onChange(next);
                }}
              />
            )}
          </div>
          <div className="flex gap-1">
            <Input
              className="h-8 text-xs"
              placeholder="target"
              value={v.target}
              onChange={(e) => {
                const next = [...value];
                next[i] = { ...v, target: e.target.value };
                onChange(next);
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 size={12} />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() =>
          onChange([
            ...value,
            {
              type: "volume",
              source: volumeNames[0] ?? "data",
              target: "/data",
            },
          ])
        }
      >
        <Plus size={12} className="mr-1" />
        Add
      </Button>
    </div>
  );
}

function NetworkAttachEditor({
  value,
  networkNames,
  onChange,
}: {
  value: string[];
  networkNames: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="space-y-1">
      {networkNames.map((n) => (
        <label key={n} className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={value.includes(n)}
            onCheckedChange={(c) => {
              if (c === true) onChange([...value, n]);
              else onChange(value.filter((x) => x !== n));
            }}
          />
          {n}
        </label>
      ))}
      {!networkNames.length ? (
        <div className="text-[11px] text-muted-foreground">—</div>
      ) : null}
    </div>
  );
}

function DependsEditor({
  value,
  serviceNames,
  onChange,
}: {
  value: string[];
  serviceNames: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="space-y-1">
      {serviceNames.map((n) => (
        <label key={n} className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={value.includes(n)}
            onCheckedChange={(c) => {
              if (c === true) onChange([...value, n]);
              else onChange(value.filter((x) => x !== n));
            }}
          />
          {n}
        </label>
      ))}
      {!serviceNames.length ? (
        <div className="text-[11px] text-muted-foreground">—</div>
      ) : null}
    </div>
  );
}
