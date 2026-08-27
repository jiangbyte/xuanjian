/**
 * @file 图表库预加载
 * @description 预拉取 ECharts、Recharts、XYFlow 等重型图表依赖及常用面板模块。
 */

let preloadPromise: Promise<void> | null = null;

/** 预加载图表相关 vendor 与常用消费模块 */
export function preloadChartLibraries(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  preloadPromise = Promise.all([
    import("echarts"),
    import("echarts-for-react"),
    import("recharts"),
    import("@xyflow/react"),
    import("@/features/network/panels/SpeedCharts"),
    import("@/features/network/panels/SpeedTestPanel"),
    import("@/features/network/panels/TrafficMonitorPage"),
    import("@/features/network/panels/connectivity/PingViz"),
    import("@/features/terminal/panes/OverviewPane"),
  ])
    .then(() => undefined)
    .catch((err) => {
      preloadPromise = null;
      console.error("[charts] preload failed", err);
      throw err;
    });
  return preloadPromise;
}
