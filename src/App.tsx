/**
 * @file 应用路由根组件
 * @author Charlie
 * @description 配置 BrowserRouter 与各业务页面路由。
 * 终端页由 AppShell keep-alive 挂载，本处仅切换视图；未知路径重定向到首页。
 */

import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { HostsConsole } from "@/features/hosts/HostsConsole";
import { ScriptsConsole } from "@/features/scripts/ScriptsConsole";
import { NotesConsole } from "@/features/notes/NotesConsole";
import { LogsConsole } from "@/features/logs/LogsConsole";
import { LogDetailView } from "@/features/logs/LogDetailView";
import { NetworkConsole } from "@/features/network/NetworkConsole";

/**
 * 应用根组件：挂载路由树，所有页面落在 AppShell 布局内。
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HostsConsole />} />
          <Route path="network" element={<NetworkConsole />} />
          <Route path="scripts" element={<ScriptsConsole />} />
          <Route path="notes" element={<NotesConsole />} />
          <Route path="logs" element={<LogsConsole />} />
          <Route path="logs/:id" element={<LogDetailView />} />
          {/* 终端 UI 在 AppShell 中 keep-alive；此路由仅用于切换视图 */}
          <Route path="terminal" element={null} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
