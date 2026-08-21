/**
 * @file 网络杂项工具面板
 * @author Charlie
 * @description 提供 Base64 / URL / Hex 编解码、时间戳转换与正则匹配等小工具。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/** Base64、URL、Hex、时间戳与正则等杂项工具 */
export function UtilsPanel() {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [out, setOut] = useState("");
  const [ts, setTs] = useState(String(Math.floor(Date.now() / 1000)));
  const [dateStr, setDateStr] = useState("");
  const [pattern, setPattern] = useState("(https?://\\S+)");
  const [regexInput, setRegexInput] = useState("visit https://example.com now");
  const [flags, setFlags] = useState("g");

  const matches = useMemo(() => {
    try {
      const re = new RegExp(pattern, flags);
      return [...regexInput.matchAll(re)].map((m) => m[0]);
    } catch {
      return ["invalid regex"];
    }
  }, [pattern, flags, regexInput]);

  const encB64 = () => {
    try {
      setOut(btoa(unescape(encodeURIComponent(text))));
    } catch (e) {
      setOut(String(e));
    }
  };
  const decB64 = () => {
    try {
      setOut(decodeURIComponent(escape(atob(text))));
    } catch (e) {
      setOut(String(e));
    }
  };
  const encUrl = () => setOut(encodeURIComponent(text));
  const decUrl = () => {
    try {
      setOut(decodeURIComponent(text));
    } catch (e) {
      setOut(String(e));
    }
  };
  const encHex = () => {
    const bytes = new TextEncoder().encode(text);
    setOut([...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" "));
  };
  const decHex = () => {
    try {
      const hex = text.replace(/\s+/g, "");
      const bytes = new Uint8Array(
        hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
      );
      setOut(new TextDecoder().decode(bytes));
    } catch (e) {
      setOut(String(e));
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {/* —— 编解码 —— */}
        <div>
          <div className="mb-2 text-sm font-medium">
            {t("network.base64")} / {t("network.urlEnc")} / {t("network.hex")}
          </div>
          <textarea
            className="field min-h-[80px] font-mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-1">
            <button type="button" className="btn btn-sm" onClick={encB64}>
              B64 {t("network.encode")}
            </button>
            <button type="button" className="btn btn-sm" onClick={decB64}>
              B64 {t("network.decode")}
            </button>
            <button type="button" className="btn btn-sm" onClick={encUrl}>
              URL {t("network.encode")}
            </button>
            <button type="button" className="btn btn-sm" onClick={decUrl}>
              URL {t("network.decode")}
            </button>
            <button type="button" className="btn btn-sm" onClick={encHex}>
              Hex {t("network.encode")}
            </button>
            <button type="button" className="btn btn-sm" onClick={decHex}>
              Hex {t("network.decode")}
            </button>
          </div>
          <textarea
            className="field mt-2 min-h-[80px] font-mono"
            value={out}
            readOnly
          />
        </div>

        {/* —— 时间戳转换 —— */}
        <div className="border-t border-[var(--border)] pt-3">
          <div className="mb-2 text-sm font-medium">
            {t("network.timestamp")}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              className="field w-40 font-mono"
              value={ts}
              onChange={(e) => setTs(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const n = Number(ts);
                const d = new Date(n > 1e12 ? n : n * 1000);
                setDateStr(d.toISOString());
              }}
            >
              {t("network.toDate")}
            </button>
            <input
              className="field min-w-[200px] flex-1 font-mono"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              placeholder="ISO date"
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const d = new Date(dateStr || Date.now());
                setTs(String(Math.floor(d.getTime() / 1000)));
              }}
            >
              {t("network.toTs")}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setTs(String(Math.floor(Date.now() / 1000)))}
            >
              Now
            </button>
          </div>
          {dateStr && <div className="mt-1 text-xs muted">{dateStr}</div>}
        </div>

        {/* —— 正则匹配 —— */}
        <div className="border-t border-[var(--border)] pt-3">
          <div className="mb-2 text-sm font-medium">{t("network.regex")}</div>
          <div className="grid gap-2 sm:grid-cols-[1fr_80px]">
            <input
              className="field font-mono"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={t("network.regexPattern")}
            />
            <input
              className="field font-mono"
              value={flags}
              onChange={(e) => setFlags(e.target.value)}
              placeholder="flags"
            />
          </div>
          <textarea
            className="field mt-2 min-h-[72px] font-mono"
            value={regexInput}
            onChange={(e) => setRegexInput(e.target.value)}
          />
          <div className="mt-2 space-y-1 text-xs">
            {matches.map((m, i) => (
              <div key={i} className="chip font-mono">
                {m}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
