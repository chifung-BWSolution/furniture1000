# CLAUDE.md — Furniture 1000 專案知識

給 Claude Code 與開發者的專案備忘。隨 git 同步，任何電腦 `git pull` 後都能讀到。
**切勿在此檔案寫入任何 token / 密鑰**（此檔案會進 git）。機密放 Windows 環境變數。

開發功能時先查 PMS 與 Furniture 1000（FDS）有沒有相關功能、資料或接口，並考慮與 PMS 的兼容。現有 Table、Column、Function、RLS、Edge Function 或頁面流程可以對照實現時，沿用它們，不要為同一件事再新增接口。只有兩邊都沒有可對應的能力時，才在 FDS 追加，而且不改寫 PMS 既有契約。同一條也寫在 `AGENTS.md`。

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
`?redirect_to=`。登入頁「使用 PMS 登入」會自動帶上目前 path（含 `/design-projects/:id`）。

**登入**：main（正式站）才用 PMS SSO。develop 的 preview 只顯示一鍵登入
（`VITE_LOGIN_METHOD=quick`，Vite 依 git 分支寫入），不呼叫 SSO。
一鍵登入帳號由 `VITE_ENABLE_QUICK_LOGIN`、`VITE_QUICK_LOGIN_EMAIL`、
`VITE_QUICK_LOGIN_PASSWORD` 提供，同樣只在 develop 建置時寫進前端。

**設計專案 deep link**：`/design-projects/:projectId`（見 `src/lib/designProjectRoutes.ts`）。
切換專案會同步 URL；可貼上連結 → 登入後直接開啟該專案。

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

## 7. 環境變數 / Secrets：三個獨立儲存位置 + 跨 repo 命名規範

### 7.1 三個位置，互不影響（最常搞混的地方）

| 儲存位置 | 影響範圍 | 設定入口 |
|---|---|---|
| **Cursor Cloud Agent Secrets** | 只有 cloud agent VM 的環境變數 | Cursor Dashboard → Cloud Agents → Secrets |
| **Supabase Edge Function Secrets** | 只有已部署的 edge function（每個 project 獨立） | Supabase Dashboard → Edge Functions → Secrets |
| **Vercel Environment Variables** | 只有正式站 build / runtime | Vercel → Project → Settings → Environment Variables |

在 Cursor 刪掉一個 secret **不會**影響 edge function；在 Supabase 改 secret 也**不會**讓 cloud agent 或
正式站拿到新值。三邊要各自更新。本機開發則讀 `.env.local`（見 `.env.example`）。

### 7.2 project ref ↔ 專案名稱（不要再猜）

| ref | 專案名稱 | 對應 repo |
|---|---|---|
| `riaubhtruisbwdlwjzur` | Furniture 1000 | `furniture1000`（本 repo） |
| `kqwktnplkqucsbasyfjl` | PMS v3 [Tempo Next.JS] | `PMS3.0` |
| `kwcevjcmdjadhrygjyfp` | MPS - Marketing Project System | `MPS` |
| `gkqctvtteafjprkudgsb` | breauty100 new | `beauty100-Next.js` |
| `zwhbfphavcxncfmcrwrr` | OTC2 | （MPS 的 `sync-otc2-staff` 讀） |

**兩個致命的命名陷阱**：
- `MASTER_*` / `FACTORY_*` / `PMS_*` 指的都是 **PMS v3**（`kqwktnplkqucsbasyfjl`），**不是** Furniture。
- `BWF_*` 指的是 **Furniture 1000**（`riaubhtruisbwdlwjzur`），**不是** PMS。
 （`bwf_quote` 表在 Furniture DB、`bwf_pitchings` 表在 PMS DB，所以「BWF」兩邊都出現過，看變數前綴不看字面。）

### 7.3 同一把 key 的多個別名（alias，不要再增加）

**Furniture service_role**（`riaubhtruisbwdlwjzur`）——三個名字同一個值：
`SUPABASE_SERVICE_ROLE_KEY`（canonical）、`FURNITURE_SUPABASE_SERVICE_ROLE_KEY`、`BWF_SUPABASE_SERVICE_KEY`。
repo 內所有讀 alias 的地方都有 `|| SUPABASE_SERVICE_ROLE_KEY` fallback。

**PMS v3 service_role** 必須跟實際連到的 PMS project 是同一把 key：
`FACTORY_SERVICE_ROLE_KEY`（**edge function 的 canonical**）、
`MASTER_SERVICE_ROLE_KEY`、
`PMS_SUPABASE_SERVICE_ROLE_KEY`。
`PMS_V3_SERVICE_ROLE_KEY` 只是最後候補。
Edge function 用 `supabase/functions/_shared/pmsProject.ts` 選 URL，不再寫死正式庫：
明確的 `MASTER_SUPABASE_URL`／`PMS_SUPABASE_URL`／`FACTORY_SUPABASE_URL` 優先；
否則正式 Furniture（`riaubhtruisbwdlwjzur`）連 PMS 正式庫 `kqwktnplkqucsbasyfjl`，
FDS2.0（`omxizeukbcqzsnjsuwod`）與本機 develop 連 PMS 分支 QMS_dev `alrbbyqkeobmvvvscpma`。
正式庫的 key 不會拿去打 QMS_dev。
→ Furniture 的 **edge secrets 必須同時保留 `FACTORY_SERVICE_ROLE_KEY` 與 `MASTER_SERVICE_ROLE_KEY`**，而且兩個都要是那個環境該連的 PMS project。
→ Cursor cloud agent 只需要 `MASTER_SERVICE_ROLE_KEY` 一個（腳本都有 fallback）。

`PMS_V3_URL` 沒有被讀取，可以從 edge secrets 刪除。`PMS_V3_SERVICE_ROLE_KEY` 只在前三個 key 都對不上目標 project 時才會用到。

### 7.4 各 repo 實際讀取的變數名（改 secret 前先對照）

| repo | 框架 | 自己的 project | 讀取的變數名 |
|---|---|---|---|
| `furniture1000` | Vite | Furniture 1000 | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PMS_SSO_START_URL`, `VITE_MASTER_SUPABASE_ANON_KEY`(PMS anon), `SUPABASE_SERVICE_ROLE_KEY`, `MASTER_SERVICE_ROLE_KEY`(PMS) |
| `MPS` | **Vite** | MPS | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `BW-Quote-Master` | Vite | ？ | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `beauty100-Next.js` | Next.js | breauty100 | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, 以及跨專案 `MPS_SUPABASE_URL` + `MPS_SUPABASE_SERVICE_KEY`（`/api/kol-apply`） |
| `PMS3.0` | Next.js | PMS v3 | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, 以及跨專案 `BWF_SUPABASE_URL` + `BWF_SUPABASE_SERVICE_KEY`（打 Furniture 的 `pms-sso`） |

**MPS 是 Vite 不是 Next.js**：它讀 `VITE_SUPABASE_*`。用 `MPS_URL` / `MPS_ANON` 這種名字設 secret，
MPS 的程式完全讀不到，agent 會回報 `.env` 有問題。

### 7.5 命名規範（新增 secret 前先看這裡）

1. **「自己 project」的變數**用框架原生名（Vite 用 `VITE_*`、Next.js 用 `NEXT_PUBLIC_*`），
 且**必須 repo-scoped，永遠不要設成 All Repositories**——三個 Vite repo 都叫 `VITE_SUPABASE_URL`
 但指向三個不同 project，設成全域一定有 repo 拿到錯的資料庫。
2. **「別的 project」的變數**一律加專案前綴：`<PROJECT>_SUPABASE_URL` / `_SUPABASE_ANON_KEY` /
 `_SUPABASE_SERVICE_KEY`，並只 scope 給真正需要的 repo。
3. **type 選擇**：service_role / PAT / shared secret 用 **Runtime Secret**（會被遮罩成 `[REDACTED]`）；
 anon key 與 URL 用 **Environment Variable**（本來就是公開值，agent 需要看得到）。
4. 一個 project + 一種角色**只留一個名字**，需要 alias 時在程式碼裡做 fallback，不要在 dashboard 複製多份。
5. 只有 `SUPABASE_ACCESS_TOKEN` 適合設成 All Repositories（同一個 Supabase 帳號的 Management API PAT）。
6. Cursor 的 **user secrets 在 Build / `install` 階段拿不到**，只有 agent 啟動（`start`）後才有；
 需要在 install 階段用到的憑證要設成 team 或 environment secret。

### 7.6 改完 secret 一定要驗證

```bash
node scripts/check-supabase-env.mjs          # 只解析 JWT 的 ref/role
node scripts/check-supabase-env.mjs --live   # 額外對各 project 發一次請求
```

會逐項印出每個變數實際指向哪個 project，貼錯 key（例如把 PMS 的 anon key 貼進
`VITE_SUPABASE_ANON_KEY`）會直接 FAIL。exit code 非 0 代表有問題。

**為什麼一定要跑**：Vite 在 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 完全沒設定時
**build 仍然會成功**，只是產出一個連不上 DB 的 bundle——沒有任何 build error 提醒你。
這就是 secret 名字設錯時，問題會拖到 runtime 才爆的原因。

## 8. FDS 2.1 供應商文件與背景任務

- 原始 PDF 在**私有** bucket `supplier-documents`，路徑＝`<factory_id 或名稱>/<sha256>.pdf`（同檔重傳自然去重）。
  下載只用 5 分鐘簽名 URL（`src/lib/supplierDocuments.ts`）。
  **簽名 URL 指向整份檔案**（含全部頁面與供應商成本），所以原文只限 `admin`／`uploader`
  （角色表 §13：pm／designer ❌）。`fds_source_page_context` 與 edge `source-page` 兩層都要擋；
  搜索／詳情回傳 `can_open_source`，前端據此把「開原文」改成純文字。
  要給 pm／designer 看，必須另做**已遮蔽成本的單頁**，不能直接簽原始 PDF。
- `supplier_documents`／`processing_jobs` **不是 allow-all**：只有 `bwf_has_role(array['admin','uploader'])`
  讀得到，前端寫入一律走 `fds_*` RPC。新的商業資料表照這個模式做，不要再加 `USING (true)`。
- 任務狀態只經 `fds_processing_jobs_claim` → `fds_processing_job_heartbeat` → `_complete`／`_fail` 流轉；
  Edge worker 與之後的 Python Worker 共用這套 RPC，不要直接改 `status`。
  **cron 要連 stale running 一起喚醒**（heartbeat 超過 10 分鐘，不看 attempts）：
  否則最後一次被 CPU／執行時間限制終止時，沒有人再呼叫 claim，文件會永久卡在 parsing。
- Worker slug＝`supabase-functions-process-jobs`。pg_cron `fds-process-jobs` 用 vault 的 `fds_worker_secret`
  （`x-worker-secret` header）授權；vault 裡的 `service_role_key` 只有 26 字元，不像有效的 service role key，別拿它做授權。
- Storage 專案上限已調到 200MB；Edge worker 只處理 ≤60MB 的 PDF。
- Edge 每次請求 CPU 很短：`parse_pdf` 每次只做一批（8 頁抽字／20 頁分類），用
  `fds_processing_job_checkpoint` 存斷點後自己觸發下一批。加新的重型步驟也要照這個分批模式，不要一次跑完整份 PDF。
- 掃描頁 OCR 用 Grok（edge secret `XAI_API_KEY`，模型 `XAI_OCR_MODEL`）；頁面分類與分段用現有 `GEMINI_API_KEY`。
- `parse_pdf` 第三階段 `structure`：每次一個單元（同一分段最多 5 頁）交 Gemini（`responseSchema`）輸出產品 →
  `extraction_items.raw_json`（AI 原值，永不改寫）。人工修正只寫 `corrected_json`（只存與 AI 不同的欄位），
  經 `fds_extraction_item_review`／`_batch` RPC。重新解析只刪 `pending` 項，已審核的保留且同型號不再重複產生。
- 抽出的產品圖存 `product-images/supplier-extracts/<document_id>/<sha256>.jpg`，登記在 `supplier_document_images`
  （同文件同 hash 只存一次）；同一張圖出現 ≥3 頁視為 logo，由 `fds_extraction_items_finalize` 從待審項目移除。
  **出現頁數要用「文件／圖片／頁碼」唯一關聯計數**：`supplier_document_images.seen_pages`
  存出現過的頁碼（唯一集合），`page_occurrences = cardinality(seen_pages)`，
  寫入只經 `fds_supplier_document_image_record`（重跑同一 unit 不會再加一次，重試冪等）。
- Canva（F-AI-009）：edge slug `supabase-functions-generate-canva-presentation`。
  建立簡報＝Canva AI `POST /v1/generations`（preview），先查 `GET /v1/users/me/capabilities` 的 `design_generation`。
  不用品牌模板、不用 Autofill、不需要 `CANVA_BRAND_TEMPLATE_ID`。
  session 表 `canva_design_sessions`（`generation_mode=ai`、`thumbnail_url` 約 15 分鐘過期）；流程見 `docs/prd/FDS-2.1-Canva-AI生成.md`。
  secrets＝`CANVA_CLIENT_ID`／`CANVA_CLIENT_SECRET`（`CANVA_BASE_URL` 可選）；redirect URI＝`<域名>/fds/pm/presentation`。
- 本機 dev／develop 連的是 Supabase 分支 FDS2.0（`omxizeukbcqzsnjsuwod`）。FDS 2.1 的 migration 與 `process-jobs`
  要**兩邊都部署**（正式 `riaubhtruisbwdlwjzur` ＋ 分支）；套到分支時把 cron 裡的 worker URL 換成分支 ref。
  分支的一鍵登入帳號 `fds-develop-preview@…` 在分支 `platform_user_profiles` 設為 admin。
- SKP（設計師 SU）：不用 OpenSKP。SketchUp C SDK 只跑 Windows／macOS，所以 SKP 由 Windows 機器上的
  `workers/skp-writer`（`skp_writer.exe` ＋ `worker.mjs`）領 `processing_jobs` 的 `generate_skp` 寫出，Edge 不處理。
  C SDK 目前不公開下載（要申請）；沒有 `skp_writer.exe` 時 worker 改用本機已授權的 SketchUp
  （`SketchUp.exe -RubyStartup skp_build.rb <seed.skp>`，Ruby API 建組件、存檔、自動關閉）。
  第一次會出歡迎視窗，要有人選一次模板，之後開 `%LOCALAPPDATA%\fds-skp-writer\seed.skp` 就不用人手。
  我們的 +y 是正面，SketchUp 前視圖看 -y，兩個寫檔程式都把整件轉 180°。
 模型檔在私有 bucket `product-models`（`uploaded/` 給 admin／uploader，`generated/` 只給 service role），
 登記在 `product_models`，只經 `fds_product_model*`／`fds_request_skp`／`fds_skp_status` RPC。
- 正式價錢在 `supplier_prices`、來源在 `product_source_refs`（產品／報價／來源分離，產品身份＝型號＋供應商）；
 只有審核通過的項目才可寫入（BR-02）。匯入只經 `fds_import_extracted_products`：同廠家同型號沿用既有產品且不改它，
 只追加報價；不寫 `products.cost_price`（報價可能是外幣）。
- 產品搜索（「產品類型」頁）只經 `fds_search_products`／`fds_product_detail` RPC：成本只回給 admin／uploader，
  任何角色都不回傳成本價，只拿折扣價（售價 × 0.8）和原價。不要在前端直接 select `supplier_prices`（RLS 只開給 admin／uploader）。
- 同型號比較（`fds_compare_supplier_prices`）的報價歷史要按 **產品＋unit＋variant_label（規格）** 分組：
  不同尺寸／計價單位的兩筆報價不是同一條報價的前後，混在一起會產生假的漲跌。
  比較頁任何角色都看得到中間價與原價，成本只給 admin／uploader。
- 以圖搜款（`search-by-image` → `fds_match_product_images`）與文字搜索共用同一套篩選（含 `p_text`）；
  前端改篩選時要用同一張圖重跑圖片搜索，不要只重跑文字搜索。
