/**
 * @file 主机列表搜索与筛选工具栏
 * @author Charlie
 * @description 搜索框、标签 / 排序筛选，以及 SSH 目标快捷操作。
 */

import { Plus, Search, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HostRow, TagRow } from "@/lib/db";
import type { SshTarget } from "@/lib/sshTarget";

const ALL_TAGS = "__all__";

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
  onImport,
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
  onImport?: () => void;
  onConnectMatched: (host: HostRow) => void;
  onCreateFromTarget: (target: SshTarget) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="border-b border-border px-5 py-4">
      <div className="flex flex-nowrap items-center gap-3">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <Search size={14} />
          </InputGroupAddon>
          <InputGroupInput
            placeholder={t("hosts.search")}
            value={search}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSearchEnter();
              } else if (e.key === "Escape") {
                onSearchEscape();
              }
            }}
          />
        </InputGroup>
        <Select
          value={tag ?? ALL_TAGS}
          onValueChange={(v) => onTagChange(v === ALL_TAGS ? null : v)}
        >
          <SelectTrigger className="w-[140px]" aria-label={t("hosts.allTags")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TAGS}>{t("hosts.allTags")}</SelectItem>
            {tags.map((tagItem) => (
              <SelectItem key={tagItem.name} value={tagItem.name}>
                {tagItem.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(v) => onSortChange(v as typeof sortBy)}
        >
          <SelectTrigger className="w-[140px]" aria-label={t("hosts.sortName")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">{t("hosts.sortName")}</SelectItem>
            <SelectItem value="recent">{t("hosts.sortRecent")}</SelectItem>
            <SelectItem value="status">{t("hosts.sortStatus")}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={onImport} disabled={!onImport}>
          <Upload size={14} />
          {t("share.import")}
        </Button>
        <Button onClick={onNewHost}>
          <Plus size={14} />
          {t("hosts.newHost")}
        </Button>
      </div>

      {(sshTarget || search.trim()) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t("hosts.searchHint")}</span>
          {matchedByTarget && (
            <Button size="xs" onClick={() => onConnectMatched(matchedByTarget)}>
              {t("hosts.searchConnect", { target: targetLabel })}
            </Button>
          )}
          {sshTarget && !matchedByTarget && (
            <Button size="xs" onClick={() => onCreateFromTarget(sshTarget)}>
              {t("hosts.searchSave")} · {targetLabel}
            </Button>
          )}
          {search.trim() && filteredCount === 0 && !sshTarget && (
            <span className="text-muted-foreground">
              {t("hosts.searchNoMatch")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
