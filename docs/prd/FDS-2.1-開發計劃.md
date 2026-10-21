# FDS 2.1 開發計劃（10 個工作日）

最後更新：2026-10-19

> 目標：10 個工作日交付**內部可測試 Beta**。
> 前提：現有基礎設施可用、開發者熟悉技術棧、具備可供測試的**真實供應商 PDF**。
> 關聯：需求見 `docs/prd/FDS-2.1-完整需求規格.md`；架構見 `docs/prd/FDS-2.1-技術架構.md`。
> **Priority 定義**：P0＝必須完成；P1＝P0 品質達標後；P2＝探索，若核心未達標優先修核心。

---

## 0. 里程碑總表

| 週 | Day | 主題 | 交付成果 |
|---|---|---|---|
| 1 | 1 | 盤點與基礎 | 架構差異清單、基礎上傳流程 |
| 1 | 2 | PDF 解析 | PDF 解析原型（文字＋OCR） |
| 1 | 3 | 結構化與審核 | 標準化產品資料、審核流程 |
| 1 | 4 | 產品庫與搜索 | PM 搜索頁面 |
| 1 | 5 | 溯源與校驗 | 核心查價 MVP |
| 2 | 6 | 圖片向量 | 基礎以圖搜款 |
| 2 | 7 | 比較與歷史 | 報價比較功能 |
| 2 | 8 | 建模 | 簡單家具建模 PoC |
| 2 | 9 | 簡報 | 基礎簡報生成 |
| 2 | 10 | 聯調與部署 | 內部 Beta |

**貫穿性基礎任務（跨日）**：T-000。

---

## 1. 貫穿任務

### T-000 平台基礎（貫穿 Day 1–10，P0）
- **功能 ID**：F-PLT-001、F-PLT-002、F-PLT-004
- **依賴**：無
- **改動模組**：`supabase/migrations/*`（新）、`supabase/functions/*`（新）、`src/lib/supabase.ts`、`src/types/supabase.ts`
- **交付**：
  - `processing_jobs` 表＋狀態機＋重試/冪等
  - 私有 bucket `supplier-documents`
  - 角色斷言 RPC（擴充 `bwf_assert_platform_admin()` → 通用 `bwf_assert_role()`）
  - 重新產生 Supabase 型別（`npm run types:supabase`）
- **驗收**：任務失敗可重試不重複寫入；未授權角色讀不到成本/原始文件。
- **風險**：RLS 收緊可能影響現有頁面 → 先在**新表**啟用，既有表分階段。

---

## 2. 第一週：核心報價系統

### Day 1 — 盤點、資料模型、上傳基礎

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-101 | — | P0 | — | `docs/prd/*`、`supabase/migrations` | 架構差異清單（已完成：差異矩陣文件）＋確認供應商主檔歸屬 | 差異矩陣 C-01 有結論 | ✅ 已決議 C-01 |
| T-102 | F-AI-001, F-PLT-004 | P0 | T-101 | migration、Storage | `supplier_documents` 表＋`supplier-documents` bucket＋RLS | 同供應商多份 PDF 可並存、原始檔可下載 | bucket 權限設定 |
| T-103 | F-AI-001 | P0 | T-102 | `AIProcessorView.tsx`、新 Edge `create-supplier-document` | 上載 PDF → 建文件＋建任務；100–200 頁可上傳 | AC-001-1/2 | 大檔上傳（分片/超時） |
| T-104 | F-PLT-001 | P0 | T-102 | migration、Edge | `processing_jobs` 表＋worker 調用骨架（pg_cron＋pg_net 或 Edge） | 任務建立/狀態流轉可查 | ✅ 架構已決議 C-09 |

**Day 1 進度（2026-10-19）**：T-102／T-103／T-104 與 T-000 的角色斷言、`supplier-documents` bucket 已上線。
- Migration `20261019040749_fds21_supplier_documents_jobs.sql`：`bwf_has_role`／`bwf_assert_role`／`bwf_current_staff_id`、`supplier_documents`、`processing_jobs`（重試＋指數退避、心跳、取消、同文件只容一個進行中任務）、`fds_*` RPC、pg_cron `fds-process-jobs`（每分鐘，有待處理任務才呼叫）。
- Edge `supabase-functions-process-jobs`：目前 `parse_pdf` 只做檢查（讀頁數），完成後文件轉 `review`；文字／OCR／結構化從 Day 2 起加在同一 job type。
- 前端：`AIProcessorView` 第二步下方的「供應商文件」面板（上載→排隊解析、狀態、重新解析、取消、5 分鐘簽名下載）；舊 AI 處理流程上載 PDF 時只存檔原件、不排任務。
- Storage 專案上限由 50MB 調到 200MB（`product-images` 仍有自己的 50MB 上限）。Edge 只解析 ≤60MB 的 PDF。超過 60MB 的原檔保留。新上載由瀏覽器（pdf-lib）拆；已存放的大檔由 Vercel Function `api/pdf-split` 拆成約 40MB、帶頁碼偏移的子文件，每段走既有 `parse_pdf`，結果合併回父文件。
- 待補：T-205 錯誤日誌已有（`processing_jobs.error_log`），進度儀表待 Day 2；`processing_jobs.cost_*` 欄位已建，成本計算在 T-504。

### Day 2 — PDF 文字提取與 OCR

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-201 | F-AI-002 | P0 | T-104 | 新 Python Worker（PoC）或 Edge | 文字型 PDF 文字/表格提取（PyMuPDF 或 pdfjs/Node 過渡） | 至少 2 份文字型 PDF 可提取 | Edge→Python（已決議 C-09） |
| T-202 | F-AI-002 | P0 | T-201 | Worker | 掃描型分流 → OCR（**可用 Grok**）＋VLM | 掃描型 PDF 可提取文字 | OCR 成本/準確率 |
| T-203 | F-AI-002 | P0 | T-201 | Worker、`gemini-pdf-catalog` | 頁面分類（目錄/產品/報價表/條款） | 每頁有分類標籤 | 分類誤判 |
| T-204 | F-AI-002 | P0 | T-201 | Worker | **語意分段**（不固定頁數切割、保護跨頁） | 跨頁產品不被拆散 | 分段演算法 |
| T-205 | F-PLT-001 | P0 | T-104 | `processing_jobs` | 進度上報、失敗重試、錯誤日誌 | 失敗任務可見狀態並可重試 | — |

**Day 2 進度（2026-10-19）**：T-201～T-205 完成。T-202 Grok OCR 已驗收（`XAI_API_KEY` 已設，模型預設 `grok-4.7`）：掃描中文報價表逐字正確轉成 Markdown 表，後續提取 3 件產品價格／幣種／尺寸全對；純相片頁回 `NO_TEXT` 不寫入內容。
- Migration `20261019052246_fds21_document_pages_segments.sql`：`supplier_document_pages`（逐頁文字、來源、OCR 狀態、頁型、是否延續上一頁）、`supplier_document_segments`、`fds_processing_job_checkpoint`（分批續跑，不消耗重試次數）、`fds_supplier_document_build_segments`。
- `parse_pdf` 分批跑：每次 8 頁抽文字（`unpdf`，CJK CMap 由 jsDelivr 載入）→ 文字少於 40 字且有內嵌 JPEG 的頁交 **Grok** OCR（`XAI_API_KEY`，模型 `XAI_OCR_MODEL`，預設 `grok-4.7`）→ 每次 20 頁交 Gemini 分類並判斷是否延續上一頁 → 建分段。每批後 checkpoint 並立即觸發下一批。
- 合成 27 頁測試（英文＋中文＋2 頁掃描）：封面／目錄／跨頁產品／4 頁價目表／條款／12 頁椅子系列（跨批次邊界）全部正確成段，中文型號、人民幣價格抽取正確，約 30 秒完成。
- 限制：非 JPEG 的掃描頁（CCITT／Flate）標 `unsupported`，待 Python Worker；仍需真實供應商 PDF 驗收（T-503）。

### Day 3 — AI 結構化、圖片、審核

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-301 | F-AI-002 | P0 | T-204 | Worker、`gemini-pdf-catalog` | AI 生成標準化 JSON（名稱/型號/尺寸/材質/分類/價格/貨幣/單位/MOQ/有效期） | 輸出符合 Schema（zod/JSON Schema） | Schema 設計 |
| T-302 | F-AI-002 | P0 | T-301 | Worker | confidence 計算＋異常/低置信度標記 | 低信心列進審核佇列 | 門檻調校 |
| T-303 | F-AI-004 | P0 | T-301 | Worker、`imageStorage.ts` | 圖片裁切/類型分類/去重/關聯產品 | AC-004-1/3 | 圖片類型誤判 |
| T-304 | F-AI-002/004 | P0 | T-301 | migration、UI | `extraction_items` 審核 UI（approve/reject/改欄/改圖） | 可逐筆審核、保留 AI 原值與修正 | 審核工作量 |
| T-305 | F-AI-003 | P0 | T-301 | migration | `supplier_prices`、`product_source_refs` 表 | 產品/報價/來源分離 | 身份鍵已決議：型號＋供應商 |

**Day 3 進度（2026-10-19）**：T-301～T-305 完成。
- Migration `20261019053631_fds21_extraction_review.sql`：`supplier_document_images`、`extraction_items`（`raw_json` AI 原值＋`corrected_json` 人工修正、置信度、flags、圖片、審核狀態）、`supplier_prices`、`product_source_refs`；RLS 只限 admin／uploader；審核 RPC `fds_extraction_item_review`／`fds_extraction_items_review_batch`（已匯入項目不可改）。
- Migration `20261019053721_fds21_extraction_finalize.sql`：全文件型號重複標記、logo 圖移除、重算「需注意」。
- `parse_pdf` 加第三階段 `structure`：分段切成 ≤5 頁的單元，每單元交 Gemini（固定 JSON Schema，含圖片）→ 規則校驗：缺型號、缺價、價格不在原文、缺幣種、尺寸可疑（<50 或 >6000mm）、AI 不確定 → 置信度 <0.7 或有硬性異常即進「需注意」。目錄類文件缺價只作提示。結果附建議幣種（只供參考，幣種仍由人決定）。
- 圖片：抽文字頁內 ≥200px 的 JPEG，sha256 去重存 `product-images/supplier-extracts/`，出現 ≥3 頁視為 logo；AI 指定圖片類型（主圖／細節／尺寸圖／布料…）並關聯產品。
- 新頁面「產品管理 → AI 提取審核」（`fds2-products-ai-review`）：按文件列出、篩選（待審核／需注意／已通過／已拒絕）、搜尋、單筆／批量通過拒絕、逐欄修正（顯示 AI 原值）、選主圖、跳到原文 PDF 對應頁。
- 27 頁合成測試：67 件產品，價目表 48 件價格全對，人民幣型號 HZ-801 ¥3,280 正確；重新解析保留已審核項目不重複。
- 限制：PDF 內非 JPEG 圖片（Flate／JPX）未抽，待 Python Worker；仍需真實供應商 PDF 驗收（T-503）。

### Day 4 — 產品資料庫、全文搜索、詳情

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-401 | F-AI-003 | P0 | T-305 | RPC `import_extracted_products` | 審核通過→寫入產品＋報價＋來源 | AC-003-1/2 | 去重邏輯 |
| T-402 | F-AI-005 | P0 | T-401 | migration、RPC | 全文搜索（tsvector/`pg_trgm`） | 指定型號/供應商可命中 | 索引調校 |
| T-403 | F-AI-005, D-1, R3.1 | P0 | T-402 | `productCatalogQuery.ts`、`ProductSelectorModal.tsx` | 篩選：名稱/型號/分類/供應商/價格/尺寸/材質/顏色多選/現貨 | D-1.1 可疊加篩選 | 查詢效能 |
| T-404 | F-AI-005 | P0 | T-402 | 新 view / `fds2-designer-types` | 搜索結果卡片（圖/名/型號/尺寸/供應商/報價/幣/有效性/來源） | 2 秒內返回（實量測試） | 資料量效能（Q） |
| T-405 | F-AI-005 | P0 | T-402 | 新 view | 產品詳情（多圖/規格/來源） | 可進詳情 | — |

**Day 4 進度（2026-10-19）**：T-401～T-405 完成，正式庫與 FDS2.0 分支都已部署。
- Migration `20261019063613_fds21_import_search.sql`：
  - `fds_import_extracted_products(document_id, item_ids?)`：只收「已通過、未匯入」項目。身份＝型號（去空格／橫線）＋文件廠家；同廠家同型號沿用既有 `products` 列、**不改動它**，只追加 `supplier_prices`（`other_prices` 另成規格列；同文件同型號第二項自動加規格標籤）與 `product_source_refs`。新產品進「待處理產品」（`source=local`、`in_catalog=false`），**不寫** `products.cost_price`（報價可能是外幣）。缺型號跳過並回報；文件未指定廠家直接拒絕。重複匯入不會重複寫價（`supplier_prices` 以提取項目＋規格唯一）。全部審完後文件轉 `ready`。
  - `fds_search_products`：關鍵字逐詞 AND 比對名稱／型號（含去符號型號）／SKU／廠家／顏色／材質／分類（`pg_trgm` GIN 索引），型號精確命中置頂，其次現貨；篩選可疊加（廠家、level1/2、顏色多選、材質多選、長闊高、價錢、只看現貨、範圍：全部／產品目錄／已上架／有供應商報價）；排序：相關度／最新／價錢／尺寸。
  - `fds_product_detail`：多圖、規格、全部報價（含歷史）、來源文件與頁碼。`fds_product_search_facets`：廠家與分類選項。
  - 成本只回給 admin／uploader；pm／designer 只拿中間價（賣價 × 0.8），原文 PDF 路徑也不回傳。價錢篩選／排序對成本角色用報價原幣（未換匯），對其他角色用中間價。
- 前端：「設計師選傢俬 → 產品類型」（`fds2-designer-types`，`FurnitureSearchView`）＝搜索頁＋詳情；「AI 提取審核」加「匯入產品庫」按鈕。中文顏色詞（如「墨綠」）自動轉成顏色篩選，因 `products.color` 存英文色名。材質標籤規則抽到 `src/constants/material-tags.ts` 與客戶專區共用。
- 實測：5,290 件產品，DB 端 0.35–0.7 秒，瀏覽器整體約 1.2 秒（首次開頁約 2 秒，含連線冷啟動）；型號 `FDS-T900`／`fds t900`／`SH T1206` 都能精確命中；designer 角色查不到成本與 PDF 路徑。
- 限制：AI 產品的分類只存文字 `category`，`product_category_id` 待在「待處理產品」人手歸類；AI 顏色是原文（多為中文），顏色篩選對它們靠原文比對。

### Day 5 — 原 PDF 溯源、價格校驗、真實資料測試

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-501 | F-AI-005 | P0 | T-403 | UI | PDF 檢視器跳對應頁（可行時高亮 bbox） | AC-005-3 | bbox 座標對齊 |
| T-502 | F-AI-002/003 | P0 | T-401 | migration/RPC、UI | 價格校驗規則＋審核閘門；未審核不得為正式價 | AC-002-3、BR-02 | 規則覆蓋 |
| T-503 | F-AI-002/003 | P0 | T-401 | 測試 | 以**真實 PDF**測試 5–10 份不同版式 | 價格提取樣本準確率 ≥95% | 樣本不足 |
| T-504 | F-PLT-001 | P0 | T-205 | `processing_jobs` | 成本記錄（頁數/OCR 頁/token/時長/成功率/費用） | 每任務有成本欄 | 成本估算模型 |
| T-505 | F-AI-005 | P0 | T-403 | UI | **核心查價 MVP** 整合與驗收 | Day 5 交付可示範 | — |

**Day 5 進度（2026-10-19）**：T-501、T-502、T-504 完成。T-503 未做（沒有 5–10 份真實供應商 PDF 可對答案）。T-505 的溯源已接到搜索與審核，可示範上載→解析→審核→搜索→開原文頁。
- Migration `20261019181000_fds21_source_page_price_gate.sql`：
  - `fds_source_page_context`：designer／pm／admin／uploader 只能開「已連到該產品」的原文頁。搜索結果仍不回 storage 路徑。Edge `supabase-functions-source-page` 簽 5 分鐘 URL，前端用 pdf.js 畫出該頁；有 bbox 時加框。（**2026-10-20 更正**：簽名 URL 指向整份 PDF（含成本），原文改限 admin／uploader，見「Day 10 修正」。）
  - 報價單要通過審核，價格必須是 ≥ 0 的數字。`price_not_in_source`／`missing_price` 必須由審核人在修正欄寫下價格才算確認。目錄可以沒有價格。批量通過會跳過未確認項。`supplier_prices.verified` 只接受已通過的提取項。匯入會跳過未確認價格，不寫正式價。
  - `fds_processing_job_complete` 寫入 token、OCR 頁、時長、費用（Gemini Flash 混合單價 USD 0.30／1M tokens）與提取成功率。已完成但未記費用的任務會回填。
- 前端：產品卡片與詳情的「來源」打開頁內原文；AI 審核的原文也走同一檢視器；文件列表顯示 tokens、時長與費用。
- 限制：現有解析流程多數沒有產品 bbox，所以框線只在有座標時出現。T-503 的準確率要等真實 PDF。

**Day 5 交付里程碑**：核心查價 MVP（上載→解析→審核→搜索→溯源）。

---

## 3. 第二週：AI 搜索與擴展

### Day 6 — 圖片 Embedding、以圖搜款

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-601 | F-PLT-005 | P1 | T-401 | migration | 啟用 pgvector＋`search_embeddings` | 向量可寫入/檢索 | 已決議：1536／Google |
| T-602 | F-AI-004/005 | P1 | T-601 | Worker | 產品圖＋文字 embedding 產生 | 有向量且可搜 | embedding 成本 |
| T-603 | F-AI-006 | P1 | T-601 | 新 Edge `search-by-image`、UI | 上圖→向量→候選（Top 5）＋尺寸/材質/供應商篩選 | AC-006、Top 5 | 相似度準確度 |
| T-604 | F-AI-006 | P1 | T-603 | 復用 `visual-match-images` | 相似款 vs 同型號語意區分 | 不誤判同款 | 標示不清 |

進度（2026-10-19）：T-601–T-604 已接上。`search_embeddings` 用 `gemini-embedding-2` 的 1536 維（圖片與文字同一空間；以圖搜款只查 image）。結果固定 `relation=similar`，卡片標「相似款」，不用 cosine 當同款。索引每次 4 件，由管理員按鈕啟動，不會在部署時掃完整目錄。

### Day 7 — 多供應商比較、去重、歷史價格

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-701 | F-AI-007 | P1 | T-401 | migration/RPC `compare_supplier_prices` | 同款/同規格多供應商比較 | 並列價/幣/尺寸/材質/單位 | 相似判定 |
| T-702 | F-AI-007 | P1 | T-305 | `supplier_prices` | 當前 vs 歷史價格、變化趨勢 | 可看歷史變化 | 有效期缺失 |
| T-703 | F-AI-003/007 | P1 | T-401 | RPC | 產品去重／合併策略 | 不重複建產品 | 去重誤合併 |
| T-704 | F-AI-007, F-PLT-002 | P1 | T-701 | UI + RPC | 成本遮蔽（角色）＋「不自動選最低價」 | 未授權看不到成本 | ✅ 已決議 C-04 |

進度（2026-10-19）：T-701–T-704 已接上。`fds_compare_supplier_prices` 用型號對上其他供應商，並列尺寸、材質、幣別、單位和來源；當前與歷史分開，同幣別才標上升／下降／持平。不按價錢排序，也不標最佳。成本只回給 admin／uploader；沒有匯率就不換算。`fds_merge_duplicate_product` 只合併同廠家同型號，已上架的列不能被合併掉。

### Day 8 — 參數化建模、SKP 輸出 PoC

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-801 | F-AI-008 | P2 | T-601 | 新 3D Worker | 圖/設計圖→參數化 JSON（結構/組件/尺寸） | 辦公桌/會議桌/書架/儲物櫃可參數化 | 結構識別不穩 |
| T-802 | F-AI-008 | P2 | T-801 | 3D Worker | 幾何引擎→SKP（SU）＋GLB（預覽） | SU 下載的 SKP 非空 | 幾何引擎尚未寫出 SKP |
| T-803 | F-AI-008 | P2 | T-802 | 手動測試 | **在實際 SketchUp 開啟、編輯組件、儲存** | 兩類簡單家具通過 | SketchUp 環境 |
| T-804 | F-AI-008 | P2 | T-801 | UI | 尺寸輸入/確認、估算尺寸標示 | 無尺寸時標示估算 | — |

進度（2026-10-20 複查修正）：T-801／T-804 **部分完成**，目前只有類型／總尺寸辨認、固定模板及尺寸輸入；設計圖組件抽取、多視圖校對、結構確認均待做，AI 估算數值誤標為已確認亦須修正。主方案是參數化幾何引擎，不用 OpenSKP；SKP 由 SketchUp 官方 C SDK 在 Windows SKP Worker 寫出。

進度（2026-10-20，SKP 通路）：已接上 SU 頁「生成 SKP」→ `generate_skp` 任務 → `workers/skp-writer`（C SDK 寫檔＋Node worker 上傳）→ SU 頁下載；產品詳情可上載／下載 SKP、GLB，卡片顯示 SU／3D。只部署到 FDS2.0 分支。排隊、領取、失敗重試、完成登記、上載綁定與權限已在分支實測；`skp_writer.exe` 因本機無 SDK 未編譯，**T-802a（編譯＋真實 SKP）與 T-803（SketchUp 實機）未完成**。

進度（2026-10-20，輪廓拉伸）：部件可帶多邊形輪廓（`outline`，可凹，沿 x／y／z 拉伸），每件存 `faces_mm`（面朝外），預覽、GLB、SKP 共用同一份面資料；GLB 用耳切法三角化凹面。桌類加選項：桌面矩形／船形（兩端收窄）、四腳／折板腳（下段垂直落地，約 58% 高處折向中間接桌面）、中間走線槽。樣本：會議桌 LF-H32P 3200 × 1390 × 775（船形＋折板腳＋走線槽）已出 GLB。GLB 座標由鏡像改為正確旋轉（Z 向上 → Y 向上）。圖片自動辨認這些選項（T-801 結構抽取）未做，現在要人手選。

進度（2026-10-20，產品詳情生成流程）：
- T-806：按「生成 SU／3D」先查這件產品已有的 SKP／GLB（上載或 AI 生成），有就提示「下載現有檔／仍要重新生成」，沿用不叫 AI、不建任務；查詢失敗時擋住生成，不當作無檔。
- T-801（桌類第一版）：edge `generate-furniture-model` 一次收最多 3 張產品圖（多視圖），除類型／總尺寸外回傳桌面形狀、桌腳樣式、走線槽及辨認說明。桌類即使已有量度尺寸也會看圖讀結構；名稱寫明線盒時保留走線槽。只部署到 FDS2.0 分支。
- T-804（第一版）：生成前顯示確認面板（類型、闊深高、桌面、桌腳、走線槽、結構來源及 AI 說明），AI 估算的尺寸標「AI 估算」，人手改過即變確認值；確認後才建模型。
- 實測 LF-H32P：AI 從 3 張圖辨認為船形＋折板腳＋走線槽，生成新 GLB（舊檔保留），SU 已排入 `generate_skp`。
- 仍待：多視圖尺寸矛盾檢查；T-802a 編譯 `skp_writer.exe`。

進度（2026-10-20，按 FDS 類別擴充模板，取消四類限制）：
- 模板由 4 類擴到 17 類，對應現有 FDS level1／level2 類別：枱／桌（辦公枱、會議枱、餐桌／洽談桌、茶几、吧台、前台、講台）、儲物（儲物櫃／文件櫃、活動櫃、層架／書架）、座椅（辦公椅、會議椅／餐椅、吧椅、排椅／禮堂椅、梳化、卡座）、靜音倉。`furniture_models.kind` 約束與 `fds_save_furniture_model` 同步放寬（`20261020150000_fds21_furniture_model_kinds.sql`，只套 FDS2.0 分支）。
- 結構選項按類型顯示：桌面矩形／船形／圓形、桌腳四腳／折板腳／中柱、走線槽、屏風；櫃的門／抽屜／層板數；椅腳五星腳／四腳／弓字架、扶手；梳化／排椅／卡座座位數。AI（`generate-furniture-model`）按同一套欄位回報，只回它看到的欄位，其餘用類型預設。
- 類型判斷先看 level2 類別，一格含兩類（「吧台、吧椅」）時改看標題；名稱寫明的數量與特徵（三人位、4 抽、線盒、弓字架）優先於 AI 看圖結果。
- 實測：大班椅 ZY25-C2320-1 由 AI 判出弓字架＋扶手，生成 GLB／FBX，在詳情頁 3D 檢視器正確顯示。
- 辦公枱可為屏風工作位：桌面加 L 形；人數（單人／雙人／四人／乾字／F 型）按型號，產品圖常把幾張檯拼在一張相；深度夠時面對面兩排。活動櫃抽屜、屏風、端板一併建出。
- 沒有對應模板時用「其他（AI 部件）」（kind `custom`）：AI 看產品圖輸出最多 30 個部件（方塊、圓柱、拉伸輪廓，含尺寸和位置），前端 `sanitizeCustomParts` 檢查（非數字、過小、自交輪廓會剔除或轉方塊），按總尺寸縮放一次，再交同一套引擎出 GLB／FBX／SKP。確認面板列出部件可改尺寸或刪除（刪除後總尺寸跟部件，不會拉伸其餘部件），並有即時預覽圖。AI 拆部件一次約 50 秒。
- SKP 寫檔改走 SketchUp Ruby API（C SDK 不公開下載）：`workers/skp-writer/skp_build.rb` 由 worker 以 `-RubyStartup` 啟動本機 SketchUp 2026，讀同一份輸入，建頂層組件＋每部件一個組件，單位毫米，存檔後自動關閉，每件約 10–30 秒。FDS2.0 分支已實跑兩個 `generate_skp` 任務（書架、會議桌）成功上傳並登記；在 SketchUp 開啟，頂層組件與每隻桌腳都可單獨選取編輯（T-803 部分通過，另存／重開未測）。已修正方向：整件轉 180° 令正面對 SketchUp 前視圖。
- 已知限制：曲面（梳化圓扶手、弧形靠背）仍用方塊近似；產品資料的闊深高次序不一定一致（該椅記錄為 730 × 560 × 610），確認面板可人手改。

**後續實作順序與交付閘門**（取代將 Day 8 視為完成的表述）：

| Task | 依賴 | 實作／驗收 | 狀態 |
|---|---|---|---|
| T-802a 寫檔可行性 | 固定桌／櫃組件，可先行 | 符合禁用限制的真實 SKP writer；寫入、重讀、實機修改及另存 | 未完成；未通過前不承諾 SKP 日期 |
| T-801 設計圖抽取 | 現有圖片分析入口，不依賴圖搜 T-601 | 多視圖、尺寸證據、板厚、層數、桌腳／門板等結構草稿 | 待補 |
| T-804 確認與幾何 | T-801 | 人工確認結構／尺寸，保留估算來源，矛盾阻擋，參數化組件與圖一致 | 待補及修正 |
| T-802b 產物整合 | T-802a、T-804 | 同版 GLB／SKP、私有產物、背景任務、冪等／失敗重試 | 未完成 |
| T-803 實機驗收 | T-802b | 桌與櫃／書架真實圖各一例；尺寸／組件核對，SketchUp 修改、另存、重開 | 未完成 |

取消類別限制亦納入 T-801／804：同步擴充前端選項、Edge 類型 Schema、`FurnitureKind`、資料表／RPC 的 kind 約束與幾何部件能力，保留既有四類資料相容；移除按沙發／椅子／曲面直接拒絕的分支。T-803 增加上述三類代表樣本，不只修改畫面文案。

T-802 拆為 a／b 兩關；Ruby 桌面擴充只列待決替代路線，不視為已批准或已實作。詳細流程及驗收以完整需求 F-AI-008、技術架構第 7 節為準。

### Day 8 補充 — 上傳、歷史選用與系統預覽（2026-10-20）

| Task ID | 依賴 | 交付／驗收 | 狀態 |
|---|---|---|---|
| T-805 SKP 上傳 | 既有模型 RPC／私有儲存 | 上傳有效 SKP，保存來源、產品／工作項、版本、hash；原檔可下載且不改寫 | 待開發 |
| T-806 生成前檢查 | T-805、既有生成模型列表 | AI 呼叫前查上傳及歷史生成版本，提示沿用／預覽／重新生成；沿用不建生成任務，查詢失敗不當作無檔 | 待開發 |
| T-807a SKP 預覽可行性 | 真實 SKP 樣本，可先行 | 驗證符合現有依賴限制的 SKP 讀取→GLB 通路，含曲面及材質；不要求使用者另交 GLB | 未驗證，不能以自產 GLB 代替 |
| T-807b 預覽整合 | T-805、T-807a | 系統內 3D viewer、旋轉／縮放／平移、處理／失敗狀態及重試；預覽與原件同權限、同版本 | 待開發 |

T-803 整體驗收增加：同一產品的上傳版與生成版同時存在、選用舊版本不觸發 AI、重生成保留舊檔、多版本查詢、並發生成防重、無權限與損壞檔、預覽失敗重試。T-802a 是寫 SKP；T-807a 是讀 SKP，兩個關卡分開通過。上傳／歷史選用／預覽皆為已確認需求，不因生成 writer 尚未完成而從範圍移除。

### Day 9 — 使用者內容 → Canva 客戶簡報設計（2026-10-20 重訂）

使用者提供內容，由 Canva 完成客戶匯報的簡報設計，可在 Canva 編輯並保存／下載 PPTX。取消先由 FDS／PptxGenJS 產生 PPTX 再匯入 Canva 的交付路線。

| Task ID | 功能 ID | 優先級 | 依賴 | 交付及驗收 | 狀態 |
|---|---|---|---|---|---|
| T-901 | F-AI-009 | P2 | 授權 Canva 帳戶及真實匯報樣本，不依賴產品匯入 | 驗證內容／素材交給 Canva 原生設計、取得可編輯簡報並從 Canva 下載 PPTX 的完整通路 | 待重新 PoC；不是只補 secrets |
| T-902 | F-AI-009 | P2 | T-901 | 內容輸入、附件／設計要求、大綱確認、生成狀態、Canva 編輯入口；不選產品亦能使用 | 現有選產品→本機 PPTX 流程須重做 |
| T-903 | F-AI-009、R5.2 | P2 | T-901／902 | 保留草稿及 Canva 設計版本；真實客戶簡報修改後保存／下載，PowerPoint 驗證可編輯；PDF 只共用內容及品牌資料 | 未完成 |

**現況與可沿用能力**：已有 `canva_connections`、OAuth PKCE 與 `supabase-functions-generate-canva-presentation`。`presentationPptx.ts` 及 Design Imports 是舊實作，不計為新需求完成，亦不作自動降級路線。沿用連接與權限能力，按已驗證的 Canva 通路調整既有 Edge／頁面；不可假設原 scope 足夠，也不另建重複帳戶連接接口。

**PoC 成功條件**：一份使用者提供的真實匯報內容 → Canva 完成設計 → 修改文字／圖片／版面 → Canva 保存並下載 PPTX → PowerPoint 核對最新修改且可編輯。純模板填字或空白設計連結不能單獨通過；若原生通路能力不足，記錄阻塞與可行方案，不改回先生成 PPTX 再匯入。

### Day 10 — 聯調、權限、性能、錯誤處理、部署

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-1001 | F-PLT-002 | P0 | T-000 | RLS/migration | 全部新表 RLS＋角色斷言＋審計 | 未授權無法讀成本/文件 | 影響既有頁面 |
| T-1002 | 全部 | P0 | 前三日 | 前後端 | 聯調（Frontend↔Supabase↔Worker） | 端到端可跑 | 跨系統整合 |
| T-1003 | F-AI-005 | P0 | T-404 | 查詢/索引 | 效能量測與優化 | 2 秒內返回 | 資料量 |
| T-1004 | F-PLT-001 | P0 | T-504 | 任務層 | 錯誤處理、重試、取消、冪等驗證 | 重複任務不重複寫入 | — |
| T-1005 | 全部 | P0 | T-1002 | Vercel/Supabase | 部署內部 Beta | Beta 可存取 | 環境設定 |
| T-1006 | — | P0 | T-1005 | 文件 | Beta 測試指引＋已知限制 | 測試者可上手 | — |

進度（2026-10-20）：
- T-1001 完成：12 張 FDS 2.1 新表在正式與 FDS2.0 分支逐表核對——RLS 全開；reading policy＝`bwf_has_role(['admin','uploader'])` 或 own-row；寫入只經 security-definer RPC；`canva_connections` 無 policy（service role only）；`furniture_models` 同模式。沒有新增 allow-all。
- T-1004 完成（結構性驗證）：`processing_jobs` 有 `idempotency_key` 唯一鍵＋`one_active_per_document`（document_id, job_type WHERE queued/running）部分唯一索引；兩邊查無重複活動任務（claim/heartbeat/complete/fail 的 runtime 行為 Day 2–5 已驗）。
- T-1003 抽測：`fds_search_products`（5,289 件）經 PostgREST 3 次連續呼叫 0.99–1.43 秒（含本機→Supabase 網路），無登入 JWT 呼叫正確被拒。與 Day 4 記錄一致，在 2 秒預算內。
- T-1005 完成（2026-10-21）：內部 Beta 是 Vercel develop preview，`https://bwfbwfbranding-work-furniture-git-develop-bwsystem.vercel.app`。Preview 的 `SUPABASE_URL`／`SUPABASE_ANON_KEY` 指向 FDS2.0 分支 `omxizeukbcqzsnjsuwod`，`vite.config.ts` 在 build 時把無前綴的值寫進瀏覽器；同一組也有 `VITE_SUPABASE_*` fallback，兩邊都是分支庫。正式網域 `bwteam-furniture.com` 仍走 `main` 與正式庫 `riaubhtruisbwdlwjzur`。Preview 受 Vercel SSO 保護。develop 的一鍵登入只在 git 分支剛好是 develop 時打進 bundle。端到端示範已在 Day 5/7/9 做過（上載→解析→審核→搜索→溯源、比較、GLB）。
- 待完成：真實 PDF 準確率回測（T-503）、設計圖結構與確認（T-801／804）、SKP 寫檔與整合（T-802a／b）、SketchUp 實機驗證（T-803）、Canva 內容到設計／編輯／下載完整重做與 PoC（T-901～903）。

### Day 10 修正 — 權限與資料可靠性（2026-10-20）

稽核發現的問題與修法（migration 見 `supabase/migrations/2026102011*`）：

| 問題 | 修法 | 檔案 |
|---|---|---|
| PM／designer 可取得整份供應商報價 PDF（簽名 URL 指向完整檔案，成本外洩） | `fds_source_page_context` 只接受 admin／uploader；edge `source-page` 再加一次角色檢查；搜索／詳情回傳 `can_open_source`，前端隱藏開原文入口 | `20261020110000_fds21_source_page_role_gate.sql` |
| 解析重試把產品圖誤判成 logo（出現頁數用累加，重跑再加一次） | `supplier_document_images.seen_pages` 存出現過的頁碼（唯一集合），`page_occurrences = cardinality(seen_pages)`；worker 改呼叫 `fds_supplier_document_image_record`（document＋hash＋page 唯一關聯，重跑冪等） | `20261020111000_fds21_image_occurrence_dedupe.sql` |
| 最後一次 worker 被終止後任務永久停在 running | cron 的喚醒條件加上 stale running（heartbeat 超過 10 分鐘）且不看 attempts，讓 `fds_processing_jobs_claim` 有機會把耗盡重試者標記 failed | `20261020111500_fds21_stale_job_cron.sql` |
| 不同規格被當成歷史價格（1200mm vs 1800mm） | 報價排名與漲跌比較都按 產品＋unit＋variant_label 分組 | `20261020110500_fds21_compare_spec_groups.sql` |
| PM／designer 比較頁只剩幣別 | 比較頁補回中間價（售價 × 0.8）與原價，成本仍只給 admin／uploader | 同上 |
| 圖片搜索後改篩選不更新 | 圖片搜索保留已上載圖片，篩選一變就重跑；`fds_match_product_images` 加 `p_text`，搜尋框字詞在圖片搜索也生效 | `20261020112000_fds21_image_search_text_filter.sql` |
| AI 估算尺寸被當成已確認尺寸 | `buildParametric` 接受 `estimated_axes`，AI 回傳的 `estimated` 保留為估算；手動改過的欄位才當成已確認 | `src/lib/furnitureParametric.ts` |

---

## 4. 依賴關聯圖（摘要）

```
T-000 ─┬─ T-102 ─ T-103
       ├─ T-104 ─ T-205 ─ T-504
       └────────────────────────────┐
T-102 ─ T-201 ─ T-202/203/204 ─ T-301 ─┬─ T-302 ─ T-304
                                       ├─ T-303
                                       └─ T-305 ─ T-401 ─┬─ T-402 ─ T-403 ─┬─ T-404 ─ T-505
                                                          │                └─ T-501
                                                          ├─ T-601 ─ T-602 ─ T-603 ─ T-604
                                                          ├─ T-701 ─ T-704
                                                          ├─ T-801 ─ T-804 ─ T-802b ─ T-803（另依賴 T-802a）
                                                          └─ T-901 ─ T-902/903
```

---

## 5. 排期原則與裁切規則

1. **P0 必須先完成**（Day 1–5 ＋ T-1001/1002/1005）。
2. **P1 在 P0 資料品質達基本驗收後**開發（Day 6–7）。
3. **P2 為探索**：若 PDF 解析／圖片匹配／價格準確度未達標，**優先修核心**，不為趕進度犧牲可靠性。
4. 10 個工作日**不代表**所有 PDF 都能高準確率解析，也**不代表** SKP 已可處理複雜家具。
5. 每日結束更新 `processing_jobs` 成本與成功率，避免不可控 AI 費用。

---

## 6. 每日驗收檢查點

| Day | 檢查點 |
|---|---|
| 1 | 上傳 PDF 建立任務與文件記錄成功 |
| 2 | 文字型＋掃描型 PDF 皆可提取、頁面有分類 |
| 3 | 低信心列進審核佇列；審核可 approve/reject |
| 4 | 指定型號搜尋命中，篩選可疊加 |
| 5 | 端到端核心查價 MVP 可示範，價格可溯源 |
| 6 | 上圖回 Top 5 候選 |
| 7 | 多供應商比較與歷史價可看，成本受遮蔽 |
| 8 | 兩類簡單家具 SKP 於 SketchUp 通過 |
| 9 | 一份可編輯簡報生成 |
| 10 | 內部 Beta 部署完成、權限驗證通過 |

---

## 7. 未完成項處理（Overflow）

- 若 Day 10 仍未達標：**保 P0**，把 P1/P2 順延並記錄於差異文件的「暫不開發」。
- 歷史資料導入、生產加工級建模精度保證、客戶端 AI 搜索一律**不佔用 10 日**。
- 所有順延項須回填 `docs/prd/FDS-2.1-完整需求規格.md` 第 17 節決議記錄。
- T-1006 完成（2026-10-21）：`docs/prd/FDS-2.1-Beta測試指引.md` 改成 develop preview 的進入方式、目前側欄，以及產品詳情裡的 3D／SU。簡報頁只保留 Canva，舊 PPTX 模式已不在指引裡。T-503、T-802a／b、T-803、Canva 真實簡報驗收仍列為未完成。
