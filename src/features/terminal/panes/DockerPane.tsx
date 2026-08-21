import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import { api } from "../../../lib/tauri";
import { clipboardWriteText } from "../../../lib/clipboard";
import { useDialog } from "../../../components/Dialog";

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

function parseJsonLines<T>(raw: string): T[] {
  const out: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      /* skip */
    }
  }
  return out;
}

function looksLikeDockerError(raw: string) {
  return /Cannot connect to the Docker daemon|Is the docker daemon running|docker: command not found|is not recognized as an internal or external command|permission denied while trying to connect|error during connect/i.test(
    raw,
  );
}

/** Only allow docker IDs/names that are safe as bare shell args. */
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

function tipClass(tone: "accent" | "warn" | "danger" | "muted") {
  if (tone === "accent") return "chip chip-accent";
  if (tone === "warn") return "chip chip-warn";
  if (tone === "danger") return "chip chip-danger";
  return "chip";
}

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
  const dialog = useDialog();
  const [section, setSection] = useState<Section>("containers");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "exited">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logsView, setLogsView] = useState<{ title: string; body: string } | null>(
    null,
  );

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

  const runDocker = async (key: string, command: string, confirmMsg?: string) => {
    if (!sessionId) return;
    if (confirmMsg) {
      const ok = await dialog.confirm(confirmMsg, { danger: true });
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
        if (text) await dialog.alert(text.slice(0, 800));
      }
      await refresh();
    } catch (e) {
      await dialog.alert(String(e));
    } finally {
      setBusy(null);
    }
  };

  const copyText = async (text: string) => {
    try {
      await clipboardWriteText(text);
    } catch {
      await dialog.alert(t("termTab.copyFail"));
    }
  };

  const openShell = async (id: string) => {
    if (!sessionId) return;
    try {
      const ref = safeArg(id);
      await api.sessionWrite(sessionId, `docker exec -it ${ref} sh\n`);
    } catch (e) {
      await dialog.alert(String(e));
    }
  };

  const showLogs = async (id: string, name: string) => {
    if (!sessionId) return;
    setBusy(`logs:${id}`);
    try {
      const ref = safeArg(id);
      const raw = await api.sessionExec(
        sessionId,
        `docker logs --tail 120 ${ref} 2>&1`,
      );
      setLogsView({
        title: t("termTab.dockerLogsTitle", { name }),
        body: raw.trim() || t("termTab.dockerLogsEmpty"),
      });
    } catch (e) {
      await dialog.alert(String(e));
    } finally {
      setBusy(null);
    }
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
    <div className="panel flex h-full flex-col">
      <div className="panel-header flex items-center gap-2">
        <span className="text-xs font-medium">{t("termTab.docker")}</span>
        <span className="text-xs muted">
          {t("termTab.dockerCount", { count })}
        </span>
        <button
          className="icon-btn icon-btn-sm tip ml-auto"
          data-tip={t("terminal.refresh")}
          onClick={() => refresh()}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="border-b border-[var(--border)] px-2 py-2">
        <div className="flex flex-wrap gap-1">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`btn btn-sm ${section === s.id ? "btn-primary" : ""}`}
              onClick={() => {
                setSection(s.id);
                setQ("");
                setFilter("all");
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="field-icon-wrap mt-2">
          <Search size={13} className="field-icon" />
          <input
            className="field field-sm"
            placeholder={t("termTab.dockerSearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {section === "containers" && (
          <div className="mt-2 flex gap-1">
            {(
              [
                ["all", t("termTab.filterAll")],
                ["running", t("termTab.dockerRunning")],
                ["exited", t("termTab.dockerExited")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`btn btn-sm ${filter === key ? "btn-primary" : ""}`}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="panel-body panel-list min-h-0 flex-1 overflow-y-auto p-1.5">
        {!sessionId || kind == null ? (
          <div className="px-2 py-6 text-center text-xs muted">
            {t("scripts.needSessionShort")}
          </div>
        ) : error ? (
          <div className="px-2 py-4 text-xs text-danger">{error}</div>
        ) : section === "containers" ? (
          filteredContainers.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs muted">
              {t("termTab.dockerEmpty")}
            </div>
          ) : (
            filteredContainers.map((c) => (
              <div key={c.id} className="list-row list-row-stack">
                <div className="flex w-full min-w-0 items-start gap-2">
                  <div
                    className={`list-row-dot mt-1.5 ${
                      isRunning(c.state)
                        ? "is-ok"
                        : c.state.toLowerCase() === "exited"
                          ? "is-danger"
                          : "is-warn"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="list-row-title truncate" title={c.name}>
                      {c.name || shortId(c.id)}
                    </div>
                    <div className="list-row-sub truncate" title={c.image}>
                      {c.image}
                    </div>
                    <div className="list-row-meta truncate">
                      {shortId(c.id)}
                      {c.ports ? ` · ${c.ports}` : ""}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <span className={tipClass(stateTone(c.state))}>
                        {c.state || "?"}
                      </span>
                      <span className="chip" title={c.status}>
                        {c.status || "-"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-0.5 pl-[13px]">
                  {isRunning(c.state) ? (
                    <button
                      className="icon-btn icon-btn-sm tip"
                      data-tip={t("termTab.dockerStop")}
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
                      <Square size={13} />
                    </button>
                  ) : (
                    <button
                      className="icon-btn icon-btn-sm tip"
                      data-tip={t("termTab.dockerStart")}
                      disabled={busy === c.id}
                      onClick={() =>
                        runDocker(c.id, `docker start ${safeArg(c.id)}`)
                      }
                    >
                      <Play size={13} />
                    </button>
                  )}
                  <button
                    className="icon-btn icon-btn-sm tip"
                    data-tip={t("termTab.dockerRestart")}
                    disabled={busy === c.id}
                    onClick={() =>
                      runDocker(c.id, `docker restart ${safeArg(c.id)}`)
                    }
                  >
                    <RotateCcw size={13} />
                  </button>
                  <button
                    className="icon-btn icon-btn-sm tip"
                    data-tip={t("termTab.dockerShell")}
                    onClick={() => openShell(c.id)}
                  >
                    <Terminal size={13} />
                  </button>
                  <button
                    className="icon-btn icon-btn-sm tip"
                    data-tip={t("termTab.dockerLogs")}
                    disabled={!!busy}
                    onClick={() => showLogs(c.id, c.name || shortId(c.id))}
                  >
                    <ScrollText size={13} />
                  </button>
                  <button
                    className="icon-btn icon-btn-sm tip"
                    data-tip={t("termTab.dockerCopy")}
                    onClick={() => copyText(c.name || c.id)}
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    className="icon-btn icon-btn-sm tip"
                    data-tip={t("termTab.dockerRemove")}
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
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )
        ) : section === "images" ? (
          filteredImages.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs muted">
              {t("termTab.dockerEmpty")}
            </div>
          ) : (
            filteredImages.map((img) => {
              const ref =
                img.repository !== "<none>" && img.tag !== "<none>"
                  ? `${img.repository}:${img.tag}`
                  : img.id;
              return (
                <div key={`${img.id}:${img.tag}`} className="list-row items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="list-row-title truncate" title={ref}>
                      {img.repository}
                    </div>
                    <div className="list-row-sub truncate">
                      {img.tag} · {shortId(img.id)}
                    </div>
                    <div className="list-row-meta">
                      {img.size}
                      {img.created ? ` · ${img.created}` : ""}
                    </div>
                  </div>
                  <button
                    className="icon-btn icon-btn-sm tip"
                    data-tip={t("termTab.dockerCopy")}
                    onClick={() => copyText(ref)}
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    className="icon-btn icon-btn-sm tip"
                    data-tip={t("termTab.dockerRemove")}
                    disabled={busy === img.id}
                    onClick={() =>
                      runDocker(
                        img.id,
                        `docker rmi ${safeArg(img.id)}`,
                        t("termTab.dockerRmImageConfirm", { name: ref }),
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )
        ) : section === "networks" ? (
          filteredNetworks.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs muted">
              {t("termTab.dockerEmpty")}
            </div>
          ) : (
            filteredNetworks.map((n) => {
              const builtin = ["bridge", "host", "none"].includes(n.name);
              return (
                <div key={n.id} className="list-row items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="list-row-title truncate">{n.name}</div>
                    <div className="list-row-sub">
                      {n.driver} · {n.scope}
                    </div>
                    <div className="list-row-meta">{shortId(n.id)}</div>
                    {builtin && (
                      <div className="mt-1.5">
                        <span className="chip">{t("termTab.dockerBuiltin")}</span>
                      </div>
                    )}
                  </div>
                  <button
                    className="icon-btn icon-btn-sm tip"
                    data-tip={t("termTab.dockerCopy")}
                    onClick={() => copyText(n.name)}
                  >
                    <Copy size={13} />
                  </button>
                  {!builtin && (
                    <button
                      className="icon-btn icon-btn-sm tip"
                      data-tip={t("termTab.dockerRemove")}
                      disabled={busy === n.id}
                      onClick={() =>
                        runDocker(
                          n.id,
                          `docker network rm ${safeArg(n.id)}`,
                          t("termTab.dockerRmNetworkConfirm", { name: n.name }),
                        )
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })
          )
        ) : filteredVolumes.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs muted">
            {t("termTab.dockerEmpty")}
          </div>
        ) : (
          filteredVolumes.map((v) => (
            <div key={v.name} className="list-row items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="list-row-title truncate">{v.name}</div>
                <div className="list-row-sub">
                  {v.driver} · {v.scope}
                </div>
                {v.mountpoint ? (
                  <div className="list-row-meta truncate" title={v.mountpoint}>
                    {v.mountpoint}
                  </div>
                ) : null}
              </div>
              <button
                className="icon-btn icon-btn-sm tip"
                data-tip={t("termTab.dockerCopy")}
                onClick={() => copyText(v.name)}
              >
                <Copy size={13} />
              </button>
              <button
                className="icon-btn icon-btn-sm tip"
                data-tip={t("termTab.dockerRemove")}
                disabled={busy === v.name}
                onClick={() =>
                  runDocker(
                    v.name,
                    `docker volume rm ${safeArg(v.name)}`,
                    t("termTab.dockerRmVolumeConfirm", { name: v.name }),
                  )
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>

      {logsView && (
        <div
          className="overlay z-[95] flex items-center justify-center p-4"
          onClick={() => setLogsView(null)}
        >
          <div
            className="modal-card flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-3">
              <h3 className="truncate text-sm font-semibold">{logsView.title}</h3>
              <button className="btn btn-sm" onClick={() => setLogsView(null)}>
                {t("dialog.ok")}
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto bg-[var(--bg)] px-4 py-3 font-mono text-[11px] leading-relaxed">
              {logsView.body}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
