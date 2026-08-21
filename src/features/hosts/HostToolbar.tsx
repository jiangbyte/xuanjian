/**
 * @file 主机列表搜索与筛选工具栏
 * @author Charlie
 * @description 搜索框、标签 / 排序筛选，以及 SSH 目标快捷操作。
 */

import { useTranslation } from "react-i18next";
import { Plus, Search } from "lucide-react";
import { HostRow, TagRow } from "@/lib/db";
import { Select } from "@/components/Select";
import type { SshTarget } from "@/lib/sshTarget";

/** 主机控制台顶部搜索 / 筛选 / 排序工具栏 */
export function HostToolbar({
  search,
  tag,
  sortBy,
  tags,
  sshTarget,
  matchedByTarget,
  filteredCount,
  targetLabel,
  onSearchChange,
  onTagChange,
  onSortChange,
  onSearchEnter,
  onSearchEscape,
  onNewHost,
  onConnectMatched,
  onCreateFromTarget,
}: {
  search: string;
  tag: string | null;
  sortBy: "name" | "recent" | "status";
  tags: TagRow[];
  sshTarget: SshTarget | null;
  matchedByTarget: HostRow | null;
  filteredCount: number;
  targetLabel: string;
  onSearchChange: (value: string) => void;
  onTagChange: (value: string | null) => void;
  onSortChange: (value: "name" | "recent" | "status") => void;
  onSearchEnter: () => void;
  onSearchEscape: () => void;
  onNewHost: () => void;
  onConnectMatched: (host: HostRow) => void;
  onCreateFromTarget: (target: SshTarget) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="border-b border-[var(--border)] px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="field-icon-wrap flex-1">
          <Search size={14} className="field-icon" />
          <input
            className="field"
            placeholder={t("hosts.search")}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSearchEnter();
              } else if (e.key === "Escape") {
                onSearchEscape();
              }
            }}
          />
        </div>
        <Select
          className="select-inline"
          aria-label={t("hosts.allTags")}
          value={tag ?? ""}
          options={[
            { value: "", label: t("hosts.allTags") },
            ...tags.map((tagItem) => ({
              value: tagItem.name,
              label: tagItem.name,
            })),
          ]}
          onChange={(v) => onTagChange(v || null)}
        />
        <Select
          className="select-inline"
          aria-label={t("hosts.sortName")}
          value={sortBy}
          options={[
            { value: "name", label: t("hosts.sortName") },
            { value: "recent", label: t("hosts.sortRecent") },
            { value: "status", label: t("hosts.sortStatus") },
          ]}
          onChange={(v) => onSortChange(v as "name" | "recent" | "status")}
        />
        <button className="btn btn-primary" onClick={onNewHost}>
          <Plus size={14} />
          {t("hosts.newHost")}
        </button>
      </div>

      {(sshTarget || search.trim()) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="muted">{t("hosts.searchHint")}</span>
          {matchedByTarget && (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => onConnectMatched(matchedByTarget)}
            >
              {t("hosts.searchConnect", { target: targetLabel })}
            </button>
          )}
          {sshTarget && !matchedByTarget && (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => onCreateFromTarget(sshTarget)}
            >
              {t("hosts.searchSave")} · {targetLabel}
            </button>
          )}
          {search.trim() && filteredCount === 0 && !sshTarget && (
            <span className="muted">{t("hosts.searchNoMatch")}</span>
          )}
        </div>
      )}
    </div>
  );
}
