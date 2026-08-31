/**
 * @file 可交互进程树视图
 */

import { ChevronDown, ChevronRight, Search, Skull, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { cn } from "@/lib/utils";
import {
  SIDEBAR_ICON,
  sidebarItemSubClass,
  sidebarItemTitleClass,
  sidebarTagRowClass,
} from "./sidebarUi";
import {
  countProcTree,
  defaultCollapsedPids,
  filterProcTree,
  type ProcTreeNode,
  shortProcName,
} from "./processTree";

function badgeVariant(tone: "danger" | "warn" | "accent" | "muted") {
  if (tone === "danger") return "destructive" as const;
  if (tone === "warn") return "outline" as const;
  if (tone === "accent") return "default" as const;
  return "secondary" as const;
}

function buildTags(node: ProcTreeNode, t: (key: string) => string) {
  const tags: {
    id: string;
    label: string;
    tone: "danger" | "warn" | "accent" | "muted";
  }[] = [];
  if (node.user === "root") {
    tags.push({ id: "root", label: t("termTab.tagRoot"), tone: "warn" });
  } else {
    tags.push({ id: "user", label: node.user, tone: "muted" });
  }
  if (node.cpu >= 30) {
    tags.push({ id: "cpu", label: t("termTab.tagHotCpu"), tone: "danger" });
  } else if (node.cpu >= 10) {
    tags.push({ id: "cpu", label: t("termTab.tagBusy"), tone: "warn" });
  }
  if (node.mem >= 15) {
    tags.push({ id: "mem", label: t("termTab.tagHotMem"), tone: "danger" });
  }
  const cmd = node.cmd.toLowerCase();
  if (/docker|containerd|runc|podman/.test(cmd)) {
    tags.push({ id: "docker", label: "Docker", tone: "accent" });
  }
  return tags.slice(0, 3);
}

function TreeRow({
  node,
  depth,
  collapsed,
  onToggle,
  onSignal,
}: {
  node: ProcTreeNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (pid: string) => void;
  onSignal: (pid: string, sig: "TERM" | "KILL") => void;
}) {
  const { t } = useTranslation();
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.pid);
  const name = shortProcName(node.cmd);
  const tags = buildTags(node, t);

  return (
    <>
      <div
        className="flex items-start gap-1 rounded-md py-1 pr-1 hover:bg-accent/60"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={isCollapsed ? t("termTab.procTreeExpand") : t("termTab.procTreeCollapse")}
            onClick={() => onToggle(node.pid)}
          >
            {isCollapsed ? (
              <ChevronRight size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
          </button>
        ) : (
          <span className="inline-block w-[22px] shrink-0" />
        )}
        <div
          className={`mt-1 size-1.5 shrink-0 rounded-full ${
            node.cpu >= 30
              ? "bg-destructive"
              : node.cpu >= 10
                ? "bg-primary"
                : "bg-success"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className={sidebarItemTitleClass} title={node.cmd}>
            {name}
            {hasChildren ? (
              <span className="ml-1 font-normal text-muted-foreground">
                ({node.children.length})
              </span>
            ) : null}
          </div>
          {name !== node.cmd ? (
            <div className={sidebarItemSubClass} title={node.cmd}>
              {node.cmd}
            </div>
          ) : null}
          <div className={sidebarItemSubClass}>
            PID {node.pid}
            {node.ppid !== "0" ? ` · PPID ${node.ppid}` : ""} · CPU{" "}
            {node.cpu.toFixed(1)}% · MEM {node.mem.toFixed(1)}%
          </div>
          {tags.length > 0 ? (
            <div className={sidebarTagRowClass}>
              {tags.map((tag) => (
                <Badge key={tag.id} size="sm" variant={badgeVariant(tag.tone)}>
                  {tag.label}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={t("termTab.tipTerm")}
              onClick={() => onSignal(node.pid, "TERM")}
            >
              <XCircle size={SIDEBAR_ICON} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("termTab.tipTerm")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={t("termTab.tipKill")}
              onClick={() => onSignal(node.pid, "KILL")}
            >
              <Skull size={SIDEBAR_ICON} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("termTab.tipKill")}</TooltipContent>
        </Tooltip>
      </div>
      {hasChildren && !isCollapsed
        ? node.children.map((child) => (
            <TreeRow
              key={child.pid}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              onSignal={onSignal}
            />
          ))
        : null}
    </>
  );
}

export function ProcessTreeView({
  roots,
  loading,
  onSignal,
}: {
  roots: ProcTreeNode[];
  loading: boolean;
  onSignal: (pid: string, sig: "TERM" | "KILL") => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => filterProcTree(roots, q), [roots, q]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const treeKey = useMemo(
    () => roots.map((r) => r.pid).join(","),
    [roots],
  );

  useEffect(() => {
    if (roots.length === 0) return;
    setCollapsed(defaultCollapsedPids(roots, q.trim() ? 99 : 1));
  }, [treeKey, q, roots]);

  const toggle = (pid: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const total = countProcTree(filtered);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <InputGroup className="h-8">
          <InputGroupAddon>
            <Search size={13} />
          </InputGroupAddon>
          <InputGroupInput
            className="text-xs"
            placeholder={t("termTab.procSearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </InputGroup>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("termTab.procTreeCount", { count: total })}</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-6"
            onClick={() => setCollapsed(new Set())}
          >
            {t("termTab.procTreeExpandAll")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-6"
            onClick={() => setCollapsed(defaultCollapsedPids(filtered, 0))}
          >
            {t("termTab.procTreeCollapseAll")}
          </Button>
        </div>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-auto p-2", loading && "opacity-60")}>
        {loading && roots.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            {t("termTab.procTreeLoading")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            {t("termTab.procTreeEmpty")}
          </div>
        ) : (
          filtered.map((node) => (
            <TreeRow
              key={node.pid}
              node={node}
              depth={0}
              collapsed={collapsed}
              onToggle={toggle}
              onSignal={onSignal}
            />
          ))
        )}
      </div>
    </div>
  );
}
