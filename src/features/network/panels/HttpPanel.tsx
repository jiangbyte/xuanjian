/**
 * @file HTTP / TLS / Whois 面板
 * @author Charlie
 * @description 发送自定义 HTTP 请求、拉取 TLS 证书信息、查询 Whois，
 * 并展示近期网络工具历史。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type HttpResponse, type TlsCertInfo } from "@/lib/tauri";
import {
  addNetworkHistory,
  clearNetworkHistory,
  listNetworkHistory,
  type NetworkHistoryRow,
} from "@/lib/db";
import { Select } from "@/components/Select";

/** 将多行 `Key: Value` 文本解析为请求头数组 */
function parseHeaders(raw: string): [string, string][] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(":");
      if (i < 0) return [l, ""] as [string, string];
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string];
    });
}

/** HTTP / TLS / Whois 综合面板 */
export function HttpPanel() {
  const { t } = useTranslation();
  const [sub, setSub] = useState<"http" | "tls" | "whois">("http");
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("https://example.com");
  const [headers, setHeaders] = useState("User-Agent: Xuanjian");
  const [body, setBody] = useState("");
  const [follow, setFollow] = useState(true);
  const [resp, setResp] = useState<HttpResponse | null>(null);
  const [tlsHost, setTlsHost] = useState("example.com:443");
  const [cert, setCert] = useState<TlsCertInfo | null>(null);
  const [whoisQ, setWhoisQ] = useState("example.com");
  const [whoisOut, setWhoisOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<NetworkHistoryRow[]>([]);

  const reloadHistory = () =>
    listNetworkHistory(30).then(setHistory).catch(console.error);

  useEffect(() => {
    reloadHistory();
  }, []);

  const send = async () => {
    setBusy(true);
    setError(null);
    setResp(null);
    try {
      const r = await api.networkHttpRequest({
        method,
        url: url.trim(),
        headers: parseHeaders(headers),
        body: body || null,
        followRedirect: follow,
      });
      setResp(r);
      await addNetworkHistory("http", `${method} ${url}`, String(r.status));
      reloadHistory();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const fetchCert = async () => {
    setBusy(true);
    setError(null);
    setCert(null);
    try {
      const c = await api.networkTlsCert(tlsHost.trim());
      setCert(c);
      await addNetworkHistory("tls", tlsHost);
      reloadHistory();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const runWhois = async () => {
    setBusy(true);
    setError(null);
    setWhoisOut("");
    try {
      const out = await api.networkWhois(whoisQ.trim());
      setWhoisOut(out);
      await addNetworkHistory("whois", whoisQ);
      reloadHistory();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 gap-3 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto">
        <div className="flex gap-1">
          {(["http", "tls", "whois"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`btn btn-sm ${sub === m ? "btn-primary" : ""}`}
              onClick={() => setSub(m)}
            >
              {m === "http"
                ? "HTTP"
                : m === "tls"
                  ? t("network.fetchCert")
                  : t("network.whois")}
            </button>
          ))}
        </div>

        {sub === "http" && (
          <>
            <div className="flex flex-wrap gap-2">
              <label className="flex w-28 flex-col gap-1 text-xs muted">
                {t("network.method")}
                <Select
                  value={method}
                  onChange={setMethod}
                  options={[
                    "GET",
                    "POST",
                    "PUT",
                    "PATCH",
                    "DELETE",
                    "HEAD",
                  ].map((m) => ({ value: m, label: m }))}
                />
              </label>
              <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs muted">
                {t("network.url")}
                <input
                  className="field"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 self-end text-xs">
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(e) => setFollow(e.target.checked)}
                />
                {t("network.followRedirect")}
              </label>
              <button
                type="button"
                className="btn btn-primary self-end"
                disabled={busy}
                onClick={send}
              >
                {t("network.send")}
              </button>
            </div>
            <label className="flex flex-col gap-1 text-xs muted">
              {t("network.headers")}
              <textarea
                className="field min-h-[72px] font-mono"
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs muted">
              {t("network.body")}
              <textarea
                className="field min-h-[80px] font-mono"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            {resp && (
              <div className="space-y-2 rounded-lg border border-[var(--border)] p-3 text-xs">
                <div>
                  {t("network.status")}: {resp.status} ({resp.elapsedMs} ms)
                </div>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap muted">
                  {resp.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}
                </pre>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
                  {resp.body}
                </pre>
              </div>
            )}
          </>
        )}

        {sub === "tls" && (
          <>
            <div className="flex gap-2">
              <input
                className="field flex-1"
                value={tlsHost}
                onChange={(e) => setTlsHost(e.target.value)}
                placeholder={t("network.tlsHost")}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={fetchCert}
              >
                {t("network.fetchCert")}
              </button>
            </div>
            {cert && (
              <div className="space-y-1 rounded-lg border border-[var(--border)] p-3 text-xs">
                <div>Subject: {cert.subject}</div>
                <div>Issuer: {cert.issuer}</div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap muted">
                  {cert.raw}
                </pre>
              </div>
            )}
          </>
        )}

        {sub === "whois" && (
          <>
            <div className="flex gap-2">
              <input
                className="field flex-1"
                value={whoisQ}
                onChange={(e) => setWhoisQ(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={runWhois}
              >
                {t("network.whoisQuery")}
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-xs">
              {whoisOut}
            </pre>
          </>
        )}

        {error && <div className="text-sm text-[var(--danger)]">{error}</div>}
      </div>

      <aside className="flex w-56 shrink-0 flex-col border-l border-[var(--border)] pl-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">{t("network.history")}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => clearNetworkHistory().then(reloadHistory)}
          >
            {t("network.clear")}
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto text-xs">
          {history.length === 0 && (
            <div className="muted">{t("network.noHistory")}</div>
          )}
          {history.map((h) => (
            <button
              key={h.id}
              type="button"
              className="list-row w-full text-left"
              onClick={() => {
                if (h.kind === "http") {
                  setSub("http");
                  const parts = h.target.split(" ");
                  if (parts.length >= 2) {
                    setMethod(parts[0]);
                    setUrl(parts.slice(1).join(" "));
                  }
                } else if (h.kind === "tls") {
                  setSub("tls");
                  setTlsHost(h.target);
                } else if (h.kind === "whois") {
                  setSub("whois");
                  setWhoisQ(h.target);
                }
              }}
            >
              <div className="truncate font-medium">{h.kind}</div>
              <div className="truncate muted">{h.target}</div>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
