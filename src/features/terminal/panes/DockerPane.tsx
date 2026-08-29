/**
 * @file Docker 管理面板
 * @author Charlie
 * @description 通过 sessionExec 调用 docker CLI，管理容器/镜像/网络/卷。
 * JSON 行输出解析；危险操作前确认；容器可进 shell、看日志。
 * 仅允许安全字符作为 docker 引用参数，防止命令注入。
 */

import {
  ArrowDown,
  Copy,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Square,
  Terminal,
  Trash2,
  WrapText,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FloatingWindow } from "@/components/FloatingWindow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { clipboardWriteText } from "@/lib/ui/clipboard";
import { dialogs } from "@/lib/ui/dialogs";
import { api, onSessionExecOutput } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_ICON,
  sidebarItemRowClass,
  sidebarItemSubClass,
  sidebarItemTitleClass,
  sidebarPanelMetaClass,
  sidebarPanelTitleClass,
  sidebarTagRowClass,
} from "./sidebarUi";

const LOG_MAX_LINES = 1000;

type Section = "containers" | "images" | "networks" | "volumes";

type ContainerRow = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
};

type ImageRow = {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
};

type NetworkRow = {
  id: string;
  name: string;
  driver: string;
  scope: string;
};

type VolumeRow = {
  name: string;
  driver: string;
  scope: string;
  mountpoint: string;
};

const FORMAT = `--format "{{json .}}"`;

/** 解析 docker --format json 的逐行 JSON */
function parseJsonLines<T>(raw: string): T[] {
  const out: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      /* 跳过坏行 */
    }
  }
  return out;
}

/** 判断输出是否像 Docker 守护进程/命令不可用错误 */
function looksLikeDockerError(raw: string) {
  return /Cannot connect to the Docker daemon|Is the docker daemon running|docker: command not found|is not recognized as an internal or external command|permission denied while trying to connect|error during connect/i.test(
    raw,
  );
}

/** 仅允许可作为裸 shell 参数的 docker ID/名称 */
function safeArg(value: string): string {
  const v = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.\-/:]*$/.test(v)) {
    throw new Error(`unsafe docker ref: ${value}`);
  }
  return v;
}

function shortId(id: string) {
  const bare = id.replace(/^sha256:/, "");
  return bare.length > 12 ? bare.slice(0, 12) : bare;
}

function isRunning(state: string) {
  return state.toLowerCase() === "running";
}

function stateTone(state: string): "accent" | "warn" | "danger" | "muted" {
  const s = state.toLowerCase();
  if (s === "running") return "accent";
  if (s === "paused" || s === "restarting") return "warn";
  if (s === "exited" || s === "dead") return "danger";
  return "muted";
}

function badgeVariant(tone: "accent" | "warn" | "danger" | "muted") {
  if (tone === "danger") return "destructive" as const;
  if (tone === "warn") return "outline" as const;
  if (tone === "accent") return "default" as const;
  return "secondary" as const;
}

/** 去掉 ANSI / 残留着色码，便于纯文本阅读 */
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ANSI_CSI = new RegExp(`${ESC}\\[[\\d;?]*[ -/]*[@-~]`, "g");
const ANSI_OSC = new RegExp(
  `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
  "g",
);
const ANSI_ESC_REST = new RegExp(`${ESC}.`, "g");

function stripAnsi(text: string): string {
  return text
    .replace(ANSI_CSI, "")
    .replace(ANSI_OSC, "")
    .replace(ANSI_ESC_REST, "")
    .replace(/\[[\d;]*m/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/** 追加日志并裁到最多 LOG_MAX_LINES 行 */
function appendCapped(prev: string, chunk: string): string {
  const next = prev + chunk;
  const lines = next.split("\n");
  if (lines.length <= LOG_MAX_LINES) return next;
  return lines.slice(-LOG_MAX_LINES).join("\n");
}

function isLogSelecting(): boolean {
  const sel = window.getSelection();
  return Boolean(sel && sel.type === "Range" && !sel.isCollapsed);
}

/**
 * Docker 侧栏：分区列表、过滤、启停/删除等操作。
 */
export function DockerPane({
  sessionId,
  kind,
  shellId: _shellId,
}: {
  sessionId: string | null;
  kind: "local" | "ssh" | null;
  shellId?: string | null;
}) {
  const { t } = useTranslation();
  const [section, setSection] = useState<Section>("containers");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "exited">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logsView, setLogsView] = useState<{
    id: string;
    name: string;
    body: string;
  } | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLive, setLogsLive] = useState(false);
  const [logsFollow, setLogsFollow] = useState(true);
  const [logsWrap, setLogsWrap] = useState(true);
  const logsJobRef = useRef<string | null>(null);
  const logsScrollRef = useRef<HTMLDivElement | null>(null);
  const stickBottomRef = useRef(true);

  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [networks, setNetworks] = useState<NetworkRow[]>([]);
  const [volumes, setVolumes] = useState<VolumeRow[]>([]);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setError(t("scripts.needSessionShort"));
      return;
    }
    setLoading(true);
    try {
      if (section === "containers") {
        const raw = await api.sessionExec(
          sessionId,
          `docker ps -a ${FORMAT} 2>&1`,
        );
        if (looksLikeDockerError(raw) && !raw.includes("{")) {
          setContainers([]);
          setError(t("termTab.dockerUnavailable"));
          return;
        }
        const rows = parseJsonLines<Record<string, string>>(raw).map((row) => ({
          id: row.ID || row.Id || "",
          name: (row.Names || row.Name || "").replace(/^\//, ""),
          image: row.Image || "",
          status: row.Status || "",
          state: row.State || "",
          ports: row.Ports || "",
        }));
        setContainers(rows.filter((r) => r.id));
        setError(null);
        return;
      }

      if (section === "images") {
        const raw = await api.sessionExec(
          sessionId,
          `docker images ${FORMAT} 2>&1`,
        );
        if (looksLikeDockerError(raw) && !raw.includes("{")) {
          setImages([]);
          setError(t("termTab.dockerUnavailable"));
          return;
        }
        const rows = parseJsonLines<Record<string, string>>(raw).map((row) => ({
          id: row.ID || row.Id || "",
          repository: row.Repository || "<none>",
          tag: row.Tag || "<none>",
          size: row.Size || "",
          created: row.CreatedSince || row.CreatedAt || "",
        }));
        setImages(rows.filter((r) => r.id));
        setError(null);
        return;
      }

      if (section === "networks") {
        const raw = await api.sessionExec(
          sessionId,
          `docker network ls ${FORMAT} 2>&1`,
        );
        if (looksLikeDockerError(raw) && !raw.includes("{")) {
          setNetworks([]);
          setError(t("termTab.dockerUnavailable"));
          return;
        }
        const rows = parseJsonLines<Record<string, string>>(raw).map((row) => ({
          id: row.ID || row.Id || "",
          name: row.Name || "",
          driver: row.Driver || "",
          scope: row.Scope || "",
        }));
        setNetworks(rows.filter((r) => r.id));
        setError(null);
        return;
      }

      const raw = await api.sessionExec(
        sessionId,
        `docker volume ls ${FORMAT} 2>&1`,
      );
      if (looksLikeDockerError(raw) && !raw.includes("{")) {
        setVolumes([]);
        setError(t("termTab.dockerUnavailable"));
        return;
      }
      const rows = parseJsonLines<Record<string, string>>(raw).map((row) => ({
        name: row.Name || "",
        driver: row.Driver || "",
        scope: row.Scope || "",
        mountpoint: row.Mountpoint || "",
      }));
      setVolumes(rows.filter((r) => r.name));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId, section, t]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const runDocker = async (
    key: string,
    command: string,
    confirmMsg?: string,
  ) => {
    if (!sessionId) return;
    if (confirmMsg) {
      const ok = await dialogs.confirm(confirmMsg, { danger: true });
      if (!ok) return;
    }
    setBusy(key);
    try {
      const raw = await api.sessionExec(sessionId, `${command} 2>&1`);
      const text = raw.trim();
      if (
        looksLikeDockerError(text) ||
        /^Error response from daemon:/im.test(text) ||
        /^Error:/im.test(text)
      ) {
        toast.error(text.slice(0, 800) || t("termTab.dockerUnavailable"));
      } else {
        const action = /\brestart\b/.test(command)
          ? t("termTab.dockerRestart")
          : /\bstop\b/.test(command)
            ? t("termTab.dockerStop")
            : /\bstart\b/.test(command)
              ? t("termTab.dockerStart")
              : /\b(rmi|rm|network rm|volume rm)\b/.test(command)
                ? t("termTab.dockerRemove")
                : t("termTab.docker");
        toast.success(t("termTab.dockerOpOk", { action }));
      }
      await refresh();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  };

  const copyText = async (text: string) => {
    try {
      await clipboardWriteText(text);
      toast.success(t("termTab.copied"));
    } catch {
      toast.error(t("termTab.copyFail"));
    }
  };

  const openShell = async (id: string) => {
    if (!sessionId) return;
    try {
      const ref = safeArg(id);
      await api.sessionWrite(sessionId, `docker exec -it ${ref} sh\n`);
      toast.success(t("termTab.dockerShellOk"));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const scrollLogsToBottom = useCallback(() => {
    const el = logsScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickBottomRef.current = true;
    setLogsFollow(true);
  }, []);

  const stopLogsStream = useCallback(async () => {
    const jobId = logsJobRef.current;
    logsJobRef.current = null;
    setLogsLive(false);
    if (jobId) {
      try {
        await api.sessionExecCancel(jobId);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const startLogsStream = useCallback(
    async (id: string, name: string) => {
      if (!sessionId) return;
      await stopLogsStream();
      setLogsView({ id, name, body: "" });
      setLogsLoading(true);
      setBusy(`logs:${id}`);
      stickBottomRef.current = true;
      setLogsFollow(true);
      try {
        const ref = safeArg(id);
        const jobId = await api.sessionExecStream(
          sessionId,
          `docker logs -f --tail ${LOG_MAX_LINES} ${ref}`,
        );
        logsJobRef.current = jobId;
        setLogsLive(true);
      } catch (e) {
        setLogsLive(false);
        toast.error(String(e));
        setLogsView(null);
      } finally {
        setLogsLoading(false);
        setBusy(null);
      }
    },
    [sessionId, stopLogsStream],
  );

  useEffect(() => {
    let un: (() => void) | undefined;
    void onSessionExecOutput((p) => {
      if (!logsJobRef.current || p.jobId !== logsJobRef.current) return;
      if (p.done) {
        logsJobRef.current = null;
        setLogsLive(false);
        setLogsView((cur) =>
          cur && !cur.body.trim()
            ? { ...cur, body: t("termTab.dockerLogsEmpty") }
            : cur,
        );
        return;
      }
      if (!p.data) return;
      const chunk = stripAnsi(p.data);
      setLogsView((cur) =>
        cur ? { ...cur, body: appendCapped(cur.body, chunk) } : cur,
      );
    }).then((fn) => {
      un = fn;
    });
    return () => {
      un?.();
    };
  }, [t]);

  useLayoutEffect(() => {
    if (!logsView || !logsFollow) return;
    if (isLogSelecting()) return;
    const el = logsScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logsView?.body, logsFollow, logsView]);

  useEffect(() => {
    return () => {
      void stopLogsStream();
    };
  }, [stopLogsStream]);

  const showLogs = async (id: string, name: string) => {
    await startLogsStream(id, name);
  };

  const closeLogs = () => {
    void stopLogsStream();
    setLogsView(null);
  };

  const filteredContainers = useMemo(() => {
    let list = [...containers];
    if (filter === "running") list = list.filter((c) => isRunning(c.state));
    if (filter === "exited") {
      list = list.filter((c) => c.state.toLowerCase() === "exited");
    }
    const query = q.trim().toLowerCase();
    if (query) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.image.toLowerCase().includes(query) ||
          c.id.toLowerCase().includes(query) ||
          c.status.toLowerCase().includes(query) ||
          c.ports.toLowerCase().includes(query),
      );
    }
    return list;
  }, [containers, q, filter]);

  const filteredImages = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return images;
    return images.filter(
      (img) =>
        img.repository.toLowerCase().includes(query) ||
        img.tag.toLowerCase().includes(query) ||
        img.id.toLowerCase().includes(query),
    );
  }, [images, q]);

  const filteredNetworks = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return networks;
    return networks.filter(
      (n) =>
        n.name.toLowerCase().includes(query) ||
        n.driver.toLowerCase().includes(query) ||
        n.id.toLowerCase().includes(query),
    );
  }, [networks, q]);

  const filteredVolumes = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return volumes;
    return volumes.filter(
      (v) =>
        v.name.toLowerCase().includes(query) ||
        v.driver.toLowerCase().includes(query) ||
        v.mountpoint.toLowerCase().includes(query),
    );
  }, [volumes, q]);

  const count =
    section === "containers"
      ? filteredContainers.length
      : section === "images"
        ? filteredImages.length
        : section === "networks"
          ? filteredNetworks.length
          : filteredVolumes.length;

  const sections: { id: Section; label: string }[] = [
    { id: "containers", label: t("termTab.dockerContainers") },
    { id: "images", label: t("termTab.dockerImages") },
    { id: "networks", label: t("termTab.dockerNetworks") },
    { id: "volumes", label: t("termTab.dockerVolumes") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* —— 标题与刷新 —— */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className={sidebarPanelTitleClass}>{t("termTab.docker")}</span>
        <span className={sidebarPanelMetaClass}>
          {t("termTab.dockerCount", { count })}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="ml-auto"
              aria-label={t("terminal.refresh")}
              onClick={() => refresh()}
            >
              <RefreshCw
                size={SIDEBAR_ICON}
                className={loading ? "animate-spin" : ""}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("terminal.refresh")}</TooltipContent>
        </Tooltip>
      </div>

      {/* —— 分区、搜索与容器状态过滤 —— */}
      <div className="border-b border-border px-2 py-2">
        <div className="flex flex-wrap gap-1">
          {sections.map((s) => (
            <Button
              key={s.id}
              type="button"
              size="xs"
              variant={section === s.id ? "default" : "outline"}
              onClick={() => {
                setSection(s.id);
                setQ("");
                setFilter("all");
              }}
            >
              {s.label}
            </Button>
          ))}
        </div>
        <div className="mt-2">
          <InputGroup className="h-7">
            <InputGroupAddon>
              <Search size={SIDEBAR_ICON} />
            </InputGroupAddon>
            <InputGroupInput
              className="text-xs"
              placeholder={t("termTab.dockerSearch")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </InputGroup>
        </div>
        {section === "containers" && (
          <div className="mt-2 flex flex-wrap gap-1">
            {(
              [
                ["all", t("termTab.filterAll")],
                ["running", t("termTab.dockerRunning")],
                ["exited", t("termTab.dockerExited")],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                size="xs"
                variant={filter === key ? "default" : "outline"}
                onClick={() => setFilter(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* —— 资源列表（容器 / 镜像 / 网络 / 卷） —— */}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto p-1.5">
        {!sessionId || kind == null ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("scripts.needSessionShort")}
          </div>
        ) : error ? (
          <div className="px-2 py-4 text-xs text-destructive">{error}</div>
        ) : section === "containers" ? (
          filteredContainers.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t("termTab.dockerEmpty")}
            </div>
          ) : (
            filteredContainers.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-0.5 rounded-md px-1.5 py-1 hover:bg-accent"
              >
                <div className="flex w-full min-w-0 items-start gap-2">
                  <div
                    className={`mt-1 size-1.5 shrink-0 rounded-full ${
                      isRunning(c.state)
                        ? "bg-success"
                        : c.state.toLowerCase() === "exited"
                          ? "bg-destructive"
                          : "bg-primary"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className={sidebarItemTitleClass} title={c.name}>
                      {c.name || shortId(c.id)}
                    </div>
                    <div className={sidebarItemSubClass} title={c.image}>
                      {c.image}
                    </div>
                    <div className={sidebarItemSubClass}>
                      {shortId(c.id)}
                      {c.ports ? ` · ${c.ports}` : ""}
                    </div>
                    <div className={sidebarTagRowClass}>
                      <Badge
                        size="sm"
                        variant={badgeVariant(stateTone(c.state))}
                      >
                        {c.state || "?"}
                      </Badge>
                      <Badge size="sm" variant="secondary" title={c.status}>
                        {c.status || "-"}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-0.5 pl-[11px]">
                  {isRunning(c.state) ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={t("termTab.dockerStop")}
                          disabled={busy === c.id}
                          onClick={() =>
                            runDocker(
                              c.id,
                              `docker stop ${safeArg(c.id)}`,
                              t("termTab.dockerStopConfirm", {
                                name: c.name || shortId(c.id),
                              }),
                            )
                          }
                        >
                          <Square size={SIDEBAR_ICON} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("termTab.dockerStop")}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={t("termTab.dockerStart")}
                          disabled={busy === c.id}
                          onClick={() =>
                            runDocker(c.id, `docker start ${safeArg(c.id)}`)
                          }
                        >
                          <Play size={SIDEBAR_ICON} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("termTab.dockerStart")}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("termTab.dockerRestart")}
                        disabled={busy === c.id}
                        onClick={() =>
                          runDocker(c.id, `docker restart ${safeArg(c.id)}`)
                        }
                      >
                        <RotateCcw size={SIDEBAR_ICON} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("termTab.dockerRestart")}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("termTab.dockerShell")}
                        onClick={() => openShell(c.id)}
                      >
                        <Terminal size={SIDEBAR_ICON} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("termTab.dockerShell")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("termTab.dockerLogs")}
                        disabled={!!busy}
                        onClick={() => showLogs(c.id, c.name || shortId(c.id))}
                      >
                        <ScrollText size={SIDEBAR_ICON} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("termTab.dockerLogs")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("termTab.dockerCopy")}
                        onClick={() => copyText(c.name || c.id)}
                      >
                        <Copy size={SIDEBAR_ICON} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("termTab.dockerCopy")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("termTab.dockerRemove")}
                        disabled={busy === c.id}
                        onClick={() =>
                          runDocker(
                            c.id,
                            `docker rm -f ${safeArg(c.id)}`,
                            t("termTab.dockerRmContainerConfirm", {
                              name: c.name || shortId(c.id),
                            }),
                          )
                        }
                      >
                        <Trash2 size={SIDEBAR_ICON} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("termTab.dockerRemove")}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))
          )
        ) : section === "images" ? (
          filteredImages.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t("termTab.dockerEmpty")}
            </div>
          ) : (
            filteredImages.map((img) => {
              const ref =
                img.repository !== "<none>" && img.tag !== "<none>"
                  ? `${img.repository}:${img.tag}`
                  : img.id;
              return (
                <div
                  key={`${img.id}:${img.tag}`}
                  className={sidebarItemRowClass}
                >
                  <div className="min-w-0 flex-1">
                    <div className={sidebarItemTitleClass} title={ref}>
                      {img.repository}
                    </div>
                    <div className={sidebarItemSubClass}>
                      {img.tag} · {shortId(img.id)}
                    </div>
                    <div className={sidebarItemSubClass}>
                      {img.size}
                      {img.created ? ` · ${img.created}` : ""}
                    </div>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("termTab.dockerCopy")}
                        onClick={() => copyText(ref)}
                      >
                        <Copy size={SIDEBAR_ICON} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("termTab.dockerCopy")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("termTab.dockerRemove")}
                        disabled={busy === img.id}
                        onClick={() =>
                          runDocker(
                            img.id,
                            `docker rmi ${safeArg(img.id)}`,
                            t("termTab.dockerRmImageConfirm", { name: ref }),
                          )
                        }
                      >
                        <Trash2 size={SIDEBAR_ICON} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("termTab.dockerRemove")}</TooltipContent>
                  </Tooltip>
                </div>
              );
            })
          )
        ) : section === "networks" ? (
          filteredNetworks.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t("termTab.dockerEmpty")}
            </div>
          ) : (
            filteredNetworks.map((n) => {
              const builtin = ["bridge", "host", "none"].includes(n.name);
              return (
                <div key={n.id} className={sidebarItemRowClass}>
                  <div className="min-w-0 flex-1">
                    <div className={sidebarItemTitleClass}>{n.name}</div>
                    <div className={sidebarItemSubClass}>
                      {n.driver} · {n.scope}
                    </div>
                    <div className={sidebarItemSubClass}>{shortId(n.id)}</div>
                    {builtin && (
                      <div className={sidebarTagRowClass}>
                        <Badge size="sm" variant="secondary">
                          {t("termTab.dockerBuiltin")}
                        </Badge>
                      </div>
                    )}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("termTab.dockerCopy")}
                        onClick={() => copyText(n.name)}
                      >
                        <Copy size={SIDEBAR_ICON} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("termTab.dockerCopy")}</TooltipContent>
                  </Tooltip>
                  {!builtin && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={t("termTab.dockerRemove")}
                          disabled={busy === n.id}
                          onClick={() =>
                            runDocker(
                              n.id,
                              `docker network rm ${safeArg(n.id)}`,
                              t("termTab.dockerRmNetworkConfirm", {
                                name: n.name,
                              }),
                            )
                          }
                        >
                          <Trash2 size={SIDEBAR_ICON} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("termTab.dockerRemove")}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              );
            })
          )
        ) : filteredVolumes.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("termTab.dockerEmpty")}
          </div>
        ) : (
          filteredVolumes.map((v) => (
            <div key={v.name} className={sidebarItemRowClass}>
              <div className="min-w-0 flex-1">
                <div className={sidebarItemTitleClass}>{v.name}</div>
                <div className={sidebarItemSubClass}>
                  {v.driver} · {v.scope}
                </div>
                {v.mountpoint ? (
                  <div className={sidebarItemSubClass} title={v.mountpoint}>
                    {v.mountpoint}
                  </div>
                ) : null}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t("termTab.dockerCopy")}
                    onClick={() => copyText(v.name)}
                  >
                    <Copy size={SIDEBAR_ICON} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("termTab.dockerCopy")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t("termTab.dockerRemove")}
                    disabled={busy === v.name}
                    onClick={() =>
                      runDocker(
                        v.name,
                        `docker volume rm ${safeArg(v.name)}`,
                        t("termTab.dockerRmVolumeConfirm", { name: v.name }),
                      )
                    }
                  >
                    <Trash2 size={SIDEBAR_ICON} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("termTab.dockerRemove")}</TooltipContent>
              </Tooltip>
            </div>
          ))
        )}
      </div>

      {/* —— 容器日志：实时 follow，最多 1000 行 —— */}
      {logsView ? (
        <FloatingWindow
          title={t("termTab.dockerLogsTitle", { name: logsView.name })}
          onClose={closeLogs}
          initialWidth={820}
          initialHeight={560}
          allowFullscreen
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
          headerActions={
            <div className="flex items-center gap-1">
              {logsLive ? (
                <Badge size="sm" variant="secondary">
                  {t("termTab.dockerLogsLive")}
                </Badge>
              ) : null}
              {logsLive && !logsFollow ? (
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  onClick={scrollLogsToBottom}
                >
                  <ArrowDown size={12} />
                  {t("termTab.dockerLogsJumpBottom")}
                </Button>
              ) : null}
              <Button
                type="button"
                size="xs"
                variant={logsWrap ? "secondary" : "outline"}
                aria-pressed={logsWrap}
                title={t("termTab.dockerLogsWrap")}
                onClick={() => setLogsWrap((v) => !v)}
              >
                <WrapText size={12} />
                {t("termTab.dockerLogsWrap")}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={logsLoading}
                onClick={() => void startLogsStream(logsView.id, logsView.name)}
              >
                {logsLoading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                {t("termTab.dockerLogsRefresh")}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={!logsView.body}
                onClick={() => {
                  void clipboardWriteText(logsView.body).then(() =>
                    toast.success(t("termTab.dockerLogsCopied")),
                  );
                }}
              >
                <Copy size={12} />
                {t("termTab.dockerCopy")}
              </Button>
            </div>
          }
        >
          <div
            ref={logsScrollRef}
            className="select-text min-h-0 flex-1 overflow-auto bg-zinc-950 px-3 py-2"
            onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom =
                el.scrollHeight - el.scrollTop - el.clientHeight < 48;
              stickBottomRef.current = atBottom;
              setLogsFollow(atBottom);
            }}
          >
            {logsLoading && !logsView.body ? (
              <div className="flex h-full items-center justify-center text-xs text-zinc-400">
                <Loader2 size={16} className="mr-2 animate-spin" />
                {t("termTab.dockerLogsLoading")}
              </div>
            ) : (
              <pre
                className={cn(
                  "select-text font-mono text-[12px] leading-relaxed text-zinc-200",
                  logsWrap
                    ? "whitespace-pre-wrap break-words"
                    : "whitespace-pre",
                )}
              >
                {logsView.body || t("termTab.dockerLogsEmpty")}
              </pre>
            )}
          </div>
        </FloatingWindow>
      ) : null}
    </div>
  );
}
