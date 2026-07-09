# CLAUDE.md — Furniture 1000 專案知識

給 Claude Code 與開發者的專案備忘。隨 git 同步，任何電腦 `git pull` 後都能讀到。
**切勿在此檔案寫入任何 token / 密鑰**（此檔案會進 git）。機密放 Windows 環境變數。

---

## 0. Edge Function 有「重複 slug」陷阱：部署前先確認前端呼叫哪個 slug

**大坑**：同一個 function 在 Supabase 存在兩個 slug —— `publish-to-shopify`（舊、沒人用）
與 `supabase-functions-publish-to-shopify`（**前端實際 `supabase.functions.invoke()` 呼叫的**）。
若把新程式碼部署到 `publish-to-shopify`，前端永遠收不到，會出現「改了卻無效、行為跟舊版一樣」。

**規則**：
1. 改 edge function 前，先 `grep -rn "functions.invoke" src/` 找出前端**實際呼叫的 slug**
   （本專案幾乎全部是 `supabase-functions-<name>` 前綴）。
2. 部署時 deploy 到那個 slug：
   `POST /v1/projects/<ref>/functions/deploy?slug=supabase-functions-publish-to-shopify`。
3. 部署後用 `/functions/<slug>/body` 抓回內容 grep 關鍵字，**確認線上版本真的有你的改動**。
4. `supabase/functions/<name>/index.ts` 的資料夾名 ≠ 線上 slug，別被誤導。

前端 invoke 對照（已知）：上傳 Shopify＝`supabase-functions-publish-to-shopify`；
從 Shopify 導入＝`supabase-functions-sync-from-shopify`（寫 `products` 表，**未**處理 metafield）。

## 1. 產品列表查詢：絕不要 `.select('*')`

`products` 表有一個重量級的 `images` JSONB 欄位（base64 data-URL，每筆約 1MB），外加
`image_url_2` / `image_url_3`。對列表/grid 載入用 `.select('*')`，100 列就可能傳輸
~100MB，會拖死查詢、打爆連接池，**這正是 Supabase 間歇性「unhealthy / 產品讀不到」的真正原因**
（logs 其實全是 200，並非 infra 故障）。

**做法**：列表載入一律用 `src/hooks/use-app-store.ts` 的 `PRODUCT_LIST_COLUMNS`
常數（只列輕量欄位），重量級圖片欄位只在開啟單一產品編輯時才懶載入
（見 `PublishCopywritingView` 的 `openProduct`、`usePublishList` 的註解）。
注意：`production_lead_time` 在 `products` 表**不存在**（只有 `production_date`），
列進 PostgREST select 會回 400。

## 2. base64 圖片絕不寫進 DB

base64 不只是不能「讀」，也**不能「寫」**進 DB。所有寫入點都要先上傳 Storage 再存 URL。
共用工具在 `src/lib/imageStorage.ts`：
- `uploadBase64Image`（單張）
- `resolveRowsImagesToStorage`（批量產品列）
- `resolveImagesToStorage`（主圖 + 多張額外圖）

已套用於：ProductDetailModal 貼圖、AIProcessorView Excel 裁圖 upsert、PublishCopywriting。
上傳失敗會回退原字串（非破壞性），上傳到 `product-images` bucket。

**回填現有 base64 舊資料**：呼叫 edge function `migrate-products-images`
（游標式 `after_id`/`next_cursor`，只在上傳成功時才更新該列）處理 `products`；
`ready_to_shopify` 用既有的 `migrate-rts-images`。

## 3. Supabase client timeout 與健康檢查

`src/lib/supabase.ts`：全域 fetch timeout **60s**（`fetchWithTimeout`）、
`checkSupabaseHealth()`（獨立 8s abort、輕量 `count head:true` 探測）、
`waitForSupabaseRecovery()`。`AppShell.tsx` 每 30s 輪詢，**連續兩次失敗**才顯示紅色
「資料庫連接異常」banner。

**注意**：早期版本用 15s timeout，會中止合法的大型批量重載（如「全部退回」重載數百列），
表現為 `AbortError: signal is aborted without reason` 並誤觸發 unhealthy banner。
timeout 要保持寬鬆；健康探測要輕量且獨立。**不要為了「抓 hang」而調低 timeout，
應該去修重型查詢**（見第 1 點）。

## 4. 退回流程是非破壞性的（勿改回 DELETE）

把產品退回「產品文案」**不可** `DELETE` `ready_to_shopify` 列。正確做法（兩處已一致）：
products 的 `copy_done`/`info_done`/`ready_to_publish` 設 false、**保留 `in_shopify_queue=true`**
（產品文案頁靠它過濾，設 false 會讓產品連產品文案也消失），RTS 列的
`furniture_group_checked` 設為 `null`（離開傢俬組檢查 filter=false 與準備上載 filter=true，
但 body_html/images/SEO/sku/price 全部保留）。

實作：`FurnitureGroupCheckView.tsx` 的 `handleRevertAll`；`AppShell.tsx` 的退回 callback。

**Why**：舊版退回會 DELETE RTS 列並設 `in_shopify_queue=false`，造成資料遺失。
2026-06-22 早上 43 件「華座 HUAZUO」因此消失，已還原（資料原在 products 表，無損）。

其餘 3 個 `ready_to_shopify.delete()` 是合理用途、勿誤改：發佈成功後清理
（`use-app-store` ~L1352）、用戶主動批量刪除（`AppShell` `onBatchDeleteProducts`）、
變體合併移除子產品（`ProductTableView`）。

## 5. 直接對 Supabase 跑 SQL（排錯 / 資料修復）

專案 ref：`riaubhtruisbwdlwjzur`。Access token 放在 Windows **User** 環境變數
`SUPABASE_ACCESS_TOKEN`（用 PowerShell `[Environment]::SetEnvironmentVariable(...,'User')`
設定，**不在任何檔案或 git**）。`.mcp.json` 不含 token，靠該環境變數。

Supabase MCP server 在 Claude Code 啟動時讀 token，所以剛設好環境變數後、未重啟前，
MCP 工具可能仍 Unauthorized。立即可用的後備——用 PowerShell 經 Management API 跑 SQL：

```powershell
$tok = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN','User')
$body = @{ query = 'SELECT ...' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/riaubhtruisbwdlwjzur/database/query" -Headers @{ Authorization = "Bearer $tok"; 'Content-Type'='application/json' } -Body $body
```

**坑**：SQL 裡的中文字經 PowerShell 命令列會變成 `%??%`，改用 ASCII 子字串比對
（例如廠家「華座 HUAZUO」用 `ILIKE '%HUAZUO%'`）。console 顯示中文也是亂碼，但 DB 內資料正常。

## 6. PMS Quote tab ↔ 快速報價 handoff

PMS（bwteam-project.com）BWF pitching 詳情的 Quote tab 會列出本專案 `bwf_quote`
（依 `bwf_pitching_id`），並經 SSO 開新報價。

**Schema**：`bwf_quote.bwf_pitching_id uuid`（PMS pitching UUID，無跨庫 FK）+
`idx_bwf_quote_bwf_pitching_id`。存檔時同時寫欄位與
`project_data.formData.pmsPitchingId`；`formData.projectName` = PMS `pitching_code`。

**SSO**：PMS `GET /api/bwf/sso/start?redirect_to=<encoded Furniture path+query>`。
Furniture `/auth/pms/callback` 交換 session 後必須導向 `redirect_to`（保留 query）。
`pms-sso` mint 若收到最終 path（如 `/quote/quick?...`）會包進 callback 的
`?redirect_to=`。

**快速報價 deep link**：`/quote/quick?...` 預填 Step 1（見 `src/lib/pmsQuotePrefill.ts`）。
Query：`pmsPitchingId`, `projectName`, `projectManager`, `clientName`, `clientPhone`,
`clientEmail`, `clientIndustry`, `quotationType`, `company`（可選）。
報價編號仍由 Furniture 自動產生，PMS 不必傳。

**開啟既有報價**：`/quote/<quote_id>`（例 `/quote/Q2026-0708-263`）。
PMS v1 可只做列表；需要時用此 URL 連回編輯。

**PMS 預設值**（edge `supabase-functions-fetch-pms-pitching-quote-defaults`）：
- 客戶名稱 ← `customers.company_name`（via `bwf_pitchings.customer_id`）
- 客戶產業選項 ← `nos_customer_tags` where `collection_id = 4f5de598-…`
- 客戶產業預設 ← `customer_tags` for that customer（同 collection）
- 預算上下限 ← `bwf_pitchings.estimated_income`
