# FDS 2.1 — Canva 品牌模板 Autofill（T-902）

## 帳戶與方案

- 使用 **`chifung.login`** Connect 整合（與 T-901 相同）。
- **Autofill 與品牌模板**需 Canva **Pro／Teams／Enterprise**（含 Education／Nonprofits）。免費方案無法使用 Autofill API。
- Canva 可能對 Autofill 有 **試用次數**（API 回應可含 `trial_information`）；正式用量以 Canva 帳單為準。

## OAuth Scopes（重新授權必填）

在 [Canva Developer Portal](https://www.canva.dev/) → 你的 Integration → Scopes 啟用並在 FDS 重新連接：

| Scope | 用途 |
|--------|------|
| `design:content:write` | 建立／寫入設計 |
| `design:content:read` | 匯出 PPTX |
| `design:meta:read` | 設計 metadata |
| `brandtemplate:meta:read` | 讀品牌模板列表／metadata |
| `brandtemplate:content:read` | 讀模板 dataset（欄位名） |
| `asset:read` / `asset:write` | 上傳產品圖到 Canva 素材庫 |
| `profile:read` | 顯示連接帳戶名稱（可選） |

前端授權字串已包含上述 scope（見 `src/lib/canvaPresentation.ts` 的 `CANVA_SCOPES`）。

## Edge Secrets

| Secret | 必填 | 說明 |
|--------|------|------|
| `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` | 是 | 既有 |
| `CANVA_BRAND_TEMPLATE_ID` | **T-902 必填** | 已發佈品牌模板 ID（URL 最後一段，如 `AEN3TrQftXo`） |
| `CANVA_AUTOFILL_MAX_PRODUCTS` | 否 | 預設 `12`，對應模板產品欄位數 |

未設定 `CANVA_BRAND_TEMPLATE_ID` 時，建立設計會 **降回 T-901 空白 presentation**（並在 UI 提示）。

## 建立品牌模板（chifung.login）

1. 在 Canva 建立 **16:9 簡報**，含封面、大綱頁、產品頁（可複製多頁）。
2. 側欄 **Apps → Bulk Create → Labels**，為文字框／圖片設定 **Data field**。正式名稱是下表的 `FDS_*`；比對不分大小寫，也接受常見別名（見下節）。
3. **Publish as brand template**，複製模板 ID。
4. 將 ID 填入 Supabase Edge secret `CANVA_BRAND_TEMPLATE_ID`。

### 資料欄位命名（FDS 約定）

| 欄位名 | 類型 | 內容 |
|--------|------|------|
| `FDS_COVER_TITLE` | text | 簡報標題 |
| `FDS_COVER_SUBTITLE` | text | 專案 · 客戶 |
| `FDS_COVER_CLIENT` | text | 客戶名稱 |
| `FDS_COVER_PURPOSE` | text | 匯報目的 |
| `FDS_COVER_DATE` | text | 日期標籤 |
| `FDS_OUTLINE` | text | 完整確認大綱（可選；若無則用分段欄位） |
| `FDS_OUTLINE_1` … `FDS_OUTLINE_5` | text | 大綱分段（長文時） |
| `FDS_PROD_01_TITLE` … `FDS_PROD_12_TITLE` | text | 產品名稱 |
| `FDS_PROD_01_DETAILS` … `FDS_PROD_12_DETAILS` | text | 型號、尺寸、材質、參考價等 |
| `FDS_PROD_01_IMAGE` … `FDS_PROD_12_IMAGE` | **image** | 產品主圖（FDS 以公開 HTTPS URL 上傳至 Canva 素材庫） |

模板可只實作部分欄位；Edge 只會填入 **dataset 內對得上的欄位**。`FDS_*` 是約定的正式名稱。比對時會先把名稱轉成小寫、並把空白與連字號改成底線，因此 `fds_cover_title` 與 `FDS-COVER-TITLE` 都算同一欄。

### 常見別名（仍以 `FDS_*` 為準）

| 正式名稱 | 也接受 |
|----------|--------|
| `FDS_COVER_TITLE` | `title`、`cover_title` |
| `FDS_COVER_SUBTITLE` | `subtitle`、`cover_subtitle` |
| `FDS_COVER_CLIENT` | `client`、`cover_client`、`client_name`、`customer` |
| `FDS_COVER_PURPOSE` | `purpose`、`cover_purpose` |
| `FDS_COVER_DATE` | `date`、`cover_date`、`date_label` |
| `FDS_OUTLINE` | `outline`、`content`、`agenda` |
| `FDS_OUTLINE_1` … `FDS_OUTLINE_5` | `outline_1`、`outline1`（其餘編號同理） |
| `FDS_PROD_01_TITLE` | `prod_01_title`、`product_01_title`、`product_1_title`、`title_01`、`product_01_name` |
| `FDS_PROD_01_DETAILS` | `prod_01_details`、`product_01_details`、`product_1_details`、`details_01`、`product_01_description` |
| `FDS_PROD_01_IMAGE` | `prod_01_image`、`product_01_image`、`product_1_image`、`image_01` |

`title` 只對應封面標題，不會被拿去填產品名稱。產品欄位 02–12 的別名規則與 01 相同。

若文字與圖片都對不上任何欄位，`data` 會是空的。此時 **不呼叫** `POST /autofills`，session 標為失敗，錯誤碼 `brand_template_fields_unmatched`。回應與 `canva_design_sessions.error` 會列出應使用的 `FDS_*` 名稱，以及模板 dataset 裡實際的欄位名。

## API 流程（Edge `create_native`）

1. `GET /brand-templates/{id}/dataset` — 取得可填欄位
2. 從 `products` 表載入 session 的 `product_ids`（`sale_price`／`price`、`dimension_*_mm`、`factories_display_name` 等實際欄位；查詢失敗會寫入 log 與 `populate_report.product_load_error`）
3. 依正式名稱與別名對上 dataset；對不上則回 `422 brand_template_fields_unmatched`，不呼叫 Canva autofill
4. `POST /url-asset-uploads` — 產品圖（公開 URL；preview API）
5. `POST /autofills` — `create_from_brand_template` + `data`（只在 `data` 非空時）
6. 輪詢 `GET /autofills/{jobId}` → 取得 `design.id` 與 `urls.edit_url`

Canva 回非成功時，回應本文會截斷後寫入 `canva_design_sessions.error`，並一併保存 `brand_template_id`。

參考：[Autofill 指引](https://www.canva.dev/docs/connect/autofill-guide/)

## T-903：版本與匯出

- **版本鏈**：`root_id` + `content_version`；「新版本」建立子 session，不覆蓋既有 Canva 設計。
- **匯出審計**：`canva_design_exports` 記錄 PPTX／PDF 匯出（僅 URL，不存檔案）；連結約 24 小時有效。
- **專業 PDF（R5.2）**：`/fds/pm/pro-pdf` 共用 brief 文字，獨立 PDF 渲染，非 Canva 版面。

## 驗收建議

1. 不選產品：確認大綱 → 建立 → Canva 內可見封面與大綱文字  
2. 選產品：圖文出現在對應產品頁  
3. 在 Canva 修改後匯出 PPTX → PowerPoint 可編輯  
4. 新版本不覆蓋舊設計；匯出紀錄可追蹤  
5. 模板欄位完全對不上：畫面顯示中文說明，並列出應使用的 `FDS_*` 與模板實際欄位；不會對 Canva 送出空的 `data`  

## 限制（需知）

- Autofill **不會**自動做完整視覺設計；版面由品牌模板決定，FDS 只填入資料。
- 產品圖須為 **可從公網存取的 HTTPS**（Storage 公開或 signed 在有效期內）；否則該格留空或跳過。
- URL 素材上傳為 Canva **preview API**，正式公開 App 審核前可能僅限內部整合使用。
