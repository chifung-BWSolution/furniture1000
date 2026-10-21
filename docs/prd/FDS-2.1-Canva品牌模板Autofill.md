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
2. 側欄 **Apps → Bulk Create → Labels**，為文字框／圖片設定 **Data field**（名稱須與下表完全一致）。
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

模板可只實作部分欄位；Edge 只會填入 **dataset 內存在的欄位**。

## API 流程（Edge `create_native`）

1. `GET /brand-templates/{id}/dataset` — 取得可填欄位
2. 從 `products` 表載入 session 的 `product_ids`（輕量欄位）
3. `POST /url-asset-uploads` — 產品圖（公開 URL；preview API）
4. `POST /autofills` — `create_from_brand_template` + `data`
5. 輪詢 `GET /autofills/{jobId}` → 取得 `design.id` 與 `urls.edit_url`

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

## 限制（需知）

- Autofill **不會**自動做完整視覺設計；版面由品牌模板決定，FDS 只填入資料。
- 產品圖須為 **可從公網存取的 HTTPS**（Storage 公開或 signed 在有效期內）；否則該格留空或跳過。
- URL 素材上傳為 Canva **preview API**，正式公開 App 審核前可能僅限內部整合使用。
