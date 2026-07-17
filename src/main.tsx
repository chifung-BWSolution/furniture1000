import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { BrowserRouter } from "react-router-dom";
import { startAppUpdateGuard } from "@/lib/appUpdateGuard";

// Light mode is the default — no 'dark' class needed on initial load
document.documentElement.classList.remove('dark');

// After redeploy, stale JS chunks used to force window.location.reload().
// That wiped in-memory quote edits. We now show a banner and let the user
// reload after drafts are flushed (see appUpdateGuard + AppUpdateBanner).
startAppUpdateGuard();

// ── Global error suppression (reinforcement — primary handler is in index.html) ──
// Cross-origin "Script error." messages (empty filename, lineno=0) come from
// browser extensions and third-party scripts. They carry zero useful information.
if (!(window as any).__mainErrorSuppressed) {
  (window as any).__mainErrorSuppressed = true;

  const _prevOnerror = window.onerror;
  window.onerror = (msg, src, line, _col, _err) => {
    const m = typeof msg === "string" ? msg : "";
    const s = typeof src === "string" ? src : "";
    if (!s || s === "" || m === "Script error." || m === "" || line === 0) return true;
    if (_prevOnerror) return (_prevOnerror as any)(msg, src, line, _col, _err);
    return false;
  };

  window.addEventListener("error", (event) => {
    const e = event as ErrorEvent;
    const src = e.filename || "";
    const msg = e.message || "";
    if (!src || src === "" || msg === "Script error." || msg === "" || e.lineno === 0 || msg.includes("ResizeObserver")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const msg = reason?.message || String(reason || "");
    if (
      !msg ||
      msg === "Script error." ||
      (reason && typeof reason === "object" && !reason.stack && !reason.message)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  }, true);
}

const basename = import.meta.env.BASE_URL;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
