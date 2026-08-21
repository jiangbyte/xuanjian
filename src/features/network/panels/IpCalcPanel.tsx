/**
 * @file IP / 子网计算器面板
 * @author Charlie
 * @description CIDR 概览 + 归属检测 + 画布主导的子网规划；右侧检查器操作选中节点。
 */

import {
  Copy,
  Eraser,
  MoreHorizontal,
  RotateCcw,
  SplitSquareVertical,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clipboardWriteText } from "@/lib/clipboard";
import {
  buildRootNode,
  calcCidr,
  clearChildren,
  flattenTree,
  ipInNetwork,
  leafNodes,
  type SubnetTreeNode,
  splitNode,
} from "@/lib/ipcalc";
import { cn } from "@/lib/utils";
import { SubnetTreeFlow } from "./SubnetTreeFlow";

function findInTree(root: SubnetTreeNode, id: string): SubnetTreeNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const found = findInTree(c, id);
    if (found) return found;
  }
  return null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm" title={value}>
        {value}
      </div>
    </div>
  );
}

/** IPv4 CIDR 与子网划分面板 */
export function IpCalcPanel() {
  const { t } = useTranslation();
  const [cidr, setCidr] = useState("192.168.1.0/24");
  const [mask, setMask] = useState("");
  const [checkIp, setCheckIp] = useState("192.168.1.10");
  const [subnetCount, setSubnetCount] = useState(4);
  const [hostsPer, setHostsPer] = useState(50);
  const [tree, setTree] = useState<SubnetTreeNode | null>(() =>
    buildRootNode("192.168.1.0/24"),
  );
  const [selectedId, setSelectedId] = useState<string | null>("192.168.1.0/24");
  const [splitError, setSplitError] = useState<string | null>(null);

  const result = useMemo(() => calcCidr(cidr, mask || undefined), [cidr, mask]);
  const inNet = useMemo(
    () => ipInNetwork(checkIp, result.cidr),
    [checkIp, result.cidr],
  );

  useEffect(() => {
    if (result.error) {
      setTree(null);
      setSelectedId(null);
      return;
    }
    const root = buildRootNode(result.cidr);
    setTree(root);
    setSelectedId(root?.id ?? null);
    setSplitError(null);
  }, [result.cidr, result.error]);

  const selected = useMemo(
    () => (tree && selectedId ? findInTree(tree, selectedId) : null),
    [tree, selectedId],
  );

  const tableRows = useMemo(() => {
    if (!tree) return [];
    return leafNodes(tree).map((n, i) => ({
      index: i + 1,
      cidr: n.cidr,
      network: n.network,
      broadcast: n.broadcast,
      firstHost: n.firstHost,
      lastHost: n.lastHost,
      hostCount: n.hostCount,
    }));
  }, [tree]);

  const splitByCount = () => {
    if (!tree || !selectedId) return;
    const { tree: next, error } = splitNode(tree, selectedId, {
      mode: "count",
      count: subnetCount,
    });
    if (error) {
      setSplitError(error);
      return;
    }
    setSplitError(null);
    setTree(next);
  };

  const splitByHosts = () => {
    if (!tree || !selectedId) return;
    const { tree: next, error } = splitNode(tree, selectedId, {
      mode: "hosts",
      hostsPer,
    });
    if (error) {
      setSplitError(error);
      return;
    }
    setSplitError(null);
    setTree(next);
  };

  const resetTree = () => {
    if (result.error) return;
    const root = buildRootNode(result.cidr);
    setTree(root);
    setSelectedId(root?.id ?? null);
    setSplitError(null);
  };

  const clearSelectedChildren = () => {
    if (!tree || !selectedId) return;
    setTree(clearChildren(tree, selectedId));
    setSplitError(null);
  };

  const copySelected = async () => {
    if (!selected) return;
    await clipboardWriteText(
      [
        selected.cidr,
        selected.network,
        selected.broadcast,
        selected.firstHost,
        selected.lastHost,
        String(selected.hostCount),
      ].join(","),
    );
  };

  const copyTreeCsv = async () => {
    if (!tree) return;
    const header = "cidr,network,broadcast,first,last,hosts,prefix";
    const body = flattenTree(tree)
      .map(
        (n) =>
          `${n.cidr},${n.network},${n.broadcast},${n.firstHost},${n.lastHost},${n.hostCount},${n.prefix}`,
      )
      .join("\n");
    await clipboardWriteText(`${header}\n${body}`);
  };

  const copyLeafTable = async () => {
    const header = "index,cidr,network,broadcast,first,last,hosts";
    const body = tableRows
      .map(
        (r) =>
          `${r.index},${r.cidr},${r.network},${r.broadcast},${r.firstHost},${r.lastHost},${r.hostCount}`,
      )
      .join("\n");
    await clipboardWriteText(`${header}\n${body}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-5">
      {/* —— 输入条 —— */}
      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-[1.2] space-y-1.5">
          <Label htmlFor="ipcalc-cidr">{t("network.cidr")}</Label>
          <Input
            id="ipcalc-cidr"
            className="h-8 font-mono"
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
          />
        </div>
        <div className="min-w-[160px] flex-1 space-y-1.5">
          <Label htmlFor="ipcalc-mask">{t("network.mask")}</Label>
          <Input
            id="ipcalc-mask"
            className="h-8 font-mono"
            value={mask}
            placeholder="255.255.255.0"
            onChange={(e) => setMask(e.target.value)}
          />
        </div>
        <div className="min-w-[160px] flex-1 space-y-1.5">
          <Label htmlFor="ipcalc-check">{t("network.containsIp")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="ipcalc-check"
              className="h-8 font-mono"
              value={checkIp}
              onChange={(e) => setCheckIp(e.target.value)}
            />
            <Badge
              variant={
                inNet
                  ? "default"
                  : inNet === false
                    ? "destructive"
                    : "secondary"
              }
              className="h-8 shrink-0 rounded-md px-2.5"
            >
              {inNet == null
                ? "—"
                : inNet
                  ? t("network.ipIn")
                  : t("network.ipOut")}
            </Badge>
          </div>
        </div>
      </div>

      {result.error ? (
        <div className="shrink-0 text-sm text-destructive">{result.error}</div>
      ) : (
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t("network.networkAddr")} value={result.network} />
          <Stat label={t("network.broadcast")} value={result.broadcast} />
          <Stat label={t("network.mask")} value={result.mask} />
          <Stat label={t("network.wildcard")} value={result.wildcard} />
          <Stat label={t("network.firstHost")} value={result.firstHost} />
          <Stat label={t("network.lastHost")} value={result.lastHost} />
          <Stat
            label={t("network.hostCount")}
            value={String(result.hostCount)}
          />
          <Stat label="CIDR" value={result.cidr} />
        </div>
      )}

      <Separator className="shrink-0" />

      {/* —— 画布 + 检查器 —— */}
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border"
      >
        <ResizablePanel
          id="ipcalc-canvas"
          defaultSize={70}
          minSize={45}
          className="min-w-0"
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
              <div className="text-sm font-medium">{t("network.treeView")}</div>
              <p className="text-xs text-muted-foreground">
                {t("network.treeHint")}
              </p>
            </div>
            <div className="min-h-0 flex-1 bg-background">
              {tree ? (
                <SubnetTreeFlow
                  tree={tree}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  —
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel
          id="ipcalc-inspector"
          defaultSize={30}
          minSize={260}
          maxSize={420}
          className="min-w-0 bg-card"
        >
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-5 p-4">
              <div>
                <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t("network.selectedNode")}
                </div>
                {selected ? (
                  <div className="space-y-3 rounded-lg border border-border bg-background p-3">
                    <div className="font-mono text-base font-semibold">
                      {selected.cidr}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      {(
                        [
                          [t("network.networkAddr"), selected.network],
                          [t("network.broadcast"), selected.broadcast],
                          [t("network.firstHost"), selected.firstHost],
                          [t("network.lastHost"), selected.lastHost],
                          [t("network.hostsLabel"), String(selected.hostCount)],
                          ["Prefix", `/${selected.prefix}`],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={String(k)} className="min-w-0">
                          <div className="text-muted-foreground">{k}</div>
                          <div className="truncate font-mono">{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("network.selectNodeHint")}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t("network.splitSubnets")}
                </div>
                <Tabs defaultValue="count" className="gap-3">
                  <TabsList className="grid h-8 w-full grid-cols-2">
                    <TabsTrigger value="count" className="text-xs">
                      {t("network.splitByCount")}
                    </TabsTrigger>
                    <TabsTrigger value="hosts" className="text-xs">
                      {t("network.splitByHosts")}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="count" className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ipcalc-subnet-count">
                        {t("network.subnetCount")}
                      </Label>
                      <Input
                        id="ipcalc-subnet-count"
                        className="h-8"
                        type="number"
                        min={1}
                        value={subnetCount}
                        onChange={(e) =>
                          setSubnetCount(Number(e.target.value) || 1)
                        }
                      />
                    </div>
                    <Button
                      className="h-8 w-full"
                      disabled={!tree || !selectedId}
                      onClick={splitByCount}
                    >
                      <SplitSquareVertical size={14} />
                      {t("network.splitSelected")}
                    </Button>
                  </TabsContent>
                  <TabsContent value="hosts" className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ipcalc-hosts-per">
                        {t("network.hostsPerSubnet")}
                      </Label>
                      <Input
                        id="ipcalc-hosts-per"
                        className="h-8"
                        type="number"
                        min={1}
                        value={hostsPer}
                        onChange={(e) =>
                          setHostsPer(Number(e.target.value) || 1)
                        }
                      />
                    </div>
                    <Button
                      className="h-8 w-full"
                      disabled={!tree || !selectedId}
                      onClick={splitByHosts}
                    >
                      <SplitSquareVertical size={14} />
                      {t("network.splitSelected")}
                    </Button>
                  </TabsContent>
                </Tabs>
                {splitError && (
                  <p className="mt-2 text-xs text-destructive">{splitError}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={resetTree}
                >
                  <RotateCcw size={14} />
                  {t("network.resetTree")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={!selected?.children.length}
                  onClick={clearSelectedChildren}
                >
                  <Eraser size={14} />
                  {t("network.clearChildren")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8">
                      <Copy size={14} />
                      {t("network.copy")}
                      <MoreHorizontal size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={!selected}
                      onSelect={() => {
                        void copySelected();
                      }}
                    >
                      {t("network.copySelected")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!tree}
                      onSelect={() => {
                        void copyTreeCsv();
                      }}
                    >
                      {t("network.copyTree")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={tableRows.length === 0}
                      onSelect={() => {
                        void copyLeafTable();
                      }}
                    >
                      {t("network.copyLeaves")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {tableRows.length > 1 && (
                <div>
                  <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t("network.leafList")}
                  </div>
                  <div className="overflow-hidden rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>CIDR</TableHead>
                          <TableHead className="w-16 text-right">
                            {t("network.hostCount")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tableRows.map((r) => (
                          <TableRow
                            key={r.cidr}
                            className={cn(
                              "cursor-pointer",
                              selectedId === r.cidr && "bg-accent",
                            )}
                            onClick={() => setSelectedId(r.cidr)}
                          >
                            <TableCell className="text-muted-foreground">
                              {r.index}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {r.cidr}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.hostCount}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
