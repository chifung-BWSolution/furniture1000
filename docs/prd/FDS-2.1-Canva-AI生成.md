# FDS 2.1 — Canva AI 生成簡報

建立客戶簡報只走 Canva Design Generation（preview）：`POST /v1/generations`。
V2.2.1 圖片流程以 `FDS-V2.2.1.md` 的 2026-10-28 修訂為準：文字大綱交給生成接口，指定圖片另上傳素材庫，由使用者依對應清單手動放圖；自動放入投影片不在本版範圍。本輪相關程式修改仍需部署與真實驗收。
不使用品牌模板，不使用 Autofill，也不再讀 `CANVA_BRAND_TEMPLATE_ID`。

## 帳戶

- 使用 **`chifung.login`** Connect 整合。
- 帳戶必須有 Canva AI 與 Magic Design。建立前呼叫 `GET /v1/users/me/capabilities`（scope `profile:read`），回應的 `capabilities` 必須包含 `design_generation`。
- 沒有該能力時，session 標成失敗，並回傳中文說明，不會呼叫 `/generations`。
- 生成會消耗 Canva AI 點數。HTTP 429 且 `code` 為 `credit_quota_exceeded` 時，介面顯示「Canva AI 點數已用完」。

## OAuth scopes

前端 `CANVA_SCOPES`（`src/lib/canvaPresentation.ts`）：

| Scope | 用途 |
|--------|------|
| `design:content:write` | 建立 AI 設計 |
| `design:content:read` | 匯出 PPTX／PDF |
| `design:meta:read` | 設計 metadata |
| `asset:read` / `asset:write` | 保留既有素材授權，這次生成不用上傳圖片 |
| `profile:read` | 讀 capabilities 與帳戶名稱 |

已從授權字串移除 `brandtemplate:meta:read` 與 `brandtemplate:content:read`。
舊 token 仍保留當初核發的 scope，所以**只因為拿掉 brandtemplate 不必重新連接**。
若已存 token 缺少 `profile:read` 或 `design:content:write`，必須解除連接後再連一次。

## Edge secrets

| Secret | 必填 | 說明 |
|--------|------|------|
| `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` | 是 | Connect 整合 |
| `CANVA_BASE_URL` | 否 | 預設 `https://api.canva.com/rest/v1` |

Redirect URI：`<域名>/fds/pm/presentation`。
Slug：`supabase-functions-generate-canva-presentation`（function 自己驗登入，`verify_jwt=false`）。

## 建立流程

1. 前端儲存草稿（標題、客戶、專案、目的、語言、風格、頁數、原文、確認大綱、產品 id）。
2. `create_native` 用真實產品欄位讀名稱、規格與價錢：`sale_price`／`price`、`dimension_l_mm`／`dimension_w_mm`／`dimension_h_mm`、`factories_display_name`。不選 `images`。查詢失敗會寫入 log 與 `populate_report.product_load_error`，仍可用大綱生成。
3. Brief 最長 5000 字，先保留標題與產品，再截斷大綱與原文。
4. `design_type` 為 `{ "type": "preset", "name": "presentation" }`。
5. Outline 的 `sections` 來自確認大綱（`#` 標題或 `1.`／`1、`／`1)` 開新頁，`-`／`*`／`•` 為 points）。每一件已選產品再各成一頁，最多 100 段。
6. 輪詢 `GET /v1/generations/{jobId}` 直到 `success` 或 `failed`。
7. 成功時寫入 `canva_design_id`、`edit_url`、`view_url`、`thumbnail_url`、`generation_mode=ai`。縮圖網址約 15 分鐘失效。編輯連結約 30 天。
8. Canva 錯誤原文（截斷）寫入 `canva_design_sessions.error`，並 `console.error`。

匯出 PPTX／PDF、版本鏈與草稿沿用既有 session，不經 Autofill。

## Schema

`20261022010000_fds21_canva_ai_generation.sql`：

- `generation_mode` 允許 `ai`（仍保留舊值 `blank`／`autofill`，避免歷史列無法讀取）。
- 新增 `thumbnail_url`。
- `fds_list_canva_design_sessions` 一併回傳縮圖。

此 API 為 Canva preview，欄位以當時文件為準。
