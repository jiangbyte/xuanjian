/**
 * @file 应用路由根组件
 * @author Charlie
 * @description 配置 BrowserRouter 与各业务页面路由。
 * 终端页由 AppShell keep-alive 挂载，本处仅切换视图；未知路径重定向到首页。
 * 业务页按路由懒加载，减小打包后首屏解析体积。
 */

import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { SettingsRouteRedirect } from "@/features/settings/SettingsRouteRedirect";

const HostsConsole = lazy(() =>
  import("@/features/hosts/HostsConsole").then((m) => ({
    default: m.HostsConsole,
  })),
);
const NetworkConsole = lazy(() =>
  import("@/features/network/NetworkConsole").then((m) => ({
    default: m.NetworkConsole,
  })),
);
const ScriptsConsole = lazy(() =>
  import("@/features/scripts/ScriptsConsole").then((m) => ({
    default: m.ScriptsConsole,
  })),
);
const NotesConsole = lazy(() =>
  import("@/features/notes/NotesConsole").then((m) => ({
    default: m.NotesConsole,
  })),
);
const LogsConsole = lazy(() =>
  import("@/features/logs/LogsConsole").then((m) => ({
    default: m.LogsConsole,
  })),
);
const LogDetailView = lazy(() =>
  import("@/features/logs/LogDetailView").then((m) => ({
    default: m.LogDetailView,
  })),
);
const AuditConsole = lazy(() =>
  import("@/features/audit/AuditConsole").then((m) => ({
    default: m.AuditConsole,
  })),
);
const BatchConsole = lazy(() =>
  import("@/features/automation/BatchConsole").then((m) => ({
    default: m.BatchConsole,
  })),
);
const FleetDashboard = lazy(() =>
  import("@/features/fleet/FleetDashboard").then((m) => ({
    default: m.FleetDashboard,
  })),
);

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      …
    </div>
  );
}

/**
 * 应用根组件：挂载路由树，所有页面落在 AppShell 布局内。
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            index
            element={
              <Suspense fallback={<RouteFallback />}>
                <HostsConsole />
              </Suspense>
            }
          />
          <Route
            path="network"
            element={
              <Suspense fallback={<RouteFallback />}>
                <NetworkConsole />
              </Suspense>
            }
          />
          <Route
            path="scripts"
            element={
              <Suspense fallback={<RouteFallback />}>
                <ScriptsConsole />
              </Suspense>
            }
          />          <Route
            path="automation"
            element={
              <Suspense fallback={<RouteFallback />}>
                <BatchConsole />
              </Suspense>
            }
          />
          <Route
            path="fleet"
            element={
              <Suspense fallback={<RouteFallback />}>
                <FleetDashboard />
              </Suspense>
            }
          />
          <Route
            path="notes"
            element={
              <Suspense fallback={<RouteFallback />}>
                <NotesConsole />
              </Suspense>
            }
          />
          <Route
            path="logs"
            element={
              <Suspense fallback={<RouteFallback />}>
                <LogsConsole />
              </Suspense>
            }
          />
          <Route
            path="logs/:id"
            element={
              <Suspense fallback={<RouteFallback />}>
                <LogDetailView />
              </Suspense>
            }
          />
          <Route
            path="audit"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AuditConsole />
              </Suspense>
            }
          />
          <Route path="settings" element={<SettingsRouteRedirect />} />
          {/* 终端 UI 在 AppShell 中 keep-alive；此路由仅用于切换视图 */}
          <Route path="terminal" element={null} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
