# FDS Supplier RFQ 第一期交付狀態

日期：2026-11-11  
對照 PRD：`docs/prd/FDS-Supplier-RFQ-DeepSeek開發交接-PRD.md`（第一期甲＋乙）  
資料庫：只套用到 FDS 2.0 分支 `omxizeukbcqzsnjsuwod`；**Production `riaubhtruisbwdlwjzur` 未套用、未部署**  
說明：本文件分開記錄「本地完成／測試通過／migration 已套（分支）／前端已發布／真實流程已驗收」。沒有勾選＝未完成或未驗收。

---

## 1. 開始前核對（分支）

| 能力 | 現況 |
|---|---|
| `supplier_logins`（email、`factory_id`、`active`） | 表存在；供應商 RLS 只可讀自己的列 |
| `fds_supplier_review_documents` | 存在；admin／uploader 看全部，supplier 只看自己廠，回傳狀態與 `error_message` |
| `fds_supplier_document_create` | **缺口**：一開始就 `bwf_assert_role(['admin','uploader'])`，supplier 上載必被拒 |
| Storage `supplier-documents` insert policy | **缺口**：只准 admin／uploader，supplier 連原檔都上載不到 |
| `FactoryLoginView`（`/fds/factories/login`） | 供應商登入後只看得到自己的文件狀態，**沒有上載介面** |
| `fds_rfq_*` 表 | 查 `information_schema` 為 **0 張**，第一期乙未開始 |
| 測試供應商帳號 | 分支 `supplier_logins` 0 筆、`platform_user_profiles` role=supplier 0 筆 |

---

## 2. 本批（第一期甲：供應商上載權限）2026-11-11

### 修改

- `supabase/migrations/20261111120000_fds24_supplier_upload_permissions.sql`（已套分支）
  - 新增 `fds_supplier_factory_folder()`：只從 `supplier_logins`（`active` 且 email = JWT email）解析 `factory_id`；新增 `fds_supplier_storage_segments()` 回傳原值及前端清洗後的資料夾名。
  - 重寫 `fds_supplier_document_create`：
    - `admin`／`uploader` 行為不變（可指定任何廠家）。
    - `supplier` 只可寫自己的 `factory_id`，不符回 `factory_mismatch`。
    - supplier 的 `storage_path` 第一段必須是自己的廠家資料夾，否則 `storage_path_invalid`；禁止 `..`。
    - supplier 的來源固定為 `upload`，不可自稱 `ai_processor`；廠家名稱以 `supplier_logins` 為準。
  - 重寫 `fds_supplier_document_enqueue_parse`：supplier 只可 enqueue 自己廠的文件；service_role／admin／uploader 不變。
  - Storage：`supplier_documents_objects_insert` 加 supplier 自己資料夾；新增 `supplier_documents_objects_select_supplier`（只讀自己資料夾）。沒有 `USING (true)`。
- `src/lib/supplierDocuments.ts`
  - 錯誤訊息加 `factory_mismatch`、`storage_path_invalid`，`permission_denied` 文字改為包含「你自己的廠家」。
- `src/components/dashboard/FactoryLoginView.tsx`
  - 供應商登入頁新增「上載圖冊／報價單／證書」：PDF、類型（報價單／圖冊／證書）、年份、標題；圖冊另填系列與產品類別；顯示上載進度；完成後重新載入「我的上載」。
  - 只使用自己的 `factoryId`／`factoryName`（來自 `supplier_logins`），沒有可切換廠家的欄位。
- `scripts/test-supplier-upload-permissions.mjs`（新，只打分支；整個交易 rollback）

### 驗證

```
node scripts/apply-migration.mjs supabase/migrations/20261111120000_fds24_supplier_upload_permissions.sql --refs=branch
→ OK fds24_supplier_upload_permissions → omxizeukbcqzsnjsuwod (branch) — schema_migrations rows=1, pgrst reloaded

node scripts/test-supplier-upload-permissions.mjs
→ PASS supplier upload permissions (branch, rolled back)

npx tsc --noEmit   → exit 0
npm run build      → ✓ built in 16.01s（僅既有 chunk 大小警告）
npm run audit:ui   → 0 violations / 0 advisories
```

live 測試實際驗證（以 JWT claims + `set local role authenticated`，全部 rollback）：

1. supplier 用自己 `factory_id` + 自己資料夾 → 建立文件成功。
2. 同一檔案再上載 → `duplicate=true`，沒有第二份。
3. 改用別廠 `factory_id` → `factory_mismatch`。
4. 用自己 `factory_id` 但別廠路徑 → `storage_path_invalid`。
5. supplier enqueue 別廠文件 → `permission_denied`。
6. Storage RLS：supplier 看不到別廠物件，看得到自己物件；可 insert 自己資料夾，insert 別廠資料夾被 RLS 拒絕（42501）。
7. supplier 對自己文件 enqueue → 建立 `parse_pdf` job。
8. designer 呼叫 create → `permission_denied`。
9. admin 可指定任何廠家／路徑（舊行為）。
10. `reset role` 後確認 `processing_jobs` 真的有該 `parse_pdf` job。

### 風險

- 未有供應商測試帳號（分支 0 筆），所以**未做瀏覽器端登入上載驗收**；UI 只經 tsc／build／audit，後端權限經 live SQL 測試。
- 圖冊仍要求系列＋至少一個產品類別（沿用既有 `supplier_documents_catalog_meta_chk`），供應商要在表單填；未放寬既有契約。
- 大於 60MB 的檔案仍走 `needs_split`／Vercel 拆檔，本次未改。
- 沒有改 Production、沒有發任何真實郵件或 Asana 留言。

---

## 3. 2026-11-11 追加：邀請廠家 `permission denied for table supplier_logins`

### 重現

在 `/fds/factories/login` 用 `nerochen1213@gmail.com` 發邀請，edge `invite-supplier` 回：

```
{"error":"permission denied for table supplier_logins"}
```

### 原因

- `supplier_logins` 由 `20261022170000_fds21_supplier_logins.sql` 建立，只 `grant select, update ... to authenticated`。
- 分支 `service_role` 只有 `REFERENCES, TRIGGER, TRUNCATE`，沒有 SELECT／INSERT／UPDATE；edge function 用 service role `upsert` 時被拒。
- Production `riaubhtruisbwdlwjzur` 的 `service_role` 已有 `DELETE, INSERT, SELECT, UPDATE`，所以這是**分支缺少 grant**，不是 function 未部署（兩邊兩個 slug 都是 ACTIVE：分支 v380、Production v387/v401）。

### 修改

- `supabase/migrations/20261111130000_fds24_supplier_login_service_grants.sql`（已套分支）
  - `grant select, insert, update on table public.supplier_logins to service_role;`
  - 不改 RLS、不放寬 anon。
- `src/lib/supplierLogins.ts`
  - `inviteSupplier` 非 2xx 時讀 edge response body，直接把 `{"error": ...}` 顯示給職員，不再只顯示「Edge Function returned a non-2xx status code」。

### 驗證

```
node scripts/apply-migration.mjs supabase/migrations/20261111130000_fds24_supplier_login_service_grants.sql --refs=branch
→ OK fds24_supplier_login_service_grants → omxizeukbcqzsnjsuwod (branch)

-- service_role 模擬 upsert（rollback）
set local role service_role;
insert into public.supplier_logins ... on conflict (email) do update ...
→ {"visible":1}
```

- 兩個 slug 在分支實際 POST `{}` → 400 `{"error":"請填電郵和廠家"}`（function 存在且可達）。
- `nerochen1213@gmail.com` 在分支已有 auth user 及 `role=supplier` profile，重試不會再寄邀請信，會直接寫入 `supplier_logins`。

### 未完成／阻塞

- 未代使用者實際重試（會建立其 `supplier_logins` 並綁定他所選廠家），需在 UI 再按一次。
- 若日後邀請**全新**電郵，function 會真實寄出 Supabase 邀請信；未獲授權不代為發送。
- Production 未套本次 migration（Production 已有 grant，不需要），未部署任何 function。

---

## 4. 2026-11-11 追加：`email rate limit exceeded`（邀請不再代發信）

### 原因

- `invite-supplier` 用 `auth.admin.inviteUserByEmail`，每次都會叫 Supabase Auth 寄邀請信；分支的 email rate limit（每小時 2 封）很快用完。
- 本階段沒有授權向真實供應商發信，所以改為**只產生一次性登入連結**，完全不寄信。

### 修改

- `supabase/functions/invite-supplier/index.ts`（已部署分支兩個 slug）
  - 不再呼叫 `inviteUserByEmail`。
  - 先用 `generateLink({ type: 'invite' })`；若電郵已存在（already registered）改用 `generateLink({ type: 'magiclink' })`。
  - 回應新增 `email_sent: false` 與 `action_link`（只回一次）。
  - 權限、角色檢查、`platform_user_profiles`／`supplier_logins` upsert 不變。
- `src/lib/supplierLogins.ts`：`inviteSupplier` 回傳 `actionLink`；非 2xx 仍會讀 edge body 顯示真實錯誤。
- `src/components/dashboard/FactoryLoginView.tsx`：按鈕改「建立邀請」；成功後顯示唯讀連結＋複製／關閉，文案明示「不會代你發信」。

### 驗證

```
npx supabase functions deploy invite-supplier --project-ref omxizeukbcqzsnjsuwod
npx supabase functions deploy supabase-functions-invite-supplier --project-ref omxizeukbcqzsnjsuwod
→ 兩個 slug 都 Deployed；抓回 /body 含 generateLink、action_link、email_sent
```

以分支 admin session 實際呼叫（測試電郵，非真實收件人）：

```
POST /functions/v1/supabase-functions-invite-supplier
{ email: "fds-invite-check-…@example.invalid", factory_id: "invite-check-factory", ... }
→ 200 { ok:true, already_registered:false, email_sent:false, action_link: 有 }
```

測試後已刪除該測試 auth user、profile、supplier_login（`logins_left=0 / profiles_left=0 / auth_left=0`）。

`npx tsc --noEmit` exit 0；`npm run build`、`npm run audit:ui` 通過。

### 未完成

- `nerochen1213@gmail.com` 已有 auth user 及 supplier profile，重試會走 magiclink，回 200 並顯示連結；要在 UI 再按一次才會寫入 `supplier_logins`（綁定你選的廠家）。
- 連結只用一次且會過期；不要把連結貼到公開地方。
- Production 未部署這次 function 改動；Production 仍是寄信版本。

---

### 下一項

1. 在 UI 用 `nerochen1213@gmail.com` 重試邀請，確認回 200 並出現「廠家登入連結」，複製後用該連結登入。
2. 用該帳號登入，完成：上載自己廠 PDF → 見「待審」→ 改請求裡 `factory_id` 被拒 → 退回原因可見。
3. 「我的傢俬」已在 §5 的廠家 Partner Portal 完成。
4. 之後才進第一期乙：`fds_rfq_*` 表與 RPC（封標在 SQL 分支）、內部建立頁、token 回價、按行定標。

---

## 5. 2026-11-11 追加：廠家 Partner Portal（子系統）

### 修改

- 新增 `src/components/supplier/SupplierPortal.tsx`：獨立廠家專區，供應商登入後只見到這個介面，**不再見到**主頁／設計師選傢俬／PM報價／成功案例／傢俬報價及產品管理／網上發布／分析報表／系統設定／客戶專區。
- 選單（參考 QMS Partner Portal，加入圖冊與產品）：
  - 首頁、我的產品、圖冊管理、合規證照、公司資料、登入紀錄、關於 BW
  - **已按要求移除「BW 採購」**
- `AppShell.tsx`：`role=supplier` 時直接回傳 `SupplierPortal`，並把 supplier 一律導向 `/fds/supplier`；停用 currentView → URL 的同步，避免被舊 view 拉走。
- 頁面內容：
  - 首頁：產品／圖冊／待審／證照數量、最近上載。
  - 我的產品：`fds_supplier_my_products`（新 RPC）只回自己廠的型號、名稱、規格、主圖、在售／停產、最新報價年份、自己成本與幣別；不含售價、折扣、毛利、其他廠。
  - 圖冊管理：以列表顯示已上載的圖冊／報價單／證書與審核狀態；列表右上「上載文件」開啟 `Modal` 上載（沿用 `fds_supplier_document_create`）。
  - 合規證照：參考 QMS 的文件卡版面。**傢俬廠家的證照以 FDS 上載為來源**（`supplier_documents.doc_type='certificate'`，顯示待審核／已通過／退回），因為 PMS 的 BR／勞保在 `suppliers` 主檔，而傢俬廠家在 `factories`，兩者沒有對應。若日後把廠家綁定到 PMS `suppliers.id`，同一頁會改讀 `supplier_files`（類型、編號、簽發機構、到期日、有效／已過期）。頁面有「上載證書」連到圖冊管理。
  - 已查證：QMS_dev 與 Production 的 `factory_files` 都是 0 筆；`supplier_files` 沒有任何向氏／QXS 記錄。
  - 公司資料：參考 QMS 版面。頁首大字顯示真實廠家名＋英文名，下面用「公司身份／聯絡資料／其他資料」三組卡片（代碼、狀態、合作起始、聯絡人、電話、電郵、網站、地區、項目數、備註），資料即時讀 PMS `factories`，只讀。
  - 關於 BW：重用客戶專區的 `CustomerCompanyInfoView`（公司資料）。新增 `embedded` 模式：供應商頁不再套客戶專區的 `PortalPageShell`，避免「關於 BW → 公司資料 Client Portal」兩層標題、雙重 padding 與灰色底。
  - 登入紀錄：未有資料來源，明確顯示未提供，不造假。
- `src/lib/supplierPortal.ts`：呼叫 edge `supplier-company`。
- `supabase/functions/supplier-company/index.ts`（新，已部署分支兩個 slug）：用登入者 JWT 經 `fds_supplier_factory_folder()` 取得廠家，再用 PMS service role 讀 `factories`；合規文件用 `suppliers.display_name = factories.display_name` 精確配對，配不到回 `linked:false`，不做模糊猜測。
- `supabase/migrations/20261111140000_fds24_supplier_my_products.sql`、`20261111150000_fds24_supplier_factory_code.sql`（已套分支）：`supplier_logins.factory_code`＋`fds_supplier_my_products`。
- 邀請流程加入 `factory_code`，新綁定的廠家可直接用代碼（例如 QXS）對產品。
- **只用真實廠家名稱（2026-11-11）**：PMS `factories.display_name` 是內部排序名（例如 `1.向氏 QXS`），供應商介面一律改用 `factories.factory_name`（向氏）、英文名與 `factory_code`（QXS）；標題列、首頁「你的廠家」、公司資料都不再顯示內部排序名或 UUID。`invite-supplier` 寫入 `supplier_logins` 時亦改存真實名稱與代碼。

### 驗證

```
node scripts/apply-migration.mjs ...20261111140000... --refs=branch   → OK
node scripts/apply-migration.mjs ...20261111150000... --refs=branch   → OK

-- 以 nerochen1213@gmail.com 的 supplier 身分（JWT claims 模擬，rollback）
select public.fds_supplier_my_products();
→ 200 個產品；回傳 key 只有 model/title/specifications/image_url/status/in_stock/cost_price/currency/latest_quote_year
→ 沒有 price / sale_price / compare_at_price / factory_id

npx supabase functions deploy supplier-company / supabase-functions-supplier-company
→ 兩個 slug 都 Deployed；抓回 /body 含 factories、supplier_files、compliance

npx tsc --noEmit → exit 0
npm run build → ✓ built in 13.63s
npm run audit:ui → 0 violations / 0 advisories

-- supplier-company 重新部署後抓回 /body：含 factory_name、factory_eng_name、factory_code
-- PMS 實測：id b656fd4a… → factory_name「向氏」、factory_eng_name「向氏QXS」、factory_code「QXS」
```

PMS 實際資料（QMS_dev）：`factories` 有 `1.向氏 QXS`（factory_code `QXS`），但 contact_person／phone／email／location 為 null；`suppliers` 沒有同名公司，所以合規證照會顯示「PMS 未連結供應商主檔」，不顯示假證照。

### 修正：看不到既有圖冊（2026-11-11）

- 原因：舊 `supplier_documents.factory_id` 是廠家代碼 `QXS`，而 `supplier_logins.factory_id` 是 PMS UUID；`fds_supplier_review_documents` 只比對 UUID，所以供應商看到 0 份。
- 修正（migration `20261111160000`、`170000`，已套分支）：
  - `fds_supplier_factory_identifiers()` 回傳 UUID、`factory_code`、`factory_name`、去掉前置數字的名称，以及名稱最後一段的 ASCII 代碼（`1.向氏 QXS` → `QXS`）。
  - `fds_supplier_review_documents` 以 `factory_id` 或 `factory_name` 對任何 identifier 匹配。
  - 新上載沿用代碼（有 `factory_code` 時）與歷史資料一致；Storage 資料夾同時接受 UUID 與代碼。
  - 圖冊管理同時列出 `catalog`、`price_list`、`quote`，並顯示文件類型。
- 實測（supplier JWT claims，rollback）：identifiers = `[UUID, 1.向氏 QXS, 向氏 QXS, QXS]`；文件 9 份，其中圖冊 1 份。

### 未完成／阻塞

- **未做瀏覽器登入驗收**：分支 Auth Site URL 是 `www.bwteam-furniture.com`，allow list 沒有 localhost，magic link 不會回到本機；沒有供應商密碼可用。需要在已部署的 develop 預覽或用戶本人登入後驗收。
- PMS 合規文件只按精確公司名稱配對；PMS 現時沒有 `factories` ↔ `suppliers` 的鍵，需 Leo／PMS 確認正式對應規則。
- `factory_files` 存在但沒有類型／到期日，未使用。
- 產品 200 筆上限（RPC 上限 500）；未做分頁。
- Production 未部署、未套 migration。

### 下一項

1. 用供應商帳號在 develop 預覽登入，核對：只有廠家選單、我的產品 200 筆、圖冊上載→待審、公司資料讀 PMS、合規顯示未連結、關於 BW 與客戶專區一致。
2. 向 PMS 確認 `factories` ↔ `suppliers` 對應後，才把合規證照接上正式文件與簽名下載。

---

## 6. 2026-11-16：第一期乙 RFQ（表、RPC、內部頁、連結回價、按行定標）

### 修改／新增

- `supabase/migrations/20261116120000_fds25_rfq_schema.sql`（已套分支）
  - `fds_rfq_number_seq`、`fds_rfqs`、`fds_rfq_items`、`fds_rfq_invitations`、`fds_rfq_invitation_tokens`、`fds_rfq_submissions`、`fds_rfq_submission_items`、`fds_rfq_awards`、`fds_rfq_events`。
  - 行帶 `revision`：發布時 0 → 1；修訂新增一整組行，舊行留給舊回價／舊定標。
  - 邀請、token、回價版本、專案價快照都分開存；同一行只有一個 `active` 定標（partial unique index）。
  - 全部表開 RLS，`revoke all` 給 anon／authenticated；只留 `service_role`，讀寫走 SECURITY DEFINER RPC。
  - `fds_rfq_effective_status`（截止後視為 `review`）、`fds_rfq_is_revealed`、`fds_rfq_hash_token`（SHA-256）、`fds_rfq_token_context`（有效期／作廢／修訂／取消檢查）。
- `supabase/migrations/20261116130000_fds25_rfq_rpc.sql`（已套分支）
  - 建立／改草稿、發布、修訂、只加廠、產生連結、內部詳情、提前揭標、取消、重開行、按行定標／不定標。
  - 連結頁：開啟、提交、撤回；只認 token 對應那家廠。
  - 封標在 SQL 分支：未揭標的內部詳情不組 `unit_price`／`total_amount`，只回提交數與已報行數；歷史目錄價另用 `catalog_price` 回。
  - 冪等鍵以邀請為範圍：同一家廠同一冪等鍵只回同一回執；空白＝不報價、0 是有效價、負數拒絕。
  - 截止前即使所有行已定標，仍可提交新版本；已定標的行不會自動改判（2026-11-16 瀏覽器驗收時發現並修正）。
- `src/lib/rfq.ts`（新）：型別、RPC 包裝、穩定錯誤碼映射、香港時間／金額格式。
- `src/components/dashboard/RfqListView.tsx`（新）：`/fds/procurement/rfqs`，狀態篩選與進度欄。
- `src/components/dashboard/RfqEditorView.tsx`（新）：標題、幣別、截止、備註、項目（手填／報價行／產品目錄）、受邀廠家；草稿與修訂共用。
- `src/components/dashboard/RfqQuotePickerModal.tsx`（新）：從 `bwf_quote` 版本加入行；只複製名稱、型號、數量、單位、尺寸、規格、參考圖。
- `src/components/dashboard/RfqDetailView.tsx`（新）：詳情、複製連結、只加一家廠（不升修訂）、封標提示、比價矩陣、按行定標／不定標／重開、提前揭標、取消、事件紀錄。
- `src/components/rfq/RfqInvitePage.tsx`（新）：公開頁 `/rfq/invite/:token`，不要求登入；只顯示該廠的項目與自己的回價，表單暫存在瀏覽器，提交後有回執碼，截止前可撤回／再交新版本。
- 路由／選單：
  - `ViewType` 新增 `fds2-procurement-rfqs`、`fds2-procurement-rfq-new`、`fds2-procurement-rfq-detail`。
  - 新主選單「採購」，只給 `admin`／`uploader`／`pm`；`designer`／`client` 不見選單。
  - `appSectionRoutes.ts` 新增 `/fds/procurement/rfqs`、`/new`、`/:id`；`AppShell` 保留詳情 URL，不把它拉回列表。
  - `App.tsx` 新增公開路由 `/rfq/invite/:token`。
- `scripts/test-rfq-flow.mjs`（新，只打分支；整個交易 rollback）

### 驗證

```
node scripts/apply-migration.mjs supabase/migrations/20261116120000_fds25_rfq_schema.sql --refs=branch
→ OK fds25_rfq_schema → omxizeukbcqzsnjsuwod (branch)

node scripts/apply-migration.mjs supabase/migrations/20261116130000_fds25_rfq_rpc.sql --refs=branch
→ OK fds25_rfq_rpc → omxizeukbcqzsnjsuwod (branch)

node scripts/test-rfq-flow.mjs
→ PASS supplier RFQ flow (branch, rolled back)
```

`test-rfq-flow.mjs` 以 JWT claims 模擬 pm／admin／designer／anon，實際驗證：

1. 草稿可改幣別；發布後 `save_draft` 被拒，改幣別回 `currency_locked`。
2. 發布缺截止／項目／受邀廠分別回 `close_required`／`items_required`／`invitation_required`。
3. 封標詳情 JSON 沒有 `unit_price`／`total_amount`；歷史目錄價仍在（`catalog_price`）。
4. 未揭標定標回 `sealed`；pm 重開行回 `permission_denied`；designer 讀詳情回 `permission_denied`。
5. 0 成功提交並存成 0；空白／只有「不報價」回 `empty_submission`；負數回 `negative_price`。
6. 同一冪等鍵重試回同一回執與版本，沒有第二個版本。
7. A 廠 token 看不到 B 廠資料；B 廠的 987654 不會出現在 A 的 JSON。
8. 一行定 A、一行定 B、第三行不定標；三行都結束後表頭才變 `awarded`。
9. 定標前後 `supplier_prices` 與 `bwf_quote_item` 行數不變。
10. 取消後 token 打不開、提交被拒；專案價仍以 `cancelled` 保留。
11. 重開行回 `open`，事件有 `line_reopened`；可再定給另一家的最新版本。
12. 修訂升 R2，舊 token 失效，舊提交留在 history 但不能定標；新連結可以提交。
13. 所有行已定標但截止未到，連結頁仍可提交新版本，原定標不變。

瀏覽器實測（develop 本機、quick login、分支庫）：

- 選單出現「採購」；列表空狀態正常；建立草稿 → 儲存並發布 → 詳情頁正常。
- 產生連結、在另一個 tab 打開公開頁、提交 CNY 100 → 回執 `R-...-V1-...`。
- 內部提前揭標 → 見到 CNY 100.00 → 按行定標 → 表頭「已定標」、行顯示得標與專案價快照。
- 公開頁重新載入見到「已得標」；修正提交閘門後，截止前仍可提交新版本。
- 測試用 RFQ 已刪除（`fds_rfqs`、items、submissions 均為 0；年度流水已重設），沒有留下測試資料。

```
npx tsc --noEmit   → exit 0
npm run build      → ✓ built（僅既有 chunk 大小警告）
npm run audit:ui   → 0 violations / 0 advisories
```

### 未完成／限制

- Production `riaubhtruisbwdlwjzur` 未套 migration、未部署；本次只做分支。
- 沒有代發任何邀請信或 WhatsApp；連結只回給職員複製。
- 公開頁的「替代型號」只收文字；未接供應商自己的 `product_id` 選擇器（登入後的 Partner Portal 才知自己產品）。
- 未做邀請信版面、提醒、澄清問答、證書過期閘門、升目錄價、寫回報價成本（PRD 第二期）。
- `supplier_prices` 的歷史目錄價按 `product_id` 與受邀廠讀取；手填行沒有歷史價。
- 未做分頁；列表上限 300 張、歷史目錄價上限 500 筆。
- 公開連結頁的草稿只存在該瀏覽器 `localStorage`；換裝置要重新填，提交後以回執碼為準。
- 只加廠的 UI 按鈕已在本機瀏覽器確認會顯示（只加一家廠、不升 revision）；實際加入仍走 `fds_rfq_invite_factory`，由 `test-rfq-flow.mjs` 驗證。
- 整張取消後依 PRD 7.4 令 token 失效（`token_invalid`），供應商不會看到「整張已取消」的只讀頁；若日後要改成只讀顯示，需調整 `fds_rfq_token_context` 與公開頁。

### 下一項

1. 在 develop 預覽用真實 pm／admin 帳號再走一次：建立 → 發布 → 廠家回價 → 揭標 → 按行定標 → 取消／重開。
2. 用真實供應商帳號（`nerochen1213@gmail.com` 或新邀請）測公開頁：只看到自己廠、提交、撤回、再交新版本。
3. 與傢俬組確認「不定標」與「重開」原因文案，以及是否要在事件紀錄顯示更多操作者資料。
4. 確認 Production 上線窗口後，才把 `20261116120000`、`20261116130000` 套到 Production；不要把測試資料帶過去。

