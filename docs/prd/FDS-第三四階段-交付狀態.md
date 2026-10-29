# FDS 第三、第四階段交付狀態（DeepSeek 開發）

日期：2026-10-29
對照 PRD：`docs/prd/FDS-第三四階段-DeepSeek開發交接-PRD.md`
部署與驗收步驟：`docs/prd/FDS-三四階段-部署與驗收清單.md`（待執行，不代表已部署）
工作區：`D:\work\furniture1000`，分支 `develop`
資料庫：只套用到 FDS 2.0 分支 `omxizeukbcqzsnjsuwod`；**Production `riaubhtruisbwdlwjzur` 未套用、未部署**

> 本文件分開記錄「本地完成」、「測試通過」、「migration 已套（分支）」、「function 已部署」、「前端已發布」、「真實流程已驗收」。
> 沒有勾選的功能就是未完成或未驗收，不代表已在線上可用。

---

## 1. 逐項現況

| 項目 | 現況 | 本次改動 | 驗證 | 未完成／外部依賴 |
|---|---|---|---|---|
| **FDS-08 參考計價** | 已有完整流程（報價預算 → 參考報價、PMS 項目／QMS 報價、Section／明細、導入、快照、分享、PDF） | 數量／價格驗證、金額以仙計算並一致、來源追溯欄位（報價號、Section 名）、快照複製 | `scripts/test-package-pricing.mjs` 通過；`scripts/test-package-pricing-live.mjs` 在分支 PASS（舊單價格不變、新單採新價、基準價復原、分享 token 只回本單／錯 token 回空、仙計總額一致）；`tsc --noEmit` 通過 | 未在 Production 做登入使用者端驗收；Google 工作表公式仍屬外部資料待核對 |
| **FDS-07 圖冊附件** | 已有多圖冊、不連續整頁、上下半頁、框選、排序；PDF 由 edge `quote-catalog-pages` 只回抽取頁，PM 拿不到整本原檔 | ①**移除「頁底顯示來源」開關**：對外 PDF 只放圖冊頁本身，不再畫來源帶（`showCatalogSource` 由前端、草稿與 PDF 型別一併刪除，舊單的舊值會被忽略）；②搜尋改為多關鍵字（AND，含年份／版本）＋每次開啟重設搜尋字＋「重新整理」；③空結果會說明只列「圖冊」類型，並可在「廠家詳情 → 廠家文件」把標錯的報價單改成圖冊（沿用既有 RPC `fds_supplier_document_update`）；④**跨頁圖冊一律按直向輸出**（2026-10-29 使用者驗收意見「圖冊都是垂直的，不要水平放」）：開啟對話框時讀第一頁尺寸判斷整份是單頁還是跨頁，跨頁選一頁＝加入「左半」「右半」兩個直向版面（舊單的整頁附件會自動換成兩列），半頁按鈕改為「左半頁／右半頁」，清單「預覽」直接顯示附錄裡那一張（已裁切、已轉正）；PDF 合併時再按實際頁面寬高／`/Rotate` 拆頁，同一頁只下載一次；⑤**選擇器改成縮圖版**（2026-10-29）：三步式（選擇圖冊 → 選擇頁面 → 確認加入）、圖冊卡封面縮圖＋廠家 chips、一屏 16 張頁面縮圖＋分頁、已選清單（縮圖、整頁／上下半／左右半標籤、排序、刪除、預覽）；新增縮圖管線 `src/lib/catalogPageThumbs.ts`＋`renderQuotePdfThumbnails`：每頁一次 edge 抽取 → pdf.js 360px JPEG（q0.72，約 15–25 KB，整頁 PDF 為 0.3–1 MB）→ IndexedDB `fds-catalog-thumbs`（30 天／400 張）＋記憶體，同頁共用、同文件合批（每批 8 頁）、下一屏預取 | `scripts/test-quote-catalog-pages.mjs` PASS（框選夾回圖內、太細丟棄、左上→PDF 左下裁切框、跨頁左右半、`/Rotate` 90／180／270 換算、舊單整頁轉左右、24 頁上限、附件標籤、缺欄位丟棄）；用分支「向氏产品图册2026」第 8／30 頁實跑合併：整頁跨頁出 2 張 603.8×824.9 直向頁、左／右半各出 1 張直向頁，逐頁渲染核對左右版面對應正確；`fds_list_quote_catalogs` 改版已套 prod＋分支，實測「向氏 QXS」「qxs 2026」「2026 中文」均命中、查無此物回 0、空白回全部；`fds_supplier_document_update` 實測 quote↔catalog 雙向生效 | 需用三份真實已授權 PDF 混選整頁與局部圖做瀏覽器端驗收；跨頁判斷用「寬高比 > 1.15」＋第一頁縮圖尺寸，真正橫向的單頁圖冊也會被當成跨頁，需在瀏覽器端確認；縮圖第一次開啟仍要下載當前 16 頁 PDF（約 5 MB），其後由 IndexedDB 快取；三步式版面與縮圖未在本機截圖核對；過期授權／不可讀文件未實測 |
| **FDS-06 單件 SKP／FBX** | 已有「生成／下載 SKP」「生成／下載 FBX」、模型版本、私有儲存、Worker 裝置授權 | **2026-10-29 使用者決定：改由 Codex 開發／驗收，本階段不再處理 SKP／FBX 實機** | `test-skp-review-regressions.mjs` PASS（歷史紀錄） | 已轉 Codex 線程；`test-skp-device-auth.mjs` 的分支 queue 問題不屬本階段阻塞 |
| **FDS-10 設計專案分區** | 已有 `ProjectPartitionPanel`、`project_zones`、空白區保留 | 無 | `scripts/test-empty-zone-prune.mjs` PASS；**2026-10-29 使用者驗收 PASS**（多區、改名、排序、產品移區後重開） | 無 |
| **FDS-11 成功案例** | 已有三頁即時讀 PMS、篩選、權限、圖片共用元件、客戶匯出 | 無（§1.1 已確認單層行業標籤） | `case-showcase.test.mjs` 11/11 PASS；`case-list-filters.test.mjs` 2/2 PASS；**2026-10-29 使用者驗收 PASS**：成功案例三頁、多條件交集、無結果、客戶版匯出 | 兩級行業需求已修正／關閉（見 §1.1）；>1000 筆分頁與角色隔離未在本輪對真實 PMS 實測（測試以替身驗證規則） |
| **FDS-12 Asana 雙向同步** | 只有 `AsanaLinkButton` 連結入口，**沒有**雙向同步 | 連結／留言表與 RPC、worker（分頁＋去重）、CLI、廠家詳情 **Asana tab**；授權對齊 QMS（每用戶 OAuth＋refresh，cron 用 PAT）；留言雙向（新增／編輯／刪除，只限 FDS 建立；Asana 原有留言只讀）；PMS `factories.asana_link` 優先（source='pms'） | `test-asana-factory-sync.mjs`、`test-asana-factory-link-live.mjs` PASS；推送／編輯／刪除實測成功（編輯＝刪舊 story 再 POST，新 gid；刪除後本地列移除）；PMS 接入 7 個 link、6 同步、1 個 403；測試後 Asana task 無殘留測試留言；`tsc`／build／audit 通過 | OAuth 首次連接仍待 Asana app 白名單 redirect；未做 OAuth token 寫入驗證 |
| **FDS-13 BWF 分區示範圖與場景** | 已有平面圖上傳、Gemini 讀區名＋矩形、最多 24 區、拖畫／改框、確認、每區最多 8 張圖、4:3 透視圖生成（admin／uploader／PM）、私有儲存、`project_data` 關聯 | ①補分區資料規則回歸測試（框在圖內、24 區上限、換圖重新確認、刪區移圖、每區 8 張）；②**伺服器端報價範圍檢查**：新增 `fds_quote_zone_scope`，`generate-quote-reference-image` 接受 `quoteUuid` 並重查範圍；③報價編輯器 → 排版編輯器 → 生成對話框逐層傳遞所屬報價；④排版編輯器開啟時查範圍，非 BWF 正式報價**不顯示「AI 生成」按鈕**並顯示原因 | `scripts/test-quote-floor-plan.mjs` PASS；`scripts/test-quote-zone-scope.mjs` PASS；`scripts/test-quote-zone-scope-live.mjs` 在分支 PASS（正式報價放行；快速報價／客戶方案／DP-／設計專案／不存在報價／非職員全部拒絕）；**2026-10-29 使用者驗收 PASS**：正式報價 → 平面圖 → 拉框 → 確認 → 生成透視圖；快速報價確認沒有「AI 生成」 | ①**GLB 場景使用者決定不做**（2026-10-29），已移出範圍；②`generate-quote-reference-image` 未部署到任何環境，所以範圍檢查只能在程式與資料庫層驗證，未經線上 invoke 驗證；③範圍查詢失敗時前端仍顯示按鈕，最終由伺服器拒絕 |
| **FDS-14 客戶互動報價** | 原有 `save_customer_quote_scheme` **會直接改寫 `bwf_quote_item.quantity` 與 `bwf_quote.total_amount`**，與 PRD 衝突 | 新增客戶提交記錄表與新 RPC；舊 RPC 保留簽名但改為只記錄提交；客戶頁改呼叫新函式並帶需求備註；加入 PM 通知佇列與通知 worker；客戶頁有效查看記錄（同事預覽自己的連結不會停信）；**報價一覽新增「客戶提交」面板**（PM 看選品／數量／需求、參考金額、通知狀態，可標記待處理／已確認／已開正式報價／不採用，只改提交記錄） | `scripts/test-customer-quote-request-live.mjs` 在分支 PASS（提交另存、正式報價不變、重送冪等、跨報價被拒、PM 可讀取與改狀態、非法狀態被拒、非職員被拒、處理後正式金額與數量仍不變）；`scripts/test-customer-quote-requests.mjs` PASS | **2026-10-29 使用者驗收 PASS**：客戶分享連結提交（選品／數量／需求）＋報價一覽「客戶提交」面板處理；PM 通知實寄（提交＋查看各一封，Resend + central log） |
| **FDS-15 郵件模板與跟進** | 原本完全沒有 | 每張報價獨立模板、手動立即發送（前端即時叫醒 worker，寄不出才留在隊列由 cron 補寄）、3 天自動跟進、首次有效查看停該單、掃描器排除、狀態流轉、停信／查看與 claim 競爭由 `confirm_send` 覆核；寄件者 `no-reply@bwteam-furniture.com`（分支 secret 已設）；worker `send-quote-email` **已部署到分支** | 全部離線／分支測試 PASS；**已用 Resend 真實寄出測試信**到 `cfb.app02@chifung.net`（2 封）：`bwf_quote_email_message.status=sent`、`provider=resend`、有 `provider_message_id` 與 `sent_at`；修好 service_role 對 `email_notification_logs` 的 insert 後，第二封亦寫入 central log（`status=success`） | **2026-10-29 使用者驗收 PASS**：填模板（電話必填）→ 排入發送 → 收信 → 點「加單授權連結」；DB 顯示 `is_valid=true`、`status=viewed`、`auto_follow_up=false`；另實測已排隊的跟進信在有效查看後變成 `cancelled`（`cancelled=1`、`queued=0`）。PM 通知亦已另測成功 |

### 1.1 FDS-11 行業標籤（已確認，2026-10-29）

使用者確認兩級行業需求**已經修正**，FDS 維持現有單層顯示與篩選，不需要改接。

同日重新核對 QMS_dev（`alrbbyqkeobmvvvscpma`）與 PMS 正式庫（`kqwktnplkqucsbasyfjl`）：

- `nos_customer_tags` 仍然只有 `collection_id`，兩個庫都**沒有** `parent_id`／`level`／`parent_uuid` 等層級欄位；`nos_customer_tags_collection` 也只有 `order`。
- 三個 collection 不變：Industry Tags（29）、Business Tags（26）、Decision Maker Tag（14）；`customer_tags` 仍是多對多。
- FDS 只把 Industry Tags 併成 `client_industry` 顯示與篩選；Business／Decision Maker 不進案例頁。

因此 §1.1 之前的五條「待 Leo 確認」問題**全部關閉**，不列為阻塞。若日後 PMS 真的新增兩級行業（新表／新欄位），再按同一契約接入。

---

## 2. 本次修改

### 前端

- `src/lib/packagePricingMath.ts`
  - 金額統一以仙計算（單價先四捨五入至仙，再乘數量），分區小計、總額、畫面、快照與 PDF 用同一個 `lineCents`。
  - 新增 `toCents`、`parsePackageQuantity`、`parsePackagePrice`、`packageLineProblems`、`validatePackageLines`、`clonePackageLines`。
  - 數量 0 合法（小計 0）；負數、非數字、超過上限、負價或沒有價格一律不可形成有效報價。
- `src/lib/packagePricing.ts`
  - 儲存前驗證；快照改為複製，儲存後不跟隨後續編輯；`invalid_lines` 有可讀錯誤訊息。
- `src/components/dashboard/PackageImportPicker.tsx`
  - 導入時保留來源報價號、Section 名稱、pitching code；數量解析不再把非法值靜靜變成 0。
- `src/components/dashboard/PackagePricingView.tsx`
  - 逐行顯示問題、總額旁顯示未完成原因、儲存／客戶連結／下載 PDF 在有問題時停用；基準價寫入前檢查負數。
- `src/lib/customerQuoteAccess.ts`
  - 新增 `submitCustomerQuoteRequest`；`saveCustomerQuoteScheme` 保留但改為提交記錄；錯誤訊息涵蓋 `empty_request`／`invalid_quantity`／`invalid_token`。
- `src/components/dashboard/customers/CustomerQuoteSchemesView.tsx`
  - 客戶提交改走新 RPC，帶自訂需求與逐項備註；成功訊息說明「正式價格不會因這次提交而改變」。
  - 客戶用瀏覽器載入授權頁後記錄有效查看（JS 執行、報價已載入），只停該單自動跟進。
- `src/lib/quoteEmailFollowUp.ts`（新）
  - 固定三段＋自訂段的組裝、發送前檢查、狀態標籤、RPC 封裝、掃描器／webdriver 判定。
- `src/components/dashboard/QuoteEmailFollowUpModal.tsx`（新）
  - 每張報價的模板編輯、內容預覽、收件人／電話檢查、立即發送、停止自動跟進、發送與查看紀錄。
- `src/components/dashboard/QuotationListView.tsx`
  - 每行新增「郵件模板與跟進」入口。

### 資料庫（只套用到分支）

- `supabase/migrations/20261029120000_fds23_customer_quote_requests.sql`
  - `bwf_quote_customer_request`（報價關聯、分享連結、選品／數量／需求、客戶選品合計、PM、通知狀態、`idempotency_key`）。
  - `submit_customer_quote_request(...)`：只寫提交記錄與 `project_data.clientQuoteScheme`，**不更新** `bwf_quote_item` 或 `bwf_quote.total_amount`。
  - `save_customer_quote_scheme(...)`：保留簽名，改為呼叫新函式。
  - 只有 `bwf_has_role(admin/uploader/pm)` 可以 select；沒有直接 insert／update 權限。
- `supabase/migrations/20261029121000_fds23_customer_quote_notifications.sql`
  - `fds_quote_request_claim_notifications`／`fds_quote_request_mark_notified`／`fds_quote_customer_requests`。
- `supabase/migrations/20261029130000_fds23_quote_email_followup.sql`
  - `bwf_quote_email_template`、`bwf_quote_email_settings`、`bwf_quote_email_message`、`bwf_quote_share_view`。
  - `fds_quote_email_template_save`、`fds_quote_email_schedule`、`fds_quote_email_stop`、`fds_quote_email_enqueue_follow_ups`、`fds_quote_email_claim`、`fds_quote_email_mark`、`fds_quote_email_status`、`record_quote_share_view`。
  - 同一報價同類郵件最多一筆待發（partial unique index）；跟進信只在 `auto_follow_up_active`、未查看、到期時排入。
  - 有效查看只停該單：把該單 queued 的跟進信設為 `cancelled`。

### Edge Function（2026-10-29 已部署到 FDS 2.0 分支）

- `supabase/functions/_shared/email.ts`（新）：Resend／Gmail SMTP 共用發信；寄件身份只從環境讀，不在前端寫死。
- `supabase/functions/notify-customer-quote-request/index.ts`（新）：客戶提交後通知 PM；沒有 PM 電郵記 `pm_email_missing`，不猜地址。
- `supabase/functions/send-quote-email/index.ts`（新）：排入到期跟進 → claim → 用當下模板發信 → mark；失敗交回 queue，3 次後 failed。
  - 兩支都依賴 `_shared`，部署必須用 `npx supabase functions deploy <name> --project-ref <ref>`，單檔上傳不會打包。

### 其他

- `src/lib/asanaFactorySync.ts`（新）：FDS-12 第一版可測核心——Description 合併（Asana 為主）、Comment 只追加、同步標記防回聲、重試與分頁去重、狀態標籤。未接 Asana API。
- `src/lib/quoteZoneScope.ts`（新）：FDS-13 前端範圍判斷（快速報價／客戶方案／回收桶／DP-／設計專案殼）。
- `src/components/dashboard/QuotePhotoGenerateDialog.tsx`、`QuotePhotoLayoutEditor.tsx`、`QuotationDraftEditor.tsx`：把所屬報價 `quoteUuid` 逐層傳到生成服務。
- `supabase/functions/generate-quote-reference-image/index.ts`：收到 `quoteUuid` 時呼叫 `fds_quote_zone_scope`，不合格回 403 `quote_photo_generate_scope_denied`（未部署）。
- `src/lib/quotePhotoLibrary.ts`：生成參數加 `quoteUuid`，並把範圍錯誤轉成可讀訊息。
- `src/components/dashboard/QuotePhotoLayoutEditor.tsx`：開啟時查 `fds_quote_zone_scope`，非 BWF 正式報價不顯示「AI 生成」並顯示原因。
- `supabase/migrations/20261029160000_fds23_quote_zone_scope.sql`：`fds_quote_zone_scope(uuid)`（角色＋報價範圍）。
- `supabase/migrations/20261029170000_fds23_quote_email_send_race.sql`：`fds_quote_email_confirm_send(uuid)`；停止／有效查看一併取消已 claim 的跟進信。
- `supabase/functions/send-quote-email/index.ts`：寄出前呼叫 `fds_quote_email_confirm_send`，被取消就不寄。
- `src/lib/customerQuoteRequests.ts`（新）與 `src/components/dashboard/CustomerQuoteRequestsModal.tsx`（新）：PM 查看客戶提交與處理狀態；報價一覽每行新增「客戶提交」入口。
- `supabase/migrations/20261029180000_fds23_customer_request_status.sql`：`fds_quote_customer_request_set_status`，並讓查詢回傳提交明細。
- `supabase/migrations/20261029200000_fds23_asana_factory_link.sql`：Asana 廠家 link／comment 表與 RPC（唯讀同步）。
- `supabase/functions/sync-asana-factories/index.ts`：唯讀 worker，讀 task notes／stories 寫入 FDS（已部署到分支並完成端到端同步）。
- `scripts/link-asana-factory.mjs`：管理員綁定 CLI（`--list`／`--factory-id … --task-gid …`／`--remove <id>`／`--sync`），用 develop 一鍵登入呼叫既有 RPC；另有廠家詳情頁 UI。
- `src/components/dashboard/AsanaFactoryLinkPanel.tsx`（新）：廠家詳情「資訊」頁的 Asana 綁定面板（綁定／更新／移除／立即同步，顯示 Comment 數、上次同步與錯誤）。

### 測試入口

- `scripts/test-package-pricing.mjs`（新，離線）
- `scripts/test-customer-quote-request-live.mjs`（新，只打分支，建立並刪除自己的測試報價）
- `scripts/test-quote-email-template.mjs`（新，離線）
- `scripts/test-quote-email-followup-live.mjs`（新，只打分支，建立並刪除自己的測試報價；不發信）
- `scripts/test-quote-email-staff-live.mjs`（新，只打分支；用臨時 PM 身分測職員 RPC，建立並刪除自己的測試報價與臨時帳號；不發信）
- `scripts/test-asana-factory-sync.mjs`（新，離線）
- `scripts/test-quote-floor-plan.mjs`（新，離線）
- `scripts/test-quote-zone-scope.mjs`（新，離線）
- `scripts/test-quote-zone-scope-live.mjs`（新，只打分支；建立並刪除自己的測試報價與臨時帳號）
- `scripts/test-package-pricing-live.mjs`（新，只打分支；建立並刪除測試參考報價、復原基準價）
- `scripts/test-quote-email-isolation-live.mjs`（新，只打分支；A／B 模板與停信隔離、claim 後停信競爭；不發信）
- `scripts/test-quote-email-retry-live.mjs`（新，只打分支；無 provider 時 worker 重試而不再假裝成功）
- `scripts/test-pm-notification-live.mjs`（新，只打分支；客戶提交與有效查看各寄一封 PM 通知到測試信箱）
- `scripts/test-quote-catalog-pages.mjs`（新，離線）
- `scripts/test-customer-quote-requests.mjs`（新，離線）
- `scripts/test-asana-factory-link-live.mjs`（新，只打分支；建立並刪除自己的 link 與臨時帳號）

---

## 3. 已跑的檢查

| 檢查 | 結果 |
|---|---|
| `npx tsc --noEmit` | 通過（exit 0） |
| `node scripts/test-package-pricing.mjs` | PASS |
| `node scripts/test-quote-email-template.mjs` | PASS |
| `node scripts/test-customer-quote-request-live.mjs` | PASS（分支） |
| `node scripts/test-quote-email-followup-live.mjs` | PASS（分支） |
| `node scripts/test-quote-email-staff-live.mjs` | PASS（分支） |
| `node scripts/test-asana-factory-sync.mjs` | PASS |
| `node scripts/test-quote-floor-plan.mjs` | PASS |
| `node scripts/test-quote-zone-scope.mjs` | PASS |
| `node scripts/test-quote-zone-scope-live.mjs` | PASS（分支） |
| `node scripts/test-package-pricing-live.mjs` | PASS（分支） |
| `node scripts/test-quote-email-isolation-live.mjs` | PASS（分支） |
| `node scripts/test-quote-email-retry-live.mjs` | PASS（分支；無 provider 時正確重試） |
| 真實發信（`test-quote-email-send-now.mjs`） | PASS（Resend，2 封測試信，含 central log） |
| `node scripts/test-pm-notification-live.mjs` | PASS（提交 → PM 信、有效查看 → PM 信；兩封 Resend success） |
| `node scripts/test-quote-catalog-pages.mjs` | PASS |
| `node scripts/test-customer-quote-requests.mjs` | PASS |
| `node scripts/test-asana-factory-link-live.mjs` | PASS（分支） |
| `node scripts/case-showcase.test.mjs` | 11/11 PASS |
| `node scripts/case-list-filters.test.mjs` | 2/2 PASS |
| `node scripts/test-skp-review-regressions.mjs` | PASS |
| `node scripts/test-skp-device-auth.mjs` | FAIL（分支佇列有別人的 `preview_skp` 舊任務）；FDS-06 已轉 Codex，不屬本階段阻塞 |
| `node scripts/pms-project-url.test.mjs` | PASS |
| `node scripts/test-empty-zone-prune.mjs` | PASS（既有測試，未受影響） |
| `npm run build` | 通過（最終 `✓ built in 13.89s`；只有既有 chunk >500 kB 警告） |
| `npm run audit:ui` | 通過（0 violations／0 advisories） |
| `node scripts/apply-migration.mjs <6 支> --refs=branch` | 已套用到 `omxizeukbcqzsnjsuwod`；Production 未套用 |

---

## 4. 未完成／阻塞（精確列出）

1. **FDS-12 Asana**：授權對齊 QMS（每用戶 OAuth＋refresh）；留言新增／編輯／刪除已實作並實測（只限 FDS 建立的留言）；PMS `factories.asana_link` 已接入。仍需：Asana app 白名單 redirect，完成首次 OAuth 連接與 `token_source=oauth` 寫入驗證。
2. **FDS-13 GLB 場景**：**使用者 2026-10-29 決定不做**，已從本階段範圍移除；透視圖與人工確認流程為完成範圍。
3. **FDS-13 範圍檢查未經線上 invoke 驗證**：`fds_quote_zone_scope` 與 edge 的 `quoteUuid` 檢查已完成並在資料庫層測過，但 `generate-quote-reference-image` 未部署，未有真實 HTTP 請求被拒絕的證據。部署後要用「快速報價」報價實際打一次，確認回 403。
4. **FDS-15 真實發信**：使用者驗收 PASS（模板 → 排入發送 → 收信 → 點連結）；有效查看後 `viewed`／`auto_follow_up=false`，已排隊跟進信實測被取消。Resend 已設定並有 central log。
5. **FDS-14 PM 通知信**：已實測成功（提交 → `quote_customer_request`、有效查看 → `quote_view`，都寄到測試信箱並寫入 central log）；PM 電郵靠 `platform_user_profiles.display_name` 與 `projectData.formData.projectManager` 同名比對，對不上記 `pm_email_missing`。
6. **FDS-15 有效查看與停信競爭**：已用 `confirm_send` 在寄出前覆核並取消已 claim 的跟進信；但 `confirm_send` 成功之後到 SMTP 接受之間仍有極短窗口，沒有交易式寄信就無法完全消除。會執行 JS 的掃描器亦仍可能被當成查看（PRD 已同意的限制）。
7. **Production**：十七支 migration 未套到 `riaubhtruisbwdlwjzur`；worker 只在分支部署（Production 未部署），前端未發布。
8. 既有 `npm run lint` 不可用（沒有 eslint 設定檔）。

---

## 5. 建議下一步

1. 用分支測試帳號做 FDS-08／FDS-14／FDS-15 的瀏覽器端驗收（真實 QMS 報價樣本、手機與桌面、測試信箱）。
2. FDS-13 GLB 已決定不做；透視圖與人工確認流程已完成並驗收。
3. 部署 `generate-quote-reference-image` 後，用「快速報價」報價實際生成一次，確認回 403，並用正式報價確認可生成（FDS-13 範圍檢查的線上證據）。
4. 取得 Asana 憑證與測試任務後，才開始 FDS-12；先做 FDS→Asana 單向 append 與去重，再開 Asana→FDS。
5. 全部驗收通過後，才按使用者授權把 migration 套到 Production、部署 edge、發布前端。
