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

### Cursor（本機）Supabase MCP

專案已含 `.cursor/mcp.json`（OAuth，不含 token）。本機啟用步驟：

1. 用 Cursor 開啟此 repo（會讀取 `.cursor/mcp.json`）
2. **Settings → Cursor Settings → Tools & MCP**
3. 找到 **supabase**，點 **Connect** 完成瀏覽器 OAuth 登入
4. 狀態變 **Connected** 後，重開 Chat 即可用 `execute_sql` 等工具

若 OAuth 失敗，可改用 PAT（需先設好 `SUPABASE_ACCESS_TOKEN`）——參考
`.cursor/mcp.json.example` 的 `supabase-pat-http` 或 `supabase-pat-stdio`，
覆寫 `.cursor/mcp.json` 後**完全重啟 Cursor**。

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

**Schema（報價識別）**：
- `bwf_quote.quote_id`＝**唯一**報價單號／版本鏈鍵／深連結（值＝PMS `pitching_code`，如 `BWF-…`）
- 已廢棄：`QYYYY-MMDD-NNN`、`bwf_quote.pitching_code`、`bwf_quote.pitching_name`、`formData.pitchingCode`／`pitchingName`（見 `20260717_*` migrations）
- **提案顯示名稱**（報價一覽）＝每次從 PMS live join（`bwf_pitching_id` → `bwf_pitchings.pitching_name`），**不**存 Furniture DB
- PDF「報價單號」＝`quote_id`（經 `quoteMeta.quoteNumber` 傳入）
- URL query `projectName` 仍＝PMS **code**（handoff 相容，寫入前變成 `quote_id`）
- **複製報價單**仍掛在同一 `quote_id` 版本鏈（新 `vN`）
- Wizard 記憶體欄位 `formData.quoteId` 僅 UI 暫存（PMS code）；submit 時寫入 `bwf_quote.quote_id`；**不**寫入 `project_data` JSON

**Schema（列項目）**：明細在 `bwf_quote_item`（`quote_uuid` → `bwf_quote.id` ON DELETE CASCADE）。
`project_data` **不再**存 `items`。寫入用 RPC `save_bwf_quote_items`（見 `src/lib/bwfQuoteItems.ts`）。
圖片欄位應為 Storage HTTP URL（`resolveItemImagesToStorage`／`quoteImageStorage`）。
DB 觸發器 `trg_bwf_quote_extract_embedded_items`：若舊前端仍把 `items` 寫進 JSON，會自動抽到
`bwf_quote_item` 並從 `project_data` 刪除（僅在該 quote 尚無 item 列時 seed）。

**列表查詢**：`QuotationListView` 禁止 `.select('*')`；只選 header 欄位
（含 `quote_id`／`bwf_pitching_id`），再 batch fetch PMS pitching 補標題；不要帶 item 圖片。

存檔時同時寫 `bwf_pitching_id`／`bwf_project_id` 與 `formData.pmsPitchingId`／`pmsProjectId`。

**SSO**：PMS `GET /api/bwf/sso/start?redirect_to=<encoded Furniture path+query>`。
Furniture `/auth/pms/callback` 交換 session 後必須導向 `redirect_to`（保留 query）。
`pms-sso` mint 若收到最終 path（如 `/quote/quick?...`）會包進 callback 的
`?redirect_to=`。

**快速報價 deep link**：`/quote/quick?...` 預填 Step 1（見 `src/lib/pmsQuotePrefill.ts`）。
Query：`pmsPitchingId`（=`bwf_pitchings.id`）與／或 `pmsProjectId`
（=`bwf_projects.id`，**不是** pitching alias）、`projectName`（＝code）、
`projectManager`, `clientName`, `clientPhone`, `clientEmail`,
`clientIndustry`, `quotationType`, `company`（可選）。

**ID 解析**（edge `fetch-pms-pitching-quote-defaults`）：
- 傳 `project_id` → 必有關聯 pitching → 回傳兩者，存 `bwf_project_id` + `bwf_pitching_id`
- 傳 `pitching_id` → 若有關聯 `bwf_projects` 也回傳 `project_id`；否則只存 pitching
- 回傳 `pitching_code`、`pitching_name`、客戶／產業／預算

**站內選擇 Pitching**（無 PMS SSO 時）：快速報價先顯示極簡搜尋頁
`PmsPitchingGate`（唯一建立入口）→ edge `supabase-functions-fetch-pms-pitchings`
搜尋 `bwf_pitchings`；選定後才進入表單 wizard，並用既有
`fetch-pms-pitching-quote-defaults` 帶入客戶／產業／預算（並嘗試補 `project_id`）。
PMS deep link（`pmsProjectId`／`pmsPitchingId`）會跳過搜尋頁，直接進入預填表單。

**開啟既有報價**：`/quote/<quote_id>`（例 `/quote/BWF-FD26-001`）。
PMS v1 可只做列表；需要時用此 URL 連回編輯。

**PMS 預設值**（edge `supabase-functions-fetch-pms-pitching-quote-defaults`）：
- 公司名稱 ← `customers.company_name` / `display_name`（via `bwf_pitchings.customer_id`）→ `formData.clientName` / `clientInfo.name`
- 客戶名稱（聯絡人）← `customers.customer_name` → `formData.clientContactName` / `clientInfo.contactName`
- 客戶電話 ← `customers.phone_display`（fallback `phone_number_a` → `phone_number_b`）
- 客戶電郵 ← `customers.email`
- 客戶產業選項 ← `nos_customer_tags` where `collection_id = 4f5de598-…`
- 客戶產業預設 ← `customer_tags` for that customer（同 collection）
- 預算上下限 ← `bwf_pitchings.estimated_income`
- `pitching_name` ← `bwf_pitchings.pitching_name`
