/**
 * @file HTTP / TLS / Whois 面板
 * @author Charlie
 * @description 发送自定义 HTTP 请求、拉取 TLS 证书信息、查询 Whois。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { addNetworkHistory } from "@/lib/db";
import { api, type HttpResponse, type TlsCertInfo } from "@/lib/tauri";
import { cn } from "@/lib/utils";

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
export function HttpPanel({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const [sub, setSub] = useState<"http" | "tls" | "whois">("http");
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [body, setBody] = useState("");
  const [follow, setFollow] = useState(true);
  const [resp, setResp] = useState<HttpResponse | null>(null);
  const [tlsHost, setTlsHost] = useState("");
  const [cert, setCert] = useState<TlsCertInfo | null>(null);
  const [whoisQ, setWhoisQ] = useState("");
  const [whoisOut, setWhoisOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col gap-4 overflow-auto",
        !embedded && "p-4",
      )}
    >
      <div className="flex w-fit" data-slot="button-group">
        {(["http", "tls", "whois"] as const).map((m) => (
          <Button
            key={m}
            size="xs"
            variant={sub === m ? "default" : "outline"}
            onClick={() => setSub(m)}
          >
            {m === "http"
              ? "HTTP"
              : m === "tls"
                ? t("network.fetchCert")
                : t("network.whois")}
          </Button>
        ))}
      </div>

      {sub === "http" && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-28 space-y-1.5">
              <Label>{t("network.method")}</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map(
                    (m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <Label htmlFor="http-url">{t("network.url")}</Label>
              <Input
                id="http-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("network.urlPlaceholder")}
              />
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Checkbox
                id="http-follow"
                checked={follow}
                onCheckedChange={(checked) => setFollow(checked === true)}
              />
              <Label htmlFor="http-follow">{t("network.followRedirect")}</Label>
            </div>
            <Button disabled={busy} onClick={send}>
              {t("network.send")}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="http-headers">{t("network.headers")}</Label>
            <Textarea
              id="http-headers"
              className="font-mono"
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              placeholder={t("network.headersPlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="http-body">{t("network.body")}</Label>
            <Textarea
              id="http-body"
              className="font-mono"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {resp && (
            <div className="space-y-2 rounded-md border border-border p-3 text-xs">
              <div>
                {t("network.status")}: {resp.status} ({resp.elapsedMs} ms)
              </div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-muted-foreground">
                {resp.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}
              </pre>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono">
                {resp.body}
              </pre>
            </div>
          )}
        </>
      )}

      {sub === "tls" && (
        <>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="tls-host">{t("network.tlsHost")}</Label>
              <Input
                id="tls-host"
                value={tlsHost}
                onChange={(e) => setTlsHost(e.target.value)}
                placeholder={t("network.tlsHostPlaceholder")}
              />
            </div>
            <Button disabled={busy} onClick={fetchCert}>
              {t("network.fetchCert")}
            </Button>
          </div>
          {cert && (
            <div className="space-y-1 rounded-md border border-border p-3 text-xs">
              <div>Subject: {cert.subject}</div>
              <div>Issuer: {cert.issuer}</div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-muted-foreground">
                {cert.raw}
              </pre>
            </div>
          )}
        </>
      )}

      {sub === "whois" && (
        <>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="whois-query">{t("network.whois")}</Label>
              <Input
                id="whois-query"
                value={whoisQ}
                onChange={(e) => setWhoisQ(e.target.value)}
                placeholder={t("network.whoisPlaceholder")}
              />
            </div>
            <Button disabled={busy} onClick={runWhois}>
              {t("network.whoisQuery")}
            </Button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-xs">
            {whoisOut}
          </pre>
        </>
      )}

      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}
