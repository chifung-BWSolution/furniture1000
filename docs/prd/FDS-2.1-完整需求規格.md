# FDS 2.1 完整需求規格（Furniture Intelligence Platform）

最後更新：2026-10-19

> **文件定位**：本文件是 FDS 2.0 的**擴展合併版**，而非取代。FDS 2.0 全部業務需求、角色、流程與權限**原樣保留**；本文件只新增 AI 能力並記錄整合方式。
> **來源**：
> 1. `docs/prd/FDS-2.0-需求規格.md`（會議轉寫 ＋ 新版 Sitemap）
> 2. `docs/prd/設計師選傢俬-PRD.md`（設計師逐頁需求 D-1～D-8）
> 3. `docs/prd/furniture-1000-overview.md`（現有模組）
> 4. 本倉庫實際程式碼與資料庫 migration（專案 `riaubhtruisbwdlwjzur` 為 Furniture；`kqwktnplkqucsbasyfjl` 為 PMS/Master）
> 5. FDS 2.1 需求整合指令（AI 功能 F-AI-001～F-AI-009）
>
> **關聯文件**：
> - `docs/prd/FDS-2.0-to-2.1-需求差異.md`（差異矩陣）
> - `docs/prd/FDS-2.1-技術架構.md`（架構與資料結構）
> - `docs/prd/FDS-2.1-開發計劃.md`（10 日開發任務）
>
> **重要聲明**：本文件區分「**已確認需求**」「**技術建議**」「**待確認事項**」。凡標示「建議」「待確認」者，**不可視為已核准的業務規則**。

---

## 1. 產品定位與目標

### 1.1 定位

**Furniture Intelligence Platform — 家具智能採購與設計平台**：在現有 FDS 2.0 之上，整合家具產品資料、供應商報價、AI 搜索、3D 建模及商務演示，讓 PM 更有效率完成選型、成本查詢與方案製作。

### 1.2 核心業務目標（新增）

| 編號 | 目標 | 對應需求 |
|---|---|---|
| G-01 | 把不同供應商 PDF 報價單轉成標準化家具資料庫 | F-AI-001、F-AI-002、F-AI-003 |
| G-02 | 讓 PM 快速搜索家具產品、圖片、尺寸及報價 | F-AI-005 |
| G-03 | 支援上傳家具圖片查找相似款及供應商報價 | F-AI-006 |
| G-04 | 保留歷史價格、來源文件及原 PDF 頁碼 | F-AI-003、F-AI-007 |
| G-05 | 支援不同供應商相似家具報價比較 | F-AI-007 |
| G-06 | 用 AI 將家具設計圖轉成可編輯 SketchUp 模型 | F-AI-008 |
| G-07 | 用產品／圖片／報價自動生成 Canva PPT | F-AI-009 |
| G-08 | 避免重複錄入，各模組共用統一產品資料 | F-PLT-003 |

### 1.3 與 FDS 2.0 的關係（不變項）

- FDS 2.0 的 **R1～R6.5** 全部保留（QR／版本／通知／分區／搜尋優化／廠家互動／PM 快速報價／系統開放／電郵記錄）。
- 設計師逐頁需求 **D-1～D-8** 保留（產品類型、產品PDF、常用傢俬、最新產品、SU模型、3D模型、愛心小工具、開放權限）。
- 本文新增需求**只以 F-AI-* 與 F-PLT-* 編號**，不重新編號既有需求。
- 若新需求與 2.0 有衝突 → 見第 12 節及差異矩陣文件。

---

## 2. 系統角色

沿用 FDS 2.0 定義，**不新增角色**。

| 角色 | DB `platform_user_profiles.role` | 前端口徑 `usePlatformRole` | 本文件相關能力 |
|---|---|---|---|
| 系統管理員 | `admin` | `admin` | 全部；唯一可經 RPC 讀寫開發成本 |
| 上載同事 | `uploader` | `staff` | 產品／PDF 上載、審核 AI 提取 |
| 項目經理 | `pm` | `staff` | 搜索、查價、比較、產生 PDF／簡報 |
| 設計師 | `designer` | `staff` | 搜索、模型、內部訂單（D-8） |
| 客戶 | `client` | `client` | 客戶專區；**不可見**供應商成本／原始文件 |
| 廠家（供應商） | **新增 `supplier`** | — | **已決議：新增 supplier 登入，自助上載先入審核佇列（傢俬組審核）** |

> **現況事實**：`src/hooks/use-platform-role.ts` 只把角色折疊成 `admin | staff | client`；前端菜單目前只有「admin／非 admin」兩層（`navConfig.ts` 的 `adminOnly` / `ADMIN_ONLY_VIEWS`）。真正以 `admin` 強制授權的只有開發成本 RPC（`bwf_assert_platform_admin()`）。**新增商業資料（成本、原始 PDF）需要收緊 RLS，這是一項新增需求（F-PLT-002）。**

---

## 3. 範圍與界線

### 3.1 本期範圍（FDS 2.1 In-Scope）

- F-AI-001 供應商及報價 PDF 管理
- F-AI-002 AI PDF 解析與資料結構化
- F-AI-003 標準家具產品資料庫（在既有 products/product_category 上擴展）
- F-AI-004 家具圖片抽取與匹配
- F-AI-005 家具報價智能搜索
- F-AI-006 以圖搜款（P1）
- F-AI-007 多供應商報價比較（P1）
- F-AI-008 AI SketchUp 建模（P2，PoC）
- F-AI-009 Canva PPT（P2）
- F-PLT-001～005 平台基礎（任務佇列、權限、資料模型分離、儲存、向量）

### 3.2 非本期範圍（Out-of-Scope）

- 取代或重寫既有報價、產品發布、Shopify 同步流程。
- 高精度生產級 3D 建模（沙發、辦公椅、複雜曲面）。
- 大量歷史資料一次性導入（另立項目，見第 13 節）。
- 客戶端直接使用 AI 搜索／以圖搜款（首版只開放內部）。

---

## 4. 現有功能（FDS 2.0 基線，實測）

下表為**程式碼確認**的現況，是新需求的整合基礎。**不得假設這些模組不存在而另建重複結構。**

### 4.1 產品／供應商

| 實體 | 位置 | 現況 |
|---|---|---|
| 供應商（廠家） | **外部 PMS/Master 專案 `kqwktnplkqucsbasyfjl`** 的 `factories` 表 | Furniture DB **沒有** factories/supplier 表；經 edge `fetch-factories`、`fetch-manufacturer-directory` 讀取 |
| 廠家糾錯規則 | Furniture `factory_correction_patterns` | 本地，AI 上載時記錄廠家欄位修正 |
| B 類產品 | Furniture `products`（產品目錄） | ~3,000–4,000 款；欄位含 model、color、material、dimension_*_mm、in_stock、customize、level1/2_category、product_category_id、cost_price、sale_price |
| A 類產品 | Furniture `shopify_products` ＋ `ready_to_shopify` | ~800 款已上網站 |
| 產品主檔鏡像 | 外部 master `bwf_product_master` | 由 `products.bwf_master_id` 關聯 |
| 產品分類 | Furniture `product_category`（level1/level2） | 有 trigger 同步到 products.level1/2_category |
| 廠家產品圖 | Storage bucket **`product-images`**（唯一） | 只存裁切後的產品圖，**不存來源 PDF** |

> **A/B 分類是隱性的**：靠「在 shopify_products / ready_to_shopify」＝A，否則＝B。**無 `product_class` 欄位。**

### 4.2 報價與分區

| 實體 | 現況 |
|---|---|
| 報價 header | `bwf_quote`（`quote_id`＝PMS pitching code 為版本鏈鍵；`version` v1/v2…；`total_amount`、`cost_price`、`exchange_rate`、`hkd_cost_price`、`bwf_pitching_id`、`bwf_project_id`、`project_data` jsonb） |
| 報價明細 | `bwf_quote_item`（`unit_price`、`quantity`、`cost_price`、`hkd_cost_price`、`is_optional`、**`is_section_title`**、`dimension_*_mm`(text)、`sku`、`hide_in_pdf`、**`product_id`**、**`product_category_id`**） |
| 版本控制 | 同一 `quote_id` 多個不可變 `bwf_quote` 列（`version`），**無獨立版本表**；由前端 `persistBwfQuote.ts` 驅動 |
| 明細儲存 | RPC `save_bwf_quote_items(quote_uuid, items)`，**replace-all 語意** |
| 分區 | `design_projects` ＋ **`project_zones`** ＋ **`zone_products`**（含 `zone_products.notes`、`dimension_*_mm`）；客戶方案頁把 zone 轉成報價 `is_section_title` 列 |
| 分享連結 | `bwf_quote_share_links`（`share_token`、`status`、`last_viewed_at`）→ 客戶專區 |
| GP／成本 | **無 GP 欄位**；前端計算 `gpValue = total − 產品成本 − 運費 − 安裝`；`project_data.gpSummary`、`priceMultiplier` |

### 4.3 AI／檔案／背景任務

| 能力 | 現況 |
|---|---|
| PDF 產品抽取 | `AIProcessorView.tsx` ＋ edge `gemini-pdf-catalog`（Gemini `gemini-2.5-flash`）：瀏覽器 pdfjs 渲染 → 逐頁送入 → 回 bounding box → 前端裁圖 → 只存裁切圖 |
| Excel 產品抽取 | edge `gemini-excel-catalog` |
| 圖片相似匹配 | edge `visual-match-images`：**Gemini 視覺評分 0–100（非向量）**，門檻 70／75 |
| 通用 AI 代理 | edge `gemini-proxy` |
| 原文 PDF | **完全不持久化**（`AIProcessorView` 用完即棄） |
| 圖床 | 只有 bucket `product-images`（`products/…`、`quotes/…`、`design-projects/…`） |
| 背景任務 | 只有 `pg_cron` ＋ `pg_net` → edge function；**無通用 job/queue 表**；**無 Python worker／容器** |
| 向量 | **未啟用 pgvector**；無 embedding 欄位 |
| 電郵 | edge `send-upload-log-report-email`（Resend 優先，Gmail SMTP fallback）；唯一 daily cron 已 unschedule |

### 4.4 前端

Vite + React + TypeScript + Tailwind + Radix；狀態用 `zustand`（無 react-query）；資料存取＝**直接 `.from()` / `.rpc()` 為主**，`supabase.functions.invoke()` 用於特權副作用；報價 PDF 用 `@react-pdf/renderer`（前端生成）；`pdfjs-dist` 只讀；**無 PPTX 與 3D 函式庫**。

---

## 5. 新增功能需求（F-AI）

> 通用標記：**已確認**＝指令／會議明確要求；**技術建議**＝本文件提出之實作方向；**待確認**＝需產品負責人拍板。

### F-AI-001 供應商及報價 PDF 管理 — P0

**目標**：建立統一的供應商報價文件管理能力。

**現況與整合**：
- 供應商主數據**已在外部 PMS**（`factories`），**不可在 Furniture 另建重複的 supplier 表**（違反整合要求）。
- Furniture 本地**完全沒有**文件/附件表，來源 PDF 從不保存 → **需新增文件表與儲存**。
- 上載入口可復用 `AIProcessorView`（現映射 `fds2-factory-upload`／`fds2-products-quote-pdf`）與 `fds2-designer-pdf`。

**功能要求（已確認）**：
1. 新增／修改／查看／停用供應商 → **建議以「本地延伸表 + PMS 主檔」方式**：Furniture 記 `factory_id`、`factory_name`，顯示資料仍由 `fetch-manufacturer-directory` 提供。
2. 供應商名稱、聯絡資料、地區、報價貨幣（PMS 已有 contact_person/phone/location；**報價貨幣為新增欄位**）。
3. 上傳 PDF 報價文件。
4. 支援大型 PDF（目標 100～200 頁、數十 MB）。
5. 文件版本、上傳時間、處理狀態。
6. 重新解析失敗文件。
7. **保存原始文件**（FDS 2.0 現況會丟棄 PDF → 新增）。
8. 同一供應商可有多份不同日期報價文件。

**操作流程**：
```
選擇／新增供應商 → 上傳 PDF → 建立 supplier_document（status=uploaded）
→ 建立解析任務（processing_jobs）→ 逐頁解析（見 F-AI-002）
→ 文件狀態 updated（parsing→review→done/failed）→ 可「重新解析」
```

**資料結構（技術建議，見技術架構文件）**：
- `supplier_documents`：`id`、`factory_id`、`factory_name`、`doc_type`(quote/catalog)、`title`、`storage_path`、`page_count`、`file_size`、`currency`、`status`(uploaded/parsing/review/ready/failed)、`uploaded_by`、`created_at`。
- 原始 PDF 存入**新 bucket `supplier-documents`（私有）**，不與 `product-images` 混用。

**驗收標準**：
- AC-001-1：可為同一 `factory_id` 上傳多份不同日期 PDF，各自獨立記錄與狀態。
- AC-001-2：100～200 頁 PDF 可成功上傳並建立任務。
- AC-001-3：刪除/更新衍生資料後，原始 PDF 仍可下載。
- AC-001-4：失敗文件可一鍵重新解析。

**Given / When / Then**：
| # | Given | When | Then |
|---|---|---|---|
| 1 | 已選定供應商 F | 上傳一份 120 頁 PDF | 建立 `supplier_documents` 一列，status=parsing，任務入列 |
| 2 | 文件解析失敗 | 使用者按「重新解析」 | 新建任務、保留原檔、舊錯誤可追溯 |
| 3 | 同一供應商已有 2 份報價 | 再上傳第 3 份 | 三份並存，不互相覆蓋 |

**衝突**：與 FDS 2.0 無衝突；屬**擴充**。與設計師 PRD D-2（PDF 持久化）**目標一致**，應共用同一 documents 結構。

---

### F-AI-002 AI PDF 解析與資料結構化 — P0

**目標**：把 PDF 報價轉為經校驗的標準化 JSON。

**現況與整合**：
- **部分存在**：`gemini-pdf-catalog` 已能逐頁抽產品＋bbox＋裁圖。
- **缺口**：無 OCR 分流（掃描型未處理）、無「目錄／產品／報價表／條款」頁面分類、無跨頁關係保護、無 Schema 驗證落地、無低置信度審核工作流、無任務佇列與重試、原文不保存。

**處理流程（已確認，對應指令流程圖）**：
```
PDF 上傳 → 建立解析任務 → 逐頁分析 → 頁面分類（目錄/產品/報價表/條款）
→ 文字型 vs 掃描型分流（文字表格提取 ｜ OCR + VLM）
→ 識別產品/圖片/價格關係 → AI 生成標準化 JSON → 欄位與價格校驗
→ 低置信度人工審核 → 寫入產品庫 → 建立搜索索引
```

**核心要求（已確認）**：
1. 分批處理 ＋ 有限度並行。
2. **不按固定頁數切割以致破壞跨頁產品關係**（現行 `PAGES_PER_BATCH=1` 需改為語意分段）。
3. 提取名稱、型號、尺寸、材質、分類、圖片、價格。
4. 識別報價貨幣、計價單位、MOQ、有效期。
5. 保留文件與**原始頁碼**。
6. 若可得版面座標，保存 **Bounding Box**。
7. 結果須經 **Schema 驗證**（建議以 zod/JSON Schema）。
8. 低置信度與異常 → **人工審核**。
9. AI 原始結果與人工修正**可追溯**。
10. **未驗證的 AI 價格不得視為正式核准價格**。

> **已決議（2026-10-19）**：OCR 方案 **可用 Grok（xAI）**；人工審核 **由傢俬組負責**（對應 `uploader` 流程角色），支援批次審核。

**資料結構（技術建議）**：
- `extraction_jobs`（或通用 `processing_jobs`）：任務狀態、進度、重試、token、頁數、成本。
- `extraction_items`（staging）：`job_id`、`document_id`、`page_no`、`bbox`、`raw_json`、`confidence`、`status`(pending/approved/rejected)、`reviewed_by`。
- 審核通過才寫入 `products` / `supplier_prices`。

**驗收標準**：
- AC-002-1：至少 5～10 份不同版式真實 PDF 完成測試。
- AC-002-2：文字型與掃描型皆可處理，輸出符合 Schema。
- AC-002-3：低置信度列進入審核佇列，未審核不得成為正式價格。
- AC-002-4：每筆資料保留 `document_id` ＋ `page_no`（＋bbox 如可得）。

**Given / When / Then**：
| # | Given | When | Then |
|---|---|---|---|
| 1 | 一份 200 頁文字型 PDF | 啟動解析 | 產生分批任務，最終輸出 JSON 並通過 Schema |
| 2 | 一份掃描型 PDF | 啟動解析 | 走 OCR＋VLM 路徑，頁面文字可提取 |
| 3 | AI 抽出價格信心度 < 門檻 | 進入審核 | 該筆標記 pending，不寫入正式價 |
| 4 | 一個跨頁報價表 | 解析 | 不因分頁而拆散同一產品關係 |
| 5 | 審核員修正欄位 | 儲存 | 保留原始 AI 值與修正值 |

**衝突**：FDS 2.0 R3.1「AI 自動切割 PDF 分頁／分區」與本需求**重疊**；合併為同一解析管線（見差異矩陣 C-02）。

---

### F-AI-003 標準家具產品資料庫 — P0

**目標**：建立全模組共用的家具產品資料，且**產品身份 / 規格 / 供應商報價分離**。

**現況與整合**：
- 產品主體**已存在**：`products`、`shopify_products`、`ready_to_shopify`、`product_category`、外部 `bwf_product_master`。
- **缺口**：現行 `products.cost_price` / `sale_price` 把「產品」與「單一供應商價格」混在同一列；**無價格歷史、無來源溯源、無多供應商報價**。
- **不新增重複產品表**：以 `products` 為產品身份主檔，新增周邊表。

**建議資料實體 → 對應既有 / 新增**（技術建議）：

| 指令建議實體 | 落點 | 狀態 |
|---|---|---|
| Suppliers | 外部 PMS `factories`（唯讀） | 已有（外部） |
| Documents | `supplier_documents`（新） | 新增 |
| Products | `products` / `shopify_products` | 已有 |
| Product Variants | 現以 `products` 列＋`variants` jsonb 表達 | 需評估 |
| Product Images | `products.images` ＋ `product-images` bucket | 已有，需擴 |
| Supplier Prices | `supplier_prices`（新） | 新增 |
| Price History | `supplier_prices` append-only（＋`price_history` 視需要） | 新增 |
| Source References | `product_source_refs`（新） | 新增 |
| Processing Jobs | `processing_jobs`（新） | 新增 |
| Extraction Reviews | `extraction_items.status/reviewed_by`（新） | 新增 |
| Search Embeddings | `search_embeddings`（新，pgvector） | 新增 |

**產品欄位**（指令建議清單 → 現況對照）：產品 ID、原廠型號(`model`)、中英名稱、分類(`product_category`)、品牌/供應商(`factory_id/name`)、尺寸(W/D/H → `dimension_l/w/h_mm`)、材質(`material`)、顏色(`color`)、規格/可選配置、主圖、詳細圖、**當前有效報價(新)**、**報價貨幣(新)**、**計價單位(新)**、**價格有效期(新)**、**原始 PDF(新)**、**原始頁碼(新)**、建立/更新時間。

**特別要求（已確認）**：
- 產品身份、產品規格、供應商報價**分開管理**。
- **不得**以單一產品 ID 覆蓋不同規格／供應商／日期的報價。
- **已決議（2026-10-19）**：產品身份鍵＝**型號 ＋ 供應商**；同型號不同供應商視為**不同產品**，另建「相似關聯」。報價貨幣**人工為主、AI 建議**；價格有效期未標示時**留空並標「未標示」**。

**驗收標準**：
- AC-003-1：同一產品可掛多個供應商報價且互不覆蓋。
- AC-003-2：價格有有效期與來源（文件＋頁碼）。
- AC-003-3：新增 AI 產品不與既有 `products` 重複建表；沿用 `product_category`。

**Given / When / Then**：
| # | Given | When | Then |
|---|---|---|---|
| 1 | 產品 P 已有供應商甲報價 | 解析出供應商乙報價 | 新增 `supplier_prices` 列，P 原有資料不變 |
| 2 | 供應商甲新舊兩份報價 | 匯入新價 | 舊價保留為歷史，新價為當前有效 |
| 3 | 同一型號不同材質 | 建立產品 | 以規格／variant 區分，不互相覆蓋 |

---

### F-AI-004 家具圖片抽取與匹配 — P0

**目標**：圖片與 PDF 文字／價格**同步**處理，並建立圖片—產品關聯。

**現況與整合**：
- **部分存在**：`gemini-pdf-catalog` ＋ `AIProcessorView` 已能裁切產品圖並上傳 `product-images`。
- **缺口**：無圖片**類型分類**（主圖/細節/尺寸圖/面料/Logo）、無與價格同步關聯、無去重、無人工重新指定、無 embedding 基礎。

**功能要求（已確認）**：抽取/裁切產品圖；自動識別圖片類型；區分主圖/細節/尺寸/面料/Logo；自動關聯產品；一產品多圖；人工重新指定；保留頁碼與來源位置；縮圖＋原圖；避免重複佔用 Storage；為圖片向量搜索奠基。

**資料結構（技術建議）**：
- 沿用 `products.image_url` / `images jsonb`（`{src, position, alt}`）＋ bucket `product-images`。
- 新增 `product_image_assets`（`product_id`、`image_type`、`storage_path`、`thumb_path`、`document_id`、`page_no`、`bbox`、`hash`、`embedding_id`）。

**驗收標準**：主要產品圖正確關聯，錯誤可人工修正；重複圖不重複佔用 Storage。

**Given / When / Then**：
| # | Given | When | Then |
|---|---|---|---|
| 1 | 一頁含主圖＋Logo＋尺寸圖 | 解析 | 主圖關聯產品，Logo 不誤植為主圖 |
| 2 | 圖片裁切錯誤 | 人工重新指定 | 關聯更新，原裁切可回溯 |
| 3 | 同一圖片出現多次 | 匯入 | 以 hash 去重，Storage 只存一份 |

---

### F-AI-005 家具報價智能搜索 — P0

**目標**：PM 快速查找家具與報價。

**現況與整合**：
- **已有**：`productCatalogQuery.ts`（`ilike` 名稱/SKU、factory、level1/2、現貨、A/B 來源，UI `ProductSelectorModal`）。**無全文、無語義、無圖搜**。
- `pg_trgm` 已啟用；PostgREST 可用 `.textSearch()`。

**搜索方式（已確認）**：產品名稱、型號精確、中英關鍵詞、分類、供應商、價格範圍、尺寸/材質、語義、混合排序。
**技術方向（建議）**：PostgreSQL 精確匹配 ＋ Full Text（tsvector/`pg_trgm`）＋ pgvector ＋ 混合排序（RRF）。

**結果必須顯示**：圖片、名稱、型號、尺寸、供應商、報價、幣種、**價格有效狀態**、**原始 PDF 來源**。
**PDF 溯源**：點擊可開原 PDF 對應頁；技術可行時高亮產品／圖片／價格區。

**驗收標準**：
- AC-005-1：能準確找到指定型號與供應商。
- AC-005-2：一般搜索目標 **2 秒**內返回（需實際資料量測試）。
- AC-005-3：可定位價格對應原始文件頁面。

**Given / When / Then**：
| # | Given | When | Then |
|---|---|---|---|
| 1 | 產品有型號 M-123 | 搜尋 M-123 | 精確置頂，顯示供應商與報價 |
| 2 | 輸入「墨綠 梳化」 | 搜尋 | 回傳語義相關結果並附來源頁 |
| 3 | 點擊「來源」 | 開啟 | 打開原 PDF 對應頁（可行時高亮） |

**衝突**：與 FDS 2.0 R3.1／D-1 **重疊**（搜尋強化）→ 合併（差異矩陣 C-03）。成本顯示受 D-8.3 中間價規則約束（C-04）。

---

### F-AI-006 以圖搜款 — P1

**目標**：上傳家具圖片找相似款與供應商報價。

**現況**：`visual-match-images` 已有 LLM 視覺相似度（非向量）。

**流程（已確認）**：上圖 → AI 分析 → Embedding → 向量搜索 → 候選 → 按尺寸/材質/價格篩選 → 查看產品與報價。

**功能要求（已確認）**：JPG/PNG/WebP；相似款；回傳圖/名稱/型號/供應商/價；相似度排序；尺寸/材質/供應商篩選；**明確區分相似款與同型號**；可進產品詳情與原 PDF 來源。

**驗收標準**：返回 Top 5 相似候選；**不得僅憑相似度判定為同一產品**。

**Given / When / Then**：
| # | Given | When | Then |
|---|---|---|---|
| 1 | 上傳一張梳化圖 | 執行以圖搜款 | 回 Top 5 候選，標示「相似」而非「同款」 |
| 2 | 候選含多供應商 | 按價格篩選 | 結果更新並可按相似度排序 |

**首版定位**：不要求完全準確，以提供可供 PM 判斷的候選為目標。

---

### F-AI-007 多供應商報價比較 — P1

**目標**：比較同一／同規格相似產品的不同供應商報價。

**現況與整合**：`bwf_quote_item` 已有 `cost_price`/`hkd_cost_price`/`factory_name`；GP 前端計算。

**功能要求（已確認）**：比較同款/同規格；顯示價/幣/尺寸/材質/計價單位；區分當前 vs 歷史；查看變化；保留來源；跨幣保留原幣與匯率依據；**不自動把最低價當最佳**；若 2.0 已有成本/毛利流程則整合。

**業務規則（已確認）**：AI 提取的供應商報價只是**成本參考**，**未經審核不得影響已確認的正式報價或毛利**。

**驗收標準**：可並列多供應商報價與歷史變化，且原 PDF 可溯。

**Given / When / Then**：
| # | Given | When | Then |
|---|---|---|---|
| 1 | 兩供應商對同款報價 | 開啟比較 | 並列顯示，最低價不被標為「最佳」 |
| 2 | 匯率不同 | 比較 | 保留原幣金額與匯率依據 |

**衝突**：報價流程整合（差異矩陣 C-05）；成本顯示受 D-8.3 約束。

---

### F-AI-008 AI SketchUp 建模 — P2（PoC）

**目標**：由家具圖片／設計圖＋尺寸生成可編輯 **SKP**。

**現況**：倉庫**完全無 3D／SKP**；設計師菜單 `fds2-designer-su`／`fds2-designer-3d` 為 placeholder。

**流程（已確認）**：上圖/設計圖 → AI 識別結構 → 提取尺寸與組件 → 參數化 JSON → **幾何引擎**建模 → **SKP（設計師 SU 下載）** ＋ **GLB（3D 頁瀏覽器預覽）**。

**技術要求（已確認，2026-10-20）**：**不用 OpenSKP，也不用 SketchUp 官方 SDK 做建模。** LLM 只輸出參數；幾何引擎依參數生成組件，並把同一套組件寫成 SKP。設計師 SU 模型的交付檔是 SKP，必須能在 SketchUp 打開、編輯組件、儲存。GLB 只供 3D 頁預覽。支援輸入／確認總寬深高；無可靠尺寸時標示估算。**優先辦公桌／會議桌／書架／儲物櫃**；**沙發／辦公椅／複雜曲面不列入首版承諾**。

**驗收標準**：至少 **兩類簡單家具**可生成 SKP，且能在實際 SketchUp 打開、編輯組件、儲存。

**Given / When / Then**：
| # | Given | When | Then |
|---|---|---|---|
| 1 | 一張辦公桌設計圖＋總尺寸 | 生成模型 | 輸出 SKP，SketchUp 可開且組件可編輯 |
| 2 | 沙發設計圖 | 生成模型 | 明確標示「首版不支援」，不產出不可用模型 |
| 3 | 無可靠尺寸 | 生成 | 標示「估算尺寸」 |

**衝突**：與 D-5／D-6（SU/3D 模型連結，指**上載**的模型）**概念不同**：本項是 **AI 生成**模型，需區分（差異矩陣 C-06）。

---

### F-AI-009 Canva PPT 自動生成 — P2

**目標**：由產品資料、報價、項目內容生成商務演示。

**現況**：倉庫**無 PPTX 函式庫**；`fds2-pm-pro-pdf`（專業說明 PDF）為 placeholder；R5 要求「PDF 或 PPT」。

**功能要求（已確認）**：選產品；讀名稱/圖/尺寸/材質/價；AI 整理內容；用預設 Canva 模板生成；產品清單＋圖片；可再編輯；**視 API 能力**匯出 PPTX/PDF；**未取得有效權限不得使用他人 Canva 資料**。

**技術方向（建議）**：優先「結構化產品資料 ＋ 固定模板」以控品質；實作前必須確認實際 Canva 帳戶能力（預覽／配額／授權限制）。

> **已決議（2026-10-19）**：Canva 使用 **`chifung.login` 賬戶**。需先確認該帳戶的方案與 API 可用範圍。

**驗收標準**：至少生成一份**可編輯**的家具產品簡報。

**Given / When / Then**：
| # | Given | When | Then |
|---|---|---|---|
| 1 | 已選 5 件產品 | 生成 PPT | 產出含名稱/圖/尺寸/價之簡報，可編輯 |
| 2 | 未授權 Canva 帳戶 | 嘗試使用他人模板 | 被拒，不泄露他人資料 |

**衝突**：與 R5.1（快速報價可出 PDF/PPT）、D-9 無衝突；與 R5.2 專業 PDF **互補**（差異矩陣 C-07）。

---

## 6. 平台基礎需求（F-PLT，本文件新增以補足指令缺口）

> 指令要求「背景任務、權限、資料模型、儲存、向量」。現況逐項缺失，故列為獨立需求。

### F-PLT-001 背景任務與 Worker 調用 — P0
- 新增通用 **`processing_jobs`**：`id`、`job_type`、`status`(queued/running/succeeded/failed/cancelled)、`payload` jsonb、`progress`、`attempts`、`max_attempts`、`error`、`pages`、`ocr_pages`、`tokens`、`cost_estimate`、`cost_actual`、`started_at`、`finished_at`、`created_by`、`idempotency_key`。
- 支援：非同步、進度、失敗重試、錯誤日誌、取消/安全中止、**冪等與重複任務控制**、成本記錄、並行與資源限制。
- Worker 調用（**已決議**）：過渡用 **Supabase Edge（Deno）＋ pg_cron/pg_net**；重型 PDF/OCR/3D 用 **Python Worker（Google Cloud Run Jobs，按需執行）**。兩者共用 `processing_jobs`。
- **不得**讓大型解析走 Vercel 長時間同步請求。
- 驗收：任務失敗可追蹤、可重試、不重複寫入。

### F-PLT-002 權限、RLS 與操作審計 — P0
- **現況風險**：多數表（含 `bwf_quote`、`products`、`supplier`相關）為 `USING(true)` allow-all；前端用 anon key 直連。供應商成本與原始 PDF 若沿用此模型會外洩。
- 要求：供應商成本、原始文件、審核資料**必須**角色權限 ＋ RLS ＋ 私有 bucket ＋ 操作審計；沿用 `bwf_assert_platform_admin()` 模式擴充（如 `bwf_assert_role(...)`）。
- 驗收：未授權用戶（含 `client`、未登入）無法讀取成本與原始文件。

### F-PLT-003 產品／規格／報價分離模型 — P0
- 沿用 `products` 作產品身份；新增 `supplier_prices`、`product_source_refs`、`price_history`（見 F-AI-003）。
- 不得重複建 supplier／product 表。

### F-PLT-004 文件與圖片儲存 — P0
- 新增私有 bucket **`supplier-documents`**（原始 PDF）；`product-images` 續用於產品圖。
- 縮圖策略沿用 `imageThumb` / Storage Image Transformations。
- **base64 永不寫入 DB**（沿用 `CLAUDE.md` 規則）。

### F-PLT-005 向量搜索基礎 — P1
- 啟用 **pgvector**；新增 `search_embeddings`（`entity_type`、`entity_id`、`embedding vector(N)`、`model`、`created_at`）。
- 供 F-AI-005 語義搜索與 F-AI-006 以圖搜款共用。
- 驗收：向量檢索可回傳近似結果並支援混合排序。

---

## 7. 操作流程總覽

```
[供應商] 選定/新增供應商（PMS factories + 本地延伸）
   ↓
[上載] 上傳 PDF → supplier_documents + supplier-documents bucket      (F-AI-001 / F-PLT-004)
   ↓
[任務] processing_jobs 建立 → Worker 逐頁解析                         (F-PLT-001)
   ↓
[解析] 頁面分類 → 文字/OCR 分流 → 產品/圖片/價格                          (F-AI-002)
   ↓
[圖片] 裁切/分類/去重/關聯 → product_image_assets + product-images      (F-AI-004)
   ↓
[審核] 低置信度人工審核 → extraction_items approve/reject               (F-AI-002/003)
   ↓
[入庫] products（身份） + supplier_prices（報價） + product_source_refs  (F-AI-003)
   ↓
[索引] tsvector + pgvector 建立搜索索引                                 (F-AI-005/PLT-005)
   ↓
[使用] 智能搜索 / 以圖搜款 / 多供應商比較                               (F-AI-005/006/007)
   ↓
[產出] AI SketchUp（SKP/GLB） ｜ Canva PPT                             (F-AI-008/009)
   ↓
[整合] 報價 bwf_quote/bwf_quote_item、分區 project_zones、發布流程（既有 FDS 2.0）
```

---

## 8. 業務規則（新增，與 FDS 2.0 核對）

| # | 規則 | 狀態 | 影響需求 |
|---|---|---|---|
| BR-01 | 供應商報價不可直接覆蓋，須保留版本與歷史 | 已確認 | F-AI-003/007 |
| BR-02 | AI 解析結果需審核，未確認不得作最終正式價格 | 已確認 | F-AI-002/007 |
| BR-03 | 產品與價格分離（多規格／多供應商／多時間） | 已確認 | F-AI-003 |
| BR-04 | 圖片是核心資料，解析階段即建立關聯 | 已確認 | F-AI-004 |
| BR-05 | AI 相似搜索 ≠ 同款認定 | 已確認 | F-AI-006 |
| BR-06 | 所有價格必須可溯源（文件＋頁碼） | 已確認 | F-AI-002/005/007 |
| BR-07 | 商業資料需角色權限、RLS、私有文件、審計 | 已確認 | F-PLT-002 |
| BR-08 | 保持既有業務資料一致，優先整合 | 已確認 | 全部 |
| BR-09 | 成本價不直接顯示給設計師／PM（－＞中間價） | **已決議**（C-04） | F-AI-005/007、D-8.3 |
| BR-10 | 賣價八折給 PM、PM GP 15–20% | **已決議**（八折 ＋ 15–20%） | R5、F-AI-007 |
| BR-11 | 產品身份鍵＝型號 ＋ 供應商；同型號不同供應商＝不同產品（另建相似關聯） | **已決議** | F-AI-003 |
| BR-12 | 原始 PDF 與審核記錄可人工刪除（限管理員，需審計） | **已決議** | F-PLT-002 |
| BR-13 | QR 掃碼用一次性 token ＋ 有效期，只露該報價內容 | **已決議** | R1.1 |
| BR-14 | 廠家自助上載須先經審核才入庫 | **已決議** | R4.1、F-AI-002 |

---

## 9. 系統架構（摘要）

完整架構見 `docs/prd/FDS-2.1-技術架構.md`。要點：

- 前端 Vercel（Vite+React）：沿用；新增智能搜索、以圖搜款、文件管理、審核、比較、PPT 入口。
- Supabase：PostgreSQL ＋ Auth ＋ Storage ＋ RLS ＋（新增）pgvector ＋ `processing_jobs`。
- Background：pg_cron＋pg_net（現有）＋（建議）通用任務協調。
- Python PDF Worker（建議，Cloud Run Jobs）：文字提取／OCR／表格／圖片／AI 結構化／校驗。
- 3D Worker：參數化幾何引擎 → SKP（設計師 SU）＋ GLB（瀏覽器預覽）。不用 OpenSKP。
- External AI：LLM／VLM（現用 Gemini）／OCR／Text & Image Embedding／Canva API。
- **不得**因新功能擅自全面替換現有技術棧（Vite≠Next、Supabase≠其他）。

---

## 10. 資料模型（整合對照）

### 10.1 沿用既有（可用，不重建）
`products`、`shopify_products`、`ready_to_shopify`、`product_category`、`bwf_quote`、`bwf_quote_item`、`bwf_quote_share_links`、`design_projects`、`project_zones`、`zone_products`、`platform_user_profiles`、`factory_correction_patterns`、`upload_log`、`login_log`；外部 `factories`／`bwf_product_master`／`bwf_pitchings`／`bwf_projects`。

### 10.2 新增（技術建議）
`supplier_documents`、`document_pages`(選)、`processing_jobs`、`extraction_items`、`supplier_prices`、`price_history`(選)、`product_source_refs`、`product_image_assets`、`search_embeddings`、`product_models`（設計師 D-5/6）。

> 所有新增表須附：RLS（F-PLT-002）、索引、`creator/editor_staff_id`、`created_date/modified_date`（沿用 pmsAudit 慣例）。詳見技術架構文件。

---

## 11. API 與背景任務（對照）

| 能力 | 形式 | 建議命名 |
|---|---|---|
| 建立文件與任務 | Edge Function | `create-supplier-document` |
| Worker 回呼／解析 | Edge / Worker | `parse-supplier-document` |
| 取任務進度 | Edge / RPC | `get-processing-job` |
| 審核 | RPC | `review_extraction_item` |
| 匯入產品／價格 | RPC（交易） | `import_extracted_products` |
| 搜索 | RPC | `search_furniture`（FTS＋向量混合） |
| 以圖搜款 | Edge | `search-by-image` |
| 報價比較 | RPC | `compare_supplier_prices` |
| SKP 建模 | Worker | `generate-skp` |
| Canva PPT | Edge | `generate-canva-presentation` |

> 命名沿用現有 `supabase-functions-` 前綴慣例；**部署前先確認前端實際 invoke 的 slug**（見 `CLAUDE.md` 第 0 節）。

---

## 12. UI 頁面清單與 Sitemap 對照

| 頁面 | ViewType（既有／新） | 狀態 | 對應需求 |
|---|---|---|---|
| 廠家目錄 → 上載產品PDF | `fds2-factory-upload` → `ai-processor` | 已存在，需擴 | F-AI-001/002 |
| 產品管理 → 上載報價PDF | `fds2-products-quote-pdf` → `ai-processor` | 已存在，需擴 | F-AI-001/002 |
| 產品管理 → 待處理產品 | `fds2-products-pending` → `listed-products` | 已存在 | F-AI-003 |
| 產品管理 → 產品目錄 | `fds2-products-catalog` → `product-catalog` | 已存在 | F-AI-003 |
| 設計師選傢俬 → 產品類型 | `fds2-designer-types` | 待開發 | F-AI-005／D-1 |
| 設計師選傢俬 → 產品PDF | `fds2-designer-pdf` | 待開發 | D-2／F-AI-001 |
| 設計師選傢俬 → SU模型 | `fds2-designer-su` | 待開發 | D-5／**F-AI-008** |
| 設計師選傢俬 → 3D模型 | `fds2-designer-3d` | 待開發 | D-6／**F-AI-008** |
| PM報價 → 專業說明 PDF | `fds2-pm-pro-pdf` | 待開發 | R5.2／F-AI-009 |
| PM報價 → 快速報價 | `fds2-pm-quick` → `quick-quote` | 已存在 | R5.1 |
| 系統設定 → 電郵通知 | `fds2-admin-email` | 待開發 | R6.5 |
| **新增：AI 解析／審核** | 建議新 view（如 `fds2-products-ai-review`） | 新增 | F-AI-002/003 |
| **新增：供應商報價比較** | 建議新 view | 新增 | F-AI-007 |
| **新增：以圖搜款** | 併入設計師選傢俬／PM搜索 | 新增 | F-AI-006 |
| **新增：Canva PPT** | 併入 PM報價 | 新增 | F-AI-009 |

> 新增 view id 需同步：`src/types/product.ts` 的 `ViewType`、`navConfig.ts`、`AppShell.renderView()`。

---

## 13. 權限控制（FDS 2.1）

| 能力 | admin | pm | designer | uploader | client |
|---|---|---|---|---|---|
| 上載／管理供應商 PDF | ✅ | ❌ | ❌ | ✅ | ❌ |
| 查看原始 PDF（私有） | ✅ | ❌ | ❌ | ✅ | ❌ |
| 審核 AI 提取 | ✅ | ❌ | ❌ | ✅ | ❌ |
| 智能搜索產品 | ✅ | ✅ | ✅ | ✅ | 僅 A 類 |
| 查看供應商成本 | ✅ | ❌（用中間價） | ❌（用中間價） | ✅ | ❌ |
| 多供應商比較（成本已遮蔽） | ✅ | ✅ | ✅ | ✅ | ❌ |
| 以圖搜款 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 生成 SKP／PPT | ✅ | ✅ | ✅(SKP) | ✅ | ❌ |
| 內部訂單（D-8.4） | ✅ | ✅ | ✅ | ✅ | ❌ |

> **已決議（C-04，2026-10-19）**：成本價僅 `admin` ＋ `uploader` 可見；`pm`／`designer` 一律顯示中間價，比較頁對成本做遮蔽。設計師可以中間價參與多供應商比較。最終以 F-PLT-002 之 RLS 為準。

---

## 14. 驗收標準（彙總，建議目標）

| 功能 | 建議驗收要求 |
|---|---|
| PDF 上傳 | 100～200 頁目標樣本可正常上傳 |
| PDF 解析 | 至少 5～10 份不同版式真實 PDF 完成測試 |
| 產品資料 | 型號、名稱、尺寸、價格能保存並檢索 |
| 價格提取 | 已標註樣本準確率目標 ≥95% |
| 圖片匹配 | 主要產品圖正確關聯，錯誤可人工修正 |
| 文字搜索 | 能準確找到指定型號和供應商 |
| 搜索性能 | 一般搜索目標 2 秒內返回（實量測試） |
| PDF 溯源 | 能定位價格對應原始文件頁面 |
| 以圖搜款 | 返回 Top 5 相似產品候選 |
| SKP | 至少兩類簡單家具通過 SketchUp 可編輯性驗證 |
| Canva | 至少生成一份可編輯家具簡報 |
| 權限 | 未授權用戶無法查閱供應商成本與私有文件 |
| 任務處理 | 失敗可追蹤、可重試、避免重複寫入 |

各功能 Given/When/Then 已列於第 5 節。

---

## 15. 優先級與開發階段

| 階段 | 內容 | 需求 | 期程 |
|---|---|---|---|
| 第一週 | 核心報價系統（上載→解析→產品庫→搜索→溯源） | F-AI-001～005、F-PLT-001/003/004 | Day 1–5 |
| 第二週 | AI 搜索與擴展（圖搜、比較、SKP、PPT、聯調） | F-AI-006～009、F-PLT-002/005 | Day 6–10 |

**排期原則**：P0 先行；P1 在 P0 資料品質達基本驗收後；P2 探索性，若解析／匹配／價格未達標應先修核心。10 天**不代表**所有 PDF 都能高準確率解析，也不代表 SKP 已可處理複雜家具。

詳見 `docs/prd/FDS-2.1-開發計劃.md`。

---

## 16. 風險

| 風險 | 影響 | 緩解 |
|---|---|---|
| PDF 版式多樣、掃描品質差 | 解析準確率不穩 | OCR＋VLM＋人工審核；先量測再承諾 |
| AI 幻覺／錯價 | 錯誤成本影響報價 | BR-02 審核閘門；Schema 驗證；confidence |
| 成本外洩（RLS allow-all） | 商業資料泄露 | F-PLT-002 收緊 RLS＋私有 bucket |
| pgvector/Worker 為全新技術 | 進度風險 | PoC 先行；Edge 過渡 |
| 幾何引擎尚未寫出 SKP | 設計師 SU 拿不到可編輯檔 | SU 頁下載 SKP；GLB 只做預覽；完成後在 SketchUp 實測 |
| Canva API 限制 | PPT 功能受限 | 先確認帳戶能力；模板化 |
| 未持久化原文（現況） | 無法溯源 | F-AI-001 新增文件儲存 |
| 成本不可控（大量匯入） | 費用超支 | 任務記錄頁數/token/費用；並行限制 |
| `supabase.ts` 型別過時 | 開發誤判欄位 | 執行 `npm run types:supabase` |

---

## 17. 決議記錄（2026-10-19，產品負責人）

> 全部待確認事項已拍板，**目前無剩餘待確認**。

### 17.1 衝突決議（C-01～C-09）

| 衝突 | 議題 | 決議 |
|---|---|---|
| C-01 | 供應商主檔歸屬 | **PMS `factories` 為唯一主檔**；Furniture 只加延伸（報價貨幣）與文件表，以 `factory_id` 關聯；停用沿用 PMS `status` |
| C-02 | PDF 分段策略 | **單一管線 ＋ 語意分段**（頁面分類→語意分段→抽產品） |
| C-03 | 搜索實作 | **單一 `search_furniture`**（FTS ＋ pgvector 混合排序，UI 一次到位） |
| C-04 | 成本可見性 | **僅 `admin` ＋ `uploader` 可見成本**；PM／設計師用中間價，比較頁遮蔽 |
| C-05 | AI 價格 vs 報價 | **審核後才可用、不自動覆寫報價**（`supplier_prices.verified`） |
| C-06 | SU/3D 模型語意 | **上載與 AI 生成並存、分入口**（`product_models.source`） |
| C-07 | 專業 PDF vs Canva PPT | **共用資料模型與模板元素**（PDF：`@react-pdf/renderer`；Canva：可編輯 PPT） |
| C-08 | A/B 產品分類 | **用 view/computed 標記**，不改既有資料流 |
| C-09 | 背景處理架構 | **Edge 過渡 → Python Worker（Cloud Run Jobs）**，共用 `processing_jobs` |

### 17.2 其餘需求決議

| # | 議題 | 決議 | 影響需求 |
|---|---|---|---|
| 1 | 報價貨幣 | **人工為主，AI 偵測作建議值**，人可覆寫 | F-AI-001/003 |
| 2 | AI／Embedding 供應商 | **續用 Google Gemini**；Embedding 用 **Google text-embedding** | F-AI-002/005/006 |
| 3 | 向量儲存 | **單表 `search_embeddings` 用 `entity_type` 區分，維度 1536** | F-PLT-005 |
| 4 | OCR 方案 | **可用 Grok（xAI）** | F-AI-002 |
| 5 | 審核流程 | **由傢俬組審核**（對應 `uploader` 流程角色；批次審核） | F-AI-002/003 |
| 6 | 產品身份鍵 | **型號 ＋ 供應商**；同型號不同供應商＝不同產品，另建相似關聯 | F-AI-003（BR-03） |
| 7 | 價格有效期 | **留空並標「未標示」，不自動過期** | F-AI-003/007 |
| 8 | Canva 帳戶 | **使用 `chifung.login` 賬戶** | F-AI-009 |
| 9 | SketchUp 範圍 | **規則家具四類**：辦公桌、會議桌、書架、儲物櫃 | F-AI-008 |
| 10 | 歷史資料導入 | **本階段不導入**，只處理新 PDF（另立項目） | F-AI-001 |
| 11 | 資料保留／刪除 | **可人工刪除**（限管理員；操作需審計） | F-PLT-002 |
| 12 | 中間價公式 | **賣價 × 0.8 ＝ 中間價；PM 在此加 15–20% GP** | R5、F-AI-007（BR-09/10） |

### 17.3 第二輪決議（頁面／流程細節，2026-10-19）

| # | 議題 | 決議 | 影響需求 |
|---|---|---|---|
| 13 | QR Code 文案 | **「線上選擇／修改產品」** | R1.1 |
| 14 | 分區小計呈現 | **每分區段落結尾 ＋ 頁尾總表** | R2.2 |
| 15 | 真單／假單判定 | **以狀態欄位（打步下單／確定客源）自動觸發** | R1.4 |
| 16 | 專業說明 PDF 版面 | **依建議七段式定案** | R5.2 |
| 17 | 八折（中間價）適用範圍 | **全部產品類別** | BR-10 |
| 18 | 電郵通知記錄 | **永久保留、可重發、續用 Resend** | R6.5 |
| 19 | SU／3D 模型來源 | **內部上載為主，廠家後補** | D-5/D-6、F-AI-008 |
| 20 | 模型檔格式／儲存 | **新 bucket `product-models`，格式 skp ＋ glb** | F-AI-008、F-PLT-004 |
| 21 | 顏色標準化 | **固定色票 ＋ 自由標籤** | R3.1、D-1 |
| 22 | 內部訂單流程／模型 | **新建 `internal_orders`(`_items`)；提交→傢俬組；不併入 `bwf_quote`** | D-8.4 |
| 23 | 隱藏產品 | **無，全開放（僅成本遮蔽）** | D-8.2 |
| 24 | 廠家自助上載／角色 | **新增 `supplier` 登入；上載先入審核佇列（傢俬組審核）** | R4.1、F-AI-001 |
| 25 | QR 無登入存取安全 | **一次性 token ＋ 有效期；只露該報價內容** | R1.1 |
| 26 | 版本對比呈現 | **並排欄位級 diff** | R1.2 |
| 27 | 新增頁面位置 | **AI 審核 → 產品管理；比較 → PM報價／設計師；以圖搜款 → 設計師選傢俬** | §12 |
| 28 | pgvector 索引 | **ivfflat，量大再轉 hnsw** | F-PLT-005 |
| 29 | Canva 帳戶能力 | **先 PoC 驗證 `chifung.login`，不足才考慮付費** | F-AI-009 |
| 30 | 私有文件簽名 URL | **短效 5 分鐘 ＋ 需登入** | F-PLT-002 |
| 31 | RLS 上線策略 | **先新表嚴格，既有 allow-all 表分批收緊** | F-PLT-002 |
| 32 | SU 建模方案 | **參數化幾何引擎產出模型。不用 OpenSKP，也不用 SketchUp 官方 SDK。設計師 SU 交付 SKP；GLB 只供 3D 頁預覽** | F-AI-008、D-5／D-6 |

> 至此全部決策已拍板；治理類（預算、測試資料、密鑰、合規、Canva 帳戶管理）見母文件之專案治理清單，屬管理層事項。第 32 項於 2026-10-20 補記。

---

## 18. 附錄：需求 ID 索引

| ID | 名稱 | 優先 | 來源 |
|---|---|---|---|
| R1.1–R1.4 | 報價 QR／版本／通知／每日報告 | P0 | FDS 2.0 |
| R2.1–R2.4 | 分區報價與平面圖標注 | P0 | FDS 2.0 |
| R3.1–R3.2 | 設計師搜尋優化與開放權限 | P0/P1 | FDS 2.0 |
| R4.1–R4.3 | 廠家互動與產品更新 | P1 | FDS 2.0 |
| R5.1–R5.2 | PM 快速報價與專業 PDF | P1 | FDS 2.0 |
| R6.1–R6.5 | 設計師工具／系統開放／廠家目錄／軟裝／電郵記錄 | P1/P2 | FDS 2.0 |
| D-1–D-8 | 設計師選傢俬逐頁 | P0/P1 | 設計師 PRD |
| F-AI-001 | 供應商及報價 PDF 管理 | P0 | 本次 |
| F-AI-002 | AI PDF 解析與資料結構化 | P0 | 本次 |
| F-AI-003 | 標準家具產品資料庫 | P0 | 本次 |
| F-AI-004 | 家具圖片抽取與匹配 | P0 | 本次 |
| F-AI-005 | 家具報價智能搜索 | P0 | 本次 |
| F-AI-006 | 以圖搜款 | P1 | 本次 |
| F-AI-007 | 多供應商報價比較 | P1 | 本次 |
| F-AI-008 | AI SketchUp 建模 | P2 | 本次 |
| F-AI-009 | Canva PPT 自動生成 | P2 | 本次 |
| F-PLT-001 | 背景任務與 Worker | P0 | 本次（缺口補足） |
| F-PLT-002 | 權限、RLS 與審計 | P0 | 本次（缺口補足） |
| F-PLT-003 | 產品/規格/報價分離模型 | P0 | 本次（缺口補足） |
| F-PLT-004 | 文件與圖片儲存 | P0 | 本次（缺口補足） |
| F-PLT-005 | 向量搜索基礎 | P1 | 本次（缺口補足） |
