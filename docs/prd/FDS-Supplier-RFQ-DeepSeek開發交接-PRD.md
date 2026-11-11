# FDS Supplier RFQ 採購系統開發交接 PRD

日期：2026-11-11  
狀態：交付 DeepSeek 開發；本文件不是完成或部署證明。  
專案：Furniture 1000／FDS，主要工作區 `D:\work\furniture1000`。  
版本：v1.0。第一期只做到按行專案價。升目錄、寫回客戶報價、邀請信版面、WhatsApp、問答、提醒、證書閘門都不在第一期。

## 1. 任務

做兩件事：

1. 供應商登入後管理自己廠的傢俬，並上載圖冊／報價單／證書，走現有解析與職員審核。
2. 內部建立 RFQ，每家廠一條連結回價，封標，按行定標。定標價只留在這張 RFQ。

對照過 QMS（`D:\work\qms-incident-release`）的 RFQ 與供應商平台。裝修專用的 Pitching、工地相、工程類型、Asana、現場考察、分包不要搬。QMS 是整張單一個得標者，而且定標不寫成本庫；FDS 第一期改成按行定標，定標同樣停在 RFQ 上。

## 2. 開發前必讀

1. 讀 `AGENTS.md`、`CLAUDE.md` 第 8 節，以及本文件。衝突時以本文件的範圍為準。
2. 先查 FDS 與 PMS 已有的表、RPC、RLS、Edge Function、頁面。沿用它們。沒有對應能力才在 FDS 追加。不改 PMS 的表契約，不在 FDS 另建 suppliers 取代 PMS `factories`。廠家鍵繼續用 `factory_id`。
3. 商業表不要 `USING (true)`。讀寫走 `SECURITY DEFINER` RPC。角色用 `bwf_has_role`／`bwf_assert_role`，不信前端傳來的角色或 `factory_id`。
4. 產品列表禁止 `.select('*')`。圖片只存 Storage URL，不寫 base64。
5. UI 用 `src/components/ui` 的 `Modal`、`Select`、`Checkbox`、`Switch`、`confirm()`。不要用 `window.confirm`／`alert`／`prompt`，不要自造 dialog shell。圖片用 `LoadingImage`。提交前跑 `npm run audit:ui`。
6. 開發與 migration 先打 FDS2.0 分支 `omxizeukbcqzsnjsuwod`。本文件不授權改 Production `riaubhtruisbwdlwjzur`，也不授權向外發信或發 WhatsApp。
7. 新 migration 用 `node scripts/apply-migration.mjs <file> --refs=branch`。不要用 PowerShell `ConvertTo-Json` 送含中文的 SQL。
8. 工作區可能有別人的未提交修改。不要重置、不要覆蓋、不要把無關檔案一起提交。

| 系統 | 開發 | Production |
|---|---|---|
| FDS Supabase | `omxizeukbcqzsnjsuwod` | `riaubhtruisbwdlwjzur` |
| PMS | QMS_dev `alrbbyqkeobmvvvscpma` | `kqwktnplkqucsbasyfjl` |

## 3. 沿用，不要重做

| 能力 | 沿用 |
|---|---|
| 廠家主檔 | PMS `factories`。FDS 只存 `factory_id` 字串。目錄讀取走 edge `supabase-functions-fetch-manufacturer-directory` |
| 供應商帳號 | `supplier_logins`（email、`factory_id`、`active`）、角色 `supplier`、頁 `/fds/factories/login`、`fds_supplier_review_documents` |
| 圖冊上載 | `fds_supplier_document_create`、bucket `supplier-documents`、`FactoryCatalogPanel`、`src/lib/supplierDocuments.ts` |
| 解析 | `processing_jobs` 只經 claim／heartbeat／complete／fail。Worker slug `supabase-functions-process-jobs` |
| 審核入庫 | `extraction_items.raw_json` 不改寫；人工只寫 `corrected_json`。`fds_extraction_item_review`。通過後才 `fds_import_extracted_products`。同廠同型號不改既有 `products` 列，只追加 `supplier_prices`。不寫 `products.cost_price` |
| 職員審核頁 | `/fds/products/ai-review`，`ExtractionReviewView.tsx` |
| 目錄成本 | `supplier_prices`、`fds_compare_supplier_prices`。產品搜索的成本仍只給 `admin`／`uploader` |
| 客戶報價 | `bwf_quote`／`bwf_quote_item`。第一期只讀某個版本的行來產生 RFQ 項目，不更新這兩張表 |

現況缺口：`fds_supplier_document_create` 一開始就 `bwf_assert_role(array['admin','uploader'])`。`supplier` 登入後只能看自己廠的文件狀態，不能上載。

## 4. 不做

第一期不要做這些按鈕、表或流程：

- 把專案價寫進 `supplier_prices`（升為目錄價）
- 把專案價寫回 `bwf_quote_item.cost_price` 或售價、匯率
- 採購訂單、付款、出貨
- 分包、整包一個得標者、現場考察、Asana、工地相
- 邀請信固定版面、WhatsApp、澄清問答、截止前提醒、證書過期擋提交
- 供應商子角色（responder／approver／readonly）
- 供應商直接改 PMS `factories`
- 供應商看到其他廠回價、客戶售價、毛利、別廠 PDF
- `designer`、`client` 進入 RFQ
- 時間到了自動定給最低價，或自動變成過期
- 用 `.select('*')` 讀 `products`

下一期規則已經定好，寫在第 12 節。第一期的表可以留下 `product_id`、`source_quote_id`，方便以後接，但不要做那兩個寫入按鈕。

## 5. 角色

伺服器從登入身分判斷，不接受請求裡的角色。

| 動作 | 誰 |
|---|---|
| 建立、改草稿、發布、定標、把一行標成不定標 | `admin`、`uploader`、`pm` |
| 提前揭標、整張取消、重開已定標的行 | `admin`，而且要寫原因 |
| 看全部回價、看受邀廠相關行的歷史目錄價 | `admin`、`uploader`、`pm` |
| 上載自己廠的文件、看自己廠的傢俬與審核狀態、用連結填自己的回價 | `supplier`，以及持有該廠有效連結的人 |
| RFQ 頁、回價、歷史目錄價 | `designer` 與 `client` 不可 |

供應商的 `factory_id` 只從 `supplier_logins` 讀：`active` 且 email 等於 JWT email。連結流程不讀登入角色，只認 token 雜湊對上的那家廠。

持連結的人看得到自己已提交的單價，因為那是他自己填的。他看不到其他廠。定標後他只看自己每一行是得標、未中選、尚未決定，還是整張已取消。

## 6. 第一期甲：供應商傢俬

### 6.1 我的傢俬

供應商登入後的主頁列出自己廠已入庫的產品。欄位只有：型號、規格、主圖、在售／停產、最新已審核報價年份、自己的已審核成本單價與幣別。

不回：售價、折扣價、毛利、其他廠價格、其他廠產品、原始 PDF 簽名網址。

單款補資料（補圖、尺寸、面料、色板、停產、替代型號）送進現有審核佇列。通過前不改線上產品、不寫 `supplier_prices`。`raw_json` 仍只有職員能改 `corrected_json`。

### 6.2 上載

沿用 `catalog`、`price_list`、`certificate`。證書只存檔，不解析。圖冊與報價單沿用 `parse_pdf`。

改 `fds_supplier_document_create`（以及上載時真正呼叫的 storage 寫入）時：

- `admin`／`uploader` 維持現在行為，可以指定廠家。
- `supplier` 只能寫自己的 `factory_id`。請求裡的 `factory_id` 與帳號不符就拒絕。
- Storage 物件必須落在該廠既有路徑規則下。不能簽別廠文件，不能讀整份他人 PDF。
- 回傳給供應商的狀態：待審、通過、退回、退回原因。對齊 `extraction_items` 的 `pending`／`approved`／`rejected` 與文件本身的失敗訊息。

職員審核頁維持 `/fds/products/ai-review`。不要做第二套審核。

### 6.3 驗收

- [ ] 供應商只能看到、上載自己的 `factory_id`。改請求裡的廠家 id 會被拒絕。
- [ ] 上載的圖冊進入現有 `processing_jobs`，職員在原審核頁通過後才出現在「我的傢俬」。
- [ ] 退回原因供應商看得到。未通過的項目不在 `supplier_prices`。
- [ ] 頁面沒有售價、毛利、其他廠資料。
- [ ] `designer` 呼叫同一支 RPC 被拒絕。

## 7. 第一期乙：RFQ

### 7.1 生命週期

狀態存在伺服器，時區固定 `Asia/Hong_Kong`。截止、可否提交、是否已揭標都用資料庫 `now()`，不信瀏覽器時間。

`draft` → 發布後 `open` → 截止後 `review`。

每一行都結束之後：只要有一行定標，表頭就是 `awarded`；每一行都是不定標，表頭就是 `not_awarded`。`admin` 取消後表頭是 `cancelled`。

不使用「到時自動過期」。到時只做兩件事：不能再提交，以及若尚未全部行結束，表頭視為 `review`。

提前揭標不改變截止，截止前仍可提交。揭標之後，`admin`／`uploader`／`pm` 看得到已提交的單價。

編號：`RFQ-{香港年}-{四位流水}`。

### 7.2 建立

草稿欄位：標題、一種幣別、截止、備註。項目來自三個來源，可混在同一張單：

- 某個 `bwf_quote` 版本的行（記下 `bwf_quote.id` 與 `bwf_quote_item.id`）
- 目錄裡的 `products.id`
- 手填規格

複製到 RFQ 行的內容：名稱、型號、數量、單位、尺寸、規格、參考圖 URL、`product_id`（沒有就空）。不複製售價、成本、毛利。

發布前可改幣別、行、數量、規格、截止、受邀廠。發布條件：有截止、至少一行、至少一家廠。發布後幣別凍結；要改幣別就另開一張 RFQ。

不做分包。一行就是一行。

### 7.3 修訂

發布時 `revision` 從 1 起。

發布之後，新增、刪除、修改行，或改數量、規格、截止，都要升 `revision`。舊連結變成只讀，舊提交保留但不能再拿來定標，供應商要重交。

只新增一家受邀廠不升修訂，其他廠已提交的回價繼續有效。

### 7.4 邀請連結

一張 RFQ、一個修訂、一家廠，一條連結。token 只存 SHA-256。明文只在建立當下回給職員複製。

同廠同事可以轉發這條連結。提交時記錄填寫人電郵（連結頁必填，格式要像電郵）。沒有廠家電郵也可以複製連結。第一期不代發信。複製連結不算已送達。

連結綁定的廠不能改。不能用這條連結讀其他廠、讀客戶報價、讀售價。

修訂不符、已撤回、整張取消的 token 直接無效。截止後連結仍可打開，只能看自己的凍結內容。

### 7.5 回價

供應商改得了：單價、不報價、交期天數、有效期天數、MOQ、包裝件數、體積、備註、替代型號（自己的 `product_id` 或一段文字）。

供應商改不了：名稱、數量、單位、規格、幣別。

規則：

- 空白是不報價，不是 0。0 是有效價。負數拒絕。
- 可以只報其中幾行。至少一行有有效單價才能正式提交。
- 正式提交是不可變版本，同一交易寫版本、明細、事件。產生回執碼與內容雜湊。`idempotency_key` 重試回同一回執。
- 截止前可撤回。撤回不刪版本。之後可再交新版本。
- 定標只看該廠最新一次狀態為已提交、且屬於目前修訂的版本。
- MOQ 大於詢價數量仍可提交、可定標。比價頁對該行顯示警告，不擋。

未入庫、未審核的型號可以當替代說明回這張 RFQ。第一期不會因此建產品。

### 7.6 封標與歷史價

`sealed_bid` 預設真。下列任一成立才算已揭標：

- `close_at` 已到
- `admin` 提前揭標，並寫了原因，同時清掉封標

未揭標時，內部詳情 RPC 不回這次回價的單價、小計、總額、回價備註裡的價格。回得出：有沒有提交、已報行數、廠家名稱、截止、項目規格。

未揭標時仍可回歷史目錄價，而且只限這張單的受邀廠與相關 `product_id`，只給 `admin`／`uploader`／`pm`。讀 `supplier_prices` 的現有比較口徑：同一產品、單位、`variant_label`。沒有 `product_id` 的手填行沒有歷史價。產品搜索頁的成本政策不要放寬，`pm` 不能因此在搜索頁看到成本。

`designer`、`client`、其他廠的 token 呼叫詳情，不回任何單價與歷史價。

### 7.7 定標

未揭標不能定標。

每一行的結束只有兩種：

- 定給某家廠目前修訂的最新已提交版本，並寫原因
- 此行不定標，並寫原因

定標寫入專案價快照：廠家、版本 id、明細 id、單價、幣別、數量、原因、操作者、時間。不寫 `supplier_prices`，不更新 `bwf_quote`。

同一行同時只有一個有效定標。不同行可以分給不同廠。

已定標的行，供應商之後再提交新版本也不會自動改判。`admin` 重開該行並寫原因之後，舊專案價標成已重開，行回到未決定。重開不刪歷史。

`admin` 取消整張：不能再提交、不能再定標。已定專案價保留，並標成已取消。

全部行都結束時才改表頭為 `awarded` 或 `not_awarded`。未決定的行保持未決定，不能靠一次整張定標把其餘行悄悄變成不定標。

### 7.8 建議的新物件

表名用 `fds_rfq_*`。不要建 `qms_rfq_*`，也不要改 QMS 的表。

| 表 | 用途 |
|---|---|
| `fds_rfqs` | 表頭：編號、標題、幣別、狀態、`revision`、`close_at`、`sealed_bid`、`revealed_at`、`reveal_reason`、`source_quote_id`、取消原因 |
| `fds_rfq_items` | 行：序號、名稱、型號、數量、單位、規格、尺寸、圖 URL、`product_id`、`source_quote_id`、`source_quote_item_id` |
| `fds_rfq_invitations` | 廠家、修訂、狀態、聯絡電郵。唯一鍵是 RFQ＋修訂＋`factory_id` |
| `fds_rfq_invitation_tokens` | `token_hash`、invitation、過期與作廢 |
| `fds_rfq_submissions` | 版本、狀態、回執、內容雜湊、冪等鍵、提交人電郵、總額只在已揭標的內部 RPC 計算 |
| `fds_rfq_submission_items` | 單價、`no_quote`、交期、有效期、MOQ、包裝、體積、替代 `product_id`、替代文字 |
| `fds_rfq_awards` | 專案價快照。狀態 `active`／`reopened`／`cancelled` |
| `fds_rfq_events` | 發布、修訂、提交、撤回、揭標、定標、不定標、重開、取消。`actor_kind` 為 staff／supplier／link／system |

RLS 開啟，不給 anon／authenticated 直接 select 這些表。全部走 RPC。

建議 RPC，名稱可調整，行為不要調：

- `fds_rfq_save_draft`、`fds_rfq_publish`、`fds_rfq_revise`
- `fds_rfq_invite_factory`（只加廠，不升修訂）
- `fds_rfq_issue_link`（回明文一次）
- `fds_rfq_detail`（內部；未揭標剝單價）
- `fds_rfq_reveal`、`fds_rfq_cancel`、`fds_rfq_reopen_line`（admin）
- `fds_rfq_award_line`、`fds_rfq_no_award_line`
- `fds_rfq_open_by_token`、`fds_rfq_submit_by_token`、`fds_rfq_withdraw_by_token`

`fds_rfq_detail` 與 token RPC 都要在 SQL 裡分支，不能先查出價格再靠前端隱藏。

### 7.9 頁面

內部，沿用 `src/lib/appSectionRoutes.ts` 的 FDS 路徑風格：

- `/fds/procurement/rfqs` 列表：草稿、進行中、評審、已定標、不定標、已取消
- `/fds/procurement/rfqs/new` 建立
- `/fds/procurement/rfqs/:rfqId` 詳情、連結、比價、按行定標

供應商：

- 登入後的傢俬與上載放在現有廠家登入能到達的區域，不要再做一個平行的產品庫
- 公開頁 `/rfq/invite/:token`。不要求登入。登入了也不能拿這條連結看別廠

`designer` 的選單不出現採購。直接打開網址也要被 RPC 拒絕。

比價：一行一個區塊。每家廠一欄，顯示版本號、已報行數。未揭標時單價位置是封標，不是 0，也不是空白假價。已揭標後，不報價顯示「—」。MOQ 大於數量時顯示警告。不自動標出最低價當得標者。

### 7.10 驗收

- [ ] 草稿可改幣別；發布後改幣別被拒絕。
- [ ] 發布後改數量會升修訂，舊 token 不能再提交，新 token 可以。
- [ ] 發布後只加一家廠，原廠舊回價仍可定標。
- [ ] 截止前，`pm` 的詳情 JSON 沒有單價；歷史目錄價仍在。提前揭標要有原因，揭標後 `pm` 看得到單價。
- [ ] 未揭標時定標被拒絕。0 可提交；空白不算 0；負數被拒絕；一行都沒有單價不能提交。
- [ ] 同一冪等鍵重試不會產生第二個版本。
- [ ] 一行定給 A 廠、另一行定給 B 廠。第三行可以不定標。三行都結束後表頭才變成 `awarded`。
- [ ] 定標後資料庫的 `supplier_prices` 與 `bwf_quote_item` 行數與內容不變。
- [ ] 用 A 廠 token 讀不到 B 廠價格。`designer` 讀詳情被拒絕。
- [ ] 取消後不能再提交。已定專案價還在，狀態是已取消。
- [ ] 重開後該行回到未決定，舊專案價仍可在事件裡查到。

用測試帳號與測試廠家。不要為了驗收去改正式報價或正式目錄價。

## 8. 錯誤碼

RPC 用穩定的 `errcode` 訊息，前端只映射這些字，不要顯示 SQL：

`permission_denied`、`rfq_not_draft`、`currency_locked`、`close_required`、`items_required`、`invitation_required`、`revision_mismatch`、`token_invalid`、`deadline_passed`、`sealed`、`negative_price`、`empty_submission`、`line_already_resolved`、`award_version_stale`、`reason_required`、`factory_mismatch`。

## 9. 測試

加可重複執行的測試，不要只靠手工點頁：

- 封標 RPC 的回傳 JSON 不含單價鍵
- 空白、0、負數、部分報價
- 修訂使舊提交不可定標；加廠不會
- 按行兩個得標者
- 定標不寫 `supplier_prices`、不寫 `bwf_quote_item`
- token 不能跨廠
- 供應商上載 RPC 不能改 `factory_id`

## 10. 完成定義

第一期完成是指：分支庫上 migration 已套用、上述驗收勾完、`npm run audit:ui` 通過、相關測試通過。不要把 Production 部署寫進完成。不要宣稱信已送達。

## 11. 實作順序

1. 供應商上載權限與「我的傢俬」、審核狀態。
2. RFQ 表與 RPC、內部建立與連結、封標、回價、按行專案價。
3. 驗收與測試。

第 12 節不要插進這個順序。

## 12. 下一期才做（不要在第一期實作）

這些規則已定，避免以後重做時改義：

- 升為目錄價只給 `admin`／`uploader`，而且該行已是入庫產品。未審核新型號要等現有圖冊審核通過。按鈕寫一筆 `supplier_prices`，來源標成這張 RFQ 行。
- 寫回成本只給能定標的角色。只寫發起 RFQ 的那個 `bwf_quote` 版本的成本單價，不改售價、不改匯率。RFQ 幣別不是人民幣時按鈕停用。替代款得標時，要先等該型號入庫，且職員已把報價行改成那個產品，才可以寫。
- 報價編輯器現在沒有按角色藏成本。寫回之後，打得開那張報價的 `designer` 會看到成本。這是已知結果，不是第一期要修的漏洞。
- 重開與取消都不自動刪除已升格的目錄價，也不自動清掉已寫回的報價成本。
- 之後才做：邀請信版面、WhatsApp、澄清問答、提醒、證書過期擋提交、樣板、年度調價、停產通知、從缺成本的報價行一鍵產生 RFQ。

## 13. 參考路徑

- `src/components/dashboard/FactoryCatalogPanel.tsx`
- `src/components/dashboard/ExtractionReviewView.tsx`
- `src/lib/supplierDocuments.ts`
- `src/lib/supplierLogins.ts`
- `src/lib/appSectionRoutes.ts`
- `supabase/migrations/20261022170000_fds21_supplier_logins.sql`
- `supabase/migrations/20261027100000_ai_document_upload_year.sql`
- `supabase/migrations/20261028000000_fds_extraction_sale_price.sql`
- QMS 行為對照：`D:\work\qms-incident-release\outputs\prd\rfq.md`。只對照封標、不可變版本、連結 token。不要把分包與整單定標抄進來。
