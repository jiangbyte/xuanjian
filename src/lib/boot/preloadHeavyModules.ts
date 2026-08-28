/**
 * @file 重型模块统一预加载
 * @description 首帧绘制后在后台并行预拉 Monaco、xterm、图表、终端壳、AI 等 chunk，
 * 减少首次使用白屏等待。各任务失败互不影响。
 */

let preloadPromise: Promise<void> | null = null;

type PreloadTask = {
  id: string;
  run: () => Promise<void>;
};

const TASKS: PreloadTask[] = [
  {
    id: "monaco",
    run: () =>
      import("@/lib/editor/monacoSetup").then((m) => m.preloadMonacoEditor()),
  },
  {
    id: "xterm",
    run: () =>
      import("@/lib/terminal/xtermSetup").then((m) => m.preloadXterm()),
  },
  {
    id: "charts",
    run: () =>
      import("@/lib/charts/preloadCharts").then((m) =>
        m.preloadChartLibraries(),
      ),
  },
  {
    id: "markdown",
    run: () => import("@/components/MarkdownEditor").then(() => undefined),
  },
  {
    id: "logs-terminal",
    run: () => import("@/features/logs/LogDetailView").then(() => undefined),
  },
  {
    id: "terminal-workspace",
    run: () =>
      import("@/features/terminal/TerminalWorkspace").then(() => undefined),
  },
  {
    id: "terminal-left",
    run: () =>
      import("@/features/terminal/TerminalLeftPanel").then(() => undefined),
  },
  {
    id: "terminal-right",
    run: () =>
      import("@/features/terminal/TerminalRightPanel").then(() => undefined),
  },
  {
    id: "terminal-panes",
    run: () =>
      Promise.all([
        import("@/features/terminal/panes/OverviewPane"),
        import("@/features/terminal/panes/ProcessesPane"),
        import("@/features/terminal/panes/PortsPane"),
        import("@/features/terminal/panes/DockerPane"),
        import("@/features/terminal/panes/HistoryPane"),
        import("@/features/terminal/panes/ScriptsPane"),
        import("@/features/terminal/panes/NotesPane"),
      ]).then(() => undefined),
  },
];

/**
 * 启动预加载所有重型模块；各任务独立失败互不影响，可重复调用。
 */
export function preloadHeavyModules(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  preloadPromise = (async () => {
    const results = await Promise.allSettled(TASKS.map((t) => t.run()));
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        console.error(`[preload] ${TASKS[i].id} failed`, result.reason);
      }
    }
  })().catch((err) => {
    preloadPromise = null;
    throw err;
  });
  return preloadPromise;
}
