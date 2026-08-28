/**
 * @file 应用路由根组件
 * @author Charlie
 * @description 桌面 AppShell / 移动 MobileShell 按平台切换。
 * 终端页由桌面壳 keep-alive；移动端为独立全屏页。未知路径重定向首页。
 */

import { lazy, Suspense, useMemo, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { MobileShell } from "@/features/mobile/MobileShell";
import { SettingsRouteRedirect } from "@/features/settings/SettingsRouteRedirect";
import { shouldUseMobileUi } from "@/lib/platform/mobile";

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
const DockerConsole = lazy(() =>
  import("@/features/docker/DockerConsole").then((m) => ({
    default: m.DockerConsole,
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

const MobileHostsPage = lazy(() =>
  import("@/features/mobile/MobileHostsPage").then((m) => ({
    default: m.MobileHostsPage,
  })),
);
const MobileTerminalPage = lazy(() =>
  import("@/features/mobile/MobileTerminalPage").then((m) => ({
    default: m.MobileTerminalPage,
  })),
);
const MobileFilesPage = lazy(() =>
  import("@/features/mobile/MobileFilesPage").then((m) => ({
    default: m.MobileFilesPage,
  })),
);
const MobileFileEditorPage = lazy(() =>
  import("@/features/mobile/MobileFilesPage").then((m) => ({
    default: m.MobileFileEditorPage,
  })),
);
const MobileNotesPage = lazy(() =>
  import("@/features/mobile/MobileNotesPage").then((m) => ({
    default: m.MobileNotesPage,
  })),
);
const MobileNoteEditorPage = lazy(() =>
  import("@/features/mobile/MobileNotesPage").then((m) => ({
    default: m.MobileNoteEditorPage,
  })),
);
const MobileMorePage = lazy(() =>
  import("@/features/mobile/MobileMorePage").then((m) => ({
    default: m.MobileMorePage,
  })),
);

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      …
    </div>
  );
}

function page(el: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{el}</Suspense>;
}

function DesktopRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={page(<HostsConsole />)} />
        <Route path="network" element={page(<NetworkConsole />)} />
        <Route path="docker" element={page(<DockerConsole />)} />
        <Route path="scripts" element={page(<ScriptsConsole />)} />
        <Route path="automation" element={page(<BatchConsole />)} />
        <Route path="fleet" element={page(<FleetDashboard />)} />
        <Route path="notes" element={page(<NotesConsole />)} />
        <Route path="logs" element={page(<LogsConsole />)} />
        <Route path="logs/:id" element={page(<LogDetailView />)} />
        <Route path="audit" element={page(<AuditConsole />)} />
        <Route path="settings" element={<SettingsRouteRedirect />} />
        <Route path="terminal" element={null} />
        <Route path="m/*" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function MobileRoutes() {
  return (
    <Routes>
      <Route element={<MobileShell />}>
        <Route index element={<Navigate to="/m" replace />} />
        <Route path="m" element={page(<MobileHostsPage />)} />
        <Route path="m/terminal" element={page(<MobileTerminalPage />)} />
        <Route path="m/files" element={page(<MobileFilesPage />)} />
        <Route path="m/files/edit" element={page(<MobileFileEditorPage />)} />
        <Route path="m/notes" element={page(<MobileNotesPage />)} />
        <Route path="m/notes/:id" element={page(<MobileNoteEditorPage />)} />
        <Route path="m/more" element={page(<MobileMorePage />)} />
        <Route path="*" element={<Navigate to="/m" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * 应用根组件：移动端伴侣壳 / 桌面运维壳。
 */
export default function App() {
  const mobile = useMemo(() => shouldUseMobileUi(), []);
  return (
    <BrowserRouter>
      {mobile ? <MobileRoutes /> : <DesktopRoutes />}
    </BrowserRouter>
  );
}
