import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { BrowserRouter } from "react-router-dom";

// Light mode is the default — no 'dark' class needed on initial load
document.documentElement.classList.remove('dark');

// ── Stale chunk auto-recovery ──
// After a redeploy, the browser may still hold the old index.html that references
// chunk filenames which no longer exist. Vite emits `vite:preloadError` and the
// dynamic import rejects with "Failed to fetch dynamically imported module".
// Reload the page once (using sessionStorage to avoid an infinite reload loop)
// so the user picks up the new index.html.
const STALE_CHUNK_RELOAD_KEY = '__stale_chunk_reload_ts';
function handleStaleChunk() {
  try {
    const last = Number(sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) || '0');
    if (Date.now() - last < 10_000) return; // already reloaded recently — give up
    sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {}
  window.location.reload();
}
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  handleStaleChunk();
});
window.addEventListener('unhandledrejection', (event) => {
  const msg = String(event?.reason?.message || event?.reason || '');
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module')
  ) {
    event.preventDefault();
    handleStaleChunk();
  }
});

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
