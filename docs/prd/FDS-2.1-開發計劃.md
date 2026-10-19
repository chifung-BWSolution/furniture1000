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
- Migration `20261019_fds21_supplier_documents_jobs.sql`：`bwf_has_role`／`bwf_assert_role`／`bwf_current_staff_id`、`supplier_documents`、`processing_jobs`（重試＋指數退避、心跳、取消、同文件只容一個進行中任務）、`fds_*` RPC、pg_cron `fds-process-jobs`（每分鐘，有待處理任務才呼叫）。
- Edge `supabase-functions-process-jobs`：目前 `parse_pdf` 只做檢查（讀頁數），完成後文件轉 `review`；文字／OCR／結構化從 Day 2 起加在同一 job type。
- 前端：`AIProcessorView` 第二步下方的「供應商文件」面板（上載→排隊解析、狀態、重新解析、取消、5 分鐘簽名下載）；舊 AI 處理流程上載 PDF 時只存檔原件、不排任務。
- Storage 專案上限由 50MB 調到 200MB（`product-images` 仍有自己的 50MB 上限）。Edge 只處理 ≤60MB 的 PDF，更大的檔案要等 Python Worker。
- 待補：T-205 錯誤日誌已有（`processing_jobs.error_log`），進度儀表待 Day 2；`processing_jobs.cost_*` 欄位已建，成本計算在 T-504。

### Day 2 — PDF 文字提取與 OCR

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-201 | F-AI-002 | P0 | T-104 | 新 Python Worker（PoC）或 Edge | 文字型 PDF 文字/表格提取（PyMuPDF 或 pdfjs/Node 過渡） | 至少 2 份文字型 PDF 可提取 | Edge→Python（已決議 C-09） |
| T-202 | F-AI-002 | P0 | T-201 | Worker | 掃描型分流 → OCR（**可用 Grok**）＋VLM | 掃描型 PDF 可提取文字 | OCR 成本/準確率 |
| T-203 | F-AI-002 | P0 | T-201 | Worker、`gemini-pdf-catalog` | 頁面分類（目錄/產品/報價表/條款） | 每頁有分類標籤 | 分類誤判 |
| T-204 | F-AI-002 | P0 | T-201 | Worker | **語意分段**（不固定頁數切割、保護跨頁） | 跨頁產品不被拆散 | 分段演算法 |
| T-205 | F-PLT-001 | P0 | T-104 | `processing_jobs` | 進度上報、失敗重試、錯誤日誌 | 失敗任務可見狀態並可重試 | — |

**Day 2 進度（2026-10-19）**：T-201／T-203／T-204／T-205 完成；T-202 程式已上線，待設定 `XAI_API_KEY` 後驗收。
- Migration `20261019_fds21_document_pages_segments.sql`：`supplier_document_pages`（逐頁文字、來源、OCR 狀態、頁型、是否延續上一頁）、`supplier_document_segments`、`fds_processing_job_checkpoint`（分批續跑，不消耗重試次數）、`fds_supplier_document_build_segments`。
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
- Migration `20261019_fds21_extraction_review.sql`：`supplier_document_images`、`extraction_items`（`raw_json` AI 原值＋`corrected_json` 人工修正、置信度、flags、圖片、審核狀態）、`supplier_prices`、`product_source_refs`；RLS 只限 admin／uploader；審核 RPC `fds_extraction_item_review`／`fds_extraction_items_review_batch`（已匯入項目不可改）。
- Migration `20261019_fds21_extraction_finalize.sql`：全文件型號重複標記、logo 圖移除、重算「需注意」。
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

### Day 5 — 原 PDF 溯源、價格校驗、真實資料測試

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-501 | F-AI-005 | P0 | T-403 | UI | PDF 檢視器跳對應頁（可行時高亮 bbox） | AC-005-3 | bbox 座標對齊 |
| T-502 | F-AI-002/003 | P0 | T-401 | migration/RPC、UI | 價格校驗規則＋審核閘門；未審核不得為正式價 | AC-002-3、BR-02 | 規則覆蓋 |
| T-503 | F-AI-002/003 | P0 | T-401 | 測試 | 以**真實 PDF**測試 5–10 份不同版式 | 價格提取樣本準確率 ≥95% | 樣本不足 |
| T-504 | F-PLT-001 | P0 | T-205 | `processing_jobs` | 成本記錄（頁數/OCR 頁/token/時長/成功率/費用） | 每任務有成本欄 | 成本估算模型 |
| T-505 | F-AI-005 | P0 | T-403 | UI | **核心查價 MVP** 整合與驗收 | Day 5 交付可示範 | — |

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

### Day 7 — 多供應商比較、去重、歷史價格

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-701 | F-AI-007 | P1 | T-401 | migration/RPC `compare_supplier_prices` | 同款/同規格多供應商比較 | 並列價/幣/尺寸/材質/單位 | 相似判定 |
| T-702 | F-AI-007 | P1 | T-305 | `supplier_prices` | 當前 vs 歷史價格、變化趨勢 | 可看歷史變化 | 有效期缺失 |
| T-703 | F-AI-003/007 | P1 | T-401 | RPC | 產品去重／合併策略 | 不重複建產品 | 去重誤合併 |
| T-704 | F-AI-007, F-PLT-002 | P1 | T-701 | UI + RPC | 成本遮蔽（角色）＋「不自動選最低價」 | 未授權看不到成本 | ✅ 已決議 C-04 |

### Day 8 — 參數化建模、SKP 輸出 PoC

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-801 | F-AI-008 | P2 | T-601 | 新 3D Worker | 圖/設計圖→參數化 JSON（結構/組件/尺寸） | 辦公桌/會議桌/書架/儲物櫃可參數化 | 結構識別不穩 |
| T-802 | F-AI-008 | P2 | T-801 | 3D Worker | 幾何引擎→SKP＋GLB | 生成檔非空 | OpenSKP 能力未證（需驗證授權） |
| T-803 | F-AI-008 | P2 | T-802 | 手動測試 | **在實際 SketchUp 開啟、編輯組件、儲存** | 兩類簡單家具通過 | SketchUp 環境 |
| T-804 | F-AI-008 | P2 | T-801 | UI | 尺寸輸入/確認、估算尺寸標示 | 無尺寸時標示估算 | — |

### Day 9 — Canva API、PPT 生成

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-901 | F-AI-009 | P2 | T-401 | 新 Edge `generate-canva-presentation` | 讀產品資料→預設模板→生成簡報 | 至少一份可編輯簡報 | 已決議：先 PoC 驗證 chifung.login |
| T-902 | F-AI-009 | P2 | T-901 | UI | 選產品→生成 PPT/PDF、事後可編輯 | 匯出成功 | 配額/授權 |
| T-903 | F-AI-009, R5.2 | P2 | T-901 | 模板層 | 與專業說明 PDF 共用模板元素 | 品牌一致 | 模板設計 |

### Day 10 — 聯調、權限、性能、錯誤處理、部署

| Task ID | 功能 ID | 優先級 | 依賴 | 改動模組 | 交付內容 | 驗收標準 | 風險 |
|---|---|---|---|---|---|---|---|
| T-1001 | F-PLT-002 | P0 | T-000 | RLS/migration | 全部新表 RLS＋角色斷言＋審計 | 未授權無法讀成本/文件 | 影響既有頁面 |
| T-1002 | 全部 | P0 | 前三日 | 前後端 | 聯調（Frontend↔Supabase↔Worker） | 端到端可跑 | 跨系統整合 |
| T-1003 | F-AI-005 | P0 | T-404 | 查詢/索引 | 效能量測與優化 | 2 秒內返回 | 資料量 |
| T-1004 | F-PLT-001 | P0 | T-504 | 任務層 | 錯誤處理、重試、取消、冪等驗證 | 重複任務不重複寫入 | — |
| T-1005 | 全部 | P0 | T-1002 | Vercel/Supabase | 部署內部 Beta | Beta 可存取 | 環境設定 |
| T-1006 | — | P0 | T-1005 | 文件 | Beta 測試指引＋已知限制 | 測試者可上手 | — |

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
                                                          ├─ T-801 ─ T-802 ─ T-803/804
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
- 歷史資料導入、複雜家具建模、客戶端 AI 搜索一律**不佔用 10 日**。
- 所有順延項須回填 `docs/prd/FDS-2.1-完整需求規格.md` 第 17 節決議記錄。
