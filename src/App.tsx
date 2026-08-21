import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { HostsConsole } from "./features/hosts/HostsConsole";
import { ScriptsConsole } from "./features/scripts/ScriptsConsole";
import { NotesConsole } from "./features/notes/NotesConsole";
import { LogsConsole } from "./features/logs/LogsConsole";
import { LogDetailView } from "./features/logs/LogDetailView";
import { NetworkConsole } from "./features/network/NetworkConsole";

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
          {/* Terminal UI is keep-alive in AppShell; route only switches view. */}
          <Route path="terminal" element={null} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
