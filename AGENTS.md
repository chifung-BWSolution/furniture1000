# FDS Agent Instructions

開發功能時先查 PMS 與 Furniture 1000（FDS）有沒有相關功能、資料或接口，並考慮與 PMS 的兼容。現有 Table、Column、Function、RLS、Edge Function 或頁面流程可以對照實現時，沿用它們，不要為同一件事再新增接口。只有兩邊都沒有可對應的能力時，才在 FDS 追加，而且不改寫 PMS 既有契約。

其餘產品、資料與部署約束以 `CLAUDE.md` 為準。改 Edge Function 前先對照前端實際呼叫的 slug，部署到那個 slug。

UI 一律用 `src/components/ui` 的共用元件，不要手寫：對話框用 `Modal`（整頁面用 `variant="fullscreen"`）、開關用 `Switch`、下拉用 `Select`、勾選用 `Checkbox`、確認用 `confirm()`（`@/components/ui/confirm-dialog`，由 `AppShell` 的 `ConfirmProvider` 掛載），不要用 `window.confirm/alert/prompt`。`npm run audit:ui` 會擋下手寫的 dialog shell 與 `role="switch"`，並列出仍未遷移的原生 select/checkbox。
