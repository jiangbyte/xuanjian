import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ContextMenuProvider } from "./components/ContextMenu";
import { DialogProvider } from "./components/Dialog";
import "./i18n";
import "./styles/index.css";

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

/** Block DevTools shortcuts only — do NOT block Ctrl+Shift+C (terminal copy). */
document.addEventListener(
  "keydown",
  (e) => {
    const key = e.key.toLowerCase();
    if (e.key === "F12") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Inspect / console — not Ctrl+Shift+C (terminal copy) or Ctrl+Shift+V (paste)
    if (e.ctrlKey && e.shiftKey && (key === "i" || key === "j")) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && key === "u") {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DialogProvider>
      <ContextMenuProvider>
        <App />
      </ContextMenuProvider>
    </DialogProvider>
  </React.StrictMode>,
);
