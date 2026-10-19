# FDS 2.0 → FDS 2.1 需求差異與整合矩陣

最後更新：2026-10-19

> 相關文件：`docs/prd/FDS-2.0-需求規格.md`、`docs/prd/設計師選傢俬-PRD.md`、`docs/prd/FDS-2.1-完整需求規格.md`、`docs/prd/FDS-2.1-技術架構.md`、`docs/prd/FDS-2.1-開發計劃.md`
> 原則：**不覆蓋 FDS 2.0、不刪除既有需求、不重複建表**。本文件只記錄「復用／修改／新增／衝突／暫緩」。

---

## 0. 現況總覽（由實際程式碼與 migration 確認）

| 面向 | FDS 2.0 / 現況 | 判定 |
|---|---|---|
| 供應商（廠家） | 主檔在**外部 PMS** `factories`（`fetch-factories`／`fetch-manufacturer-directory`）；本地僅 `factory_correction_patterns` | 已有（外部） |
| 產品（B 類） | `products`（model/color/material/dimension/in_stock/customize/level1-2/product_category_id/cost_price/sale_price） | 已有 |
| 產品（A 類） | `shopify_products` ＋ `ready_to_shopify` | 已有 |
| 產品分類 | `product_category`（level1/2，trigger 同步） | 已有 |
| 報價 | `bwf_quote`（版本列）＋ `bwf_quote_item`＋ RPC `save_bwf_quote_items` | 已有 |
| 分區 | `design_projects`／`project_zones`／`zone_products`；客戶方案轉 `is_section_title` | **已有（重要：勿重造）** |
| 分享連結 | `bwf_quote_share_links` | 已有 |
| PDF 產品抽取 | `AIProcessorView` ＋ `gemini-pdf-catalog`（逐頁、bbox、裁圖） | 部分已有 |
| 圖片相似 | `visual-match-images`（Gemini 評分，非向量） | 部分已有 |
| 原始 PDF 儲存 | **無**（用完即棄） | 缺失 |
| 文件/附件表 | **無** | 缺失 |
| 通用任務佇列 | **無**（只有 pg_cron＋pg_net） | 缺失 |
| Python/3D Worker | **無**（無 Docker/Cloud Run） | 缺失 |
| 向量 / pgvector | **未啟用** | 缺失 |
| 價格歷史 / 多供應商報價 | **無**（價格混在 products 單列） | 缺失 |
| 電郵 | `send-upload-log-report-email`（Resend＋Gmail fallback） | 部分已有 |
| Role / RLS | `platform_user_profiles`（5 角色）；多數表 allow-all RLS | 已有但需收緊 |
| 前端 | Vite+React、zustand、`@react-pdf/renderer`、`pdfjs-dist`；無 PPTX/3D | 已有 |

---

## 1. 差異分類

### 1.1 已有且可復用（Reuse）

| FDS 2.1 需求 | 可復用資產 | 備註 |
|---|---|---|
| F-AI-001 供應商管理 | 外部 `factories`、`fetch-factories`、`fetch-manufacturer-directory`、`factory_correction_patterns` | 供應商**主檔仍以 PMS 為準** |
| F-AI-002 PDF 解析（核心） | `AIProcessorView.tsx`、`gemini-pdf-catalog`、`gemini-excel-catalog`、`gemini-proxy` | 擴充而非重寫 |
| F-AI-003 產品庫 | `products`、`product_category`、`shopify_products`、`ready_to_shopify` | 加周邊價格表 |
| F-AI-004 圖片 | `imageStorage.ts`、bucket `product-images`、`products.images` | 加類型/去重/embedding |
| F-AI-005 搜索 | `productCatalogQuery.ts`、`ProductSelectorModal.tsx`、`CustomerProductSearchView.tsx` 篩選、`pg_trgm` | 加 FTS＋向量 |
| F-AI-006 以圖搜款 | `visual-match-images`（先復用其 Gemini 相似度流程） | 再演進為向量 |
| F-AI-007 報價比較 | `bwf_quote_item` 成本欄位、`quoteGpSummary.ts`、`quotePitchingFinancials.ts`、匯率欄位 | 整合而非另建 |
| F-AI-009 PDF/簡報 | `@react-pdf/renderer`、`QuotationPDFPreview.tsx`（PPTX 另加） | PDF 可先出 |
| F-PLT-001 任務 | pg_cron ＋ pg_net 模式 | 加 `processing_jobs` |
| F-PLT-002 權限 | `platform_user_profiles`、`bwf_assert_platform_admin()` | 擴充為通用角色斷言 |
| FDS 2.0 R2 分區 | `project_zones`/`zone_products` | 直接整合，勿新造分區表 |
| FDS 2.0 R1.2 版本 | `bwf_quote` 版本列＋`persistBwfQuote.ts` | 沿用 |

### 1.2 已有但需要修改（Modify）

| 項目 | 現況 | 需要修改 | 影響需求 |
|---|---|---|---|
| `AIProcessorView` 上載流程 | 逐頁(`PAGES_PER_BATCH=1`)、前端驅動、不存原文、無審核 | 改為任務式、保存原文、加頁面分類與審核 | F-AI-001/002 |
| `gemini-pdf-catalog` | 只回產品＋bbox | 加 OCR 分流、頁面分類、Schema 驗證、confidence | F-AI-002 |
| `products` 價格欄位 | `cost_price`/`sale_price` 單列 | 保留但**新增** `supplier_prices` 作多來源；不改既有欄 | F-AI-003/007 |
| `productCatalogQuery.ts` | ilike/eq、client-side 篩選、上限 800 | 加 FTS＋向量＋顏色/材質/尺寸篩選 | F-AI-005、R3.1、D-1 |
| RLS | 多表 allow-all | 成本/文件/審核表收緊 | F-PLT-002 |
| `src/types/supabase.ts` | 對 `bwf_quote_item`/`products` 已過時 | 重新產生型別 | 全部 |
| `vercel.json`／背景 | 無任務入口 | 加任務觸發（Edge/Worker） | F-PLT-001 |
| 上載頁名稱 | `fds2-factory-upload`＝`fds2-products-quote-pdf`＝`ai-processor` | 區分報價 PDF 與產品目錄 PDF | R6.3、D-2.4 |

### 1.3 完全新增（New）

| 需求 | 新增內容 |
|---|---|
| F-AI-001 | `supplier_documents`、私有 bucket `supplier-documents` |
| F-AI-002 | `processing_jobs`、`extraction_items`、OCR 分流、審核 UI |
| F-AI-003 | `supplier_prices`、`price_history`、`product_source_refs` |
| F-AI-004 | `product_image_assets`（類型/去重/embedding 關聯） |
| F-AI-005 | `search_furniture` RPC、tsvector、`search_embeddings`、pgvector |
| F-AI-006 | 以圖搜款流程＋圖片 embedding |
| F-AI-007 | 比較 RPC／UI |
| F-AI-008 | 3D Worker、SKP/GLB 產出、PoC |
| F-AI-009 | Canva 整合、PPT 生成 |
| F-PLT-001 | 通用任務佇列與 Worker |
| F-PLT-002 | 角色斷言 RPC、審計 |
| F-PLT-004 | 文件 bucket |
| F-PLT-005 | pgvector |

### 1.4 存在衝突（Conflict）

見第 3 節逐條分析。

### 1.5 暫不開發（Deferred）

| 項目 | 原因 |
|---|---|
| 複雜家具（沙發/椅/曲面）自動 SKP | 指令明文排除首版承諾 |
| 客戶端 AI 搜索／以圖搜款 | 首版只開放內部 |
| 大量歷史 PDF 一次性導入 | 另立項目 |
| 高精度生產級建模 | F-AI-008 僅 PoC |
| 全面替換 AI 供應商／技術棧 | 指令禁止擅自替換 |

---

## 2. 需求差異矩陣（指令第九節格式，已填實際現況）

| 比較項目 | FDS 2.0 現況（實測） | AI 新需求 | 整合方式 | 優先級 |
|---|---|---|---|---|
| 供應商管理 | 外部 PMS `factories`＋本地 `factory_correction_patterns` | 供應商 PDF 管理、貨幣、停用 | **復用** PMS 主檔，加本地文件/延伸 | P0 |
| 產品資料 | `products`＋`shopify_products`＋`product_category` | 標準化產品庫、規格/供應商分離 | **擴充**（加 `supplier_prices` 等） | P0 |
| 報價流程 | `bwf_quote`/`bwf_quote_item`、RPC、前端 GP | AI 查價、歷史價、比較 | **整合**（引用成本欄位，不覆蓋） | P0 |
| 文件附件 | 無文件表；PDF 用完即棄 | PDF 解析及溯源、保存原文 | **整合/新增** `supplier_documents` | P0 |
| 搜索 | `ilike/eq`＋client 篩選、`pg_trgm` | 全文、語義、圖片搜索 | **擴充** FTS＋pgvector | P0/P1 |
| 3D 建模 | 無（菜單 placeholder `fds2-designer-su/3d`） | AI 生成 SKP | **新增**（區分上載模型 vs 生成模型） | P2 |
| 商務簡報 | `@react-pdf/renderer` 出 PDF；無 PPTX | Canva PPT | **新增**（PDF 可先出） | P2 |
| 圖片抽取 | 已裁圖存 `product-images` | 類型/關聯/去重/向量 | **擴充** `product_image_assets` | P0 |
| 背景任務 | pg_cron＋pg_net，無佇列 | Worker、重試、成本 | **擴充/新增** `processing_jobs` | P0 |
| 權限 | 5 角色；多表 allow-all | 成本/文件 RLS＋審計 | **修改** 收緊 RLS | P0 |

---

## 3. 衝突逐條分析（指令要求的 6 欄）

### 3.1 決議記錄（2026-10-19，產品負責人已拍板）

| 衝突 | 議題 | 決議 |
|---|---|---|
| C-01 | 供應商主檔歸屬 | ✅ **PMS `factories` 為唯一主檔**；Furniture 只加延伸與文件表，以 `factory_id` 關聯 |
| C-02 | PDF 分段策略 | ✅ **單一管線 ＋ 語意分段**（頁面分類→語意分段→抽產品） |
| C-03 | 搜索實作 | ✅ **單一 `search_furniture`**（FTS ＋ pgvector 混合排序，UI 一次到位） |
| C-04 | 成本可見性 | ✅ **僅 `admin` ＋ `uploader` 可見成本**；PM／設計師用中間價，比較頁遮蔽 |
| C-05 | AI 價格 vs 報價 | ✅ **審核後才可用、不自動覆寫報價**（`supplier_prices.verified`） |
| C-06 | SU/3D 模型語意 | ✅ **上載與 AI 生成並存、分入口**（`product_models.source`） |
| C-07 | 專業 PDF vs Canva PPT | ✅ **共用資料模型與模板元素**（PDF：`@react-pdf/renderer`；Canva：可編輯 PPT） |
| C-08 | A/B 產品分類 | ✅ **用 view/computed 標記**，不改既有資料流 |
| C-09 | 背景處理架構 | ✅ **Edge 過渡 → Python Worker（Cloud Run Jobs）**，共用 `processing_jobs` |

> 以下 3.2 各條的「推薦處理」即為已採納之決議，保留原文作分析記錄。
>
> 其餘需求級別的 12 項決議（報價貨幣、AI/Embedding、向量維度、OCR、審核、產品身份鍵、價格有效期、Canva、SketchUp 範圍、歷史導入、資料刪除、中間價公式）見 `FDS-2.1-完整需求規格.md` 第 17.2 節。

### 3.2 逐條分析

### C-01：供應商主檔歸屬
1. **原始需求及來源**：F-AI-001 要求「新增、修改、查看及停用供應商」；FDS 2.0 R4.3 要求管理廠家資訊與表現。
2. **新增需求**：在 Furniture 建可管理的供應商。
3. **衝突原因**：供應商主檔現在外部 PMS（`factories`），若在 Furniture 另建 supplier 表即**重複資料來源**。
4. **推薦處理〔已決議〕**：**PMS `factories` 為唯一主檔**；Furniture 只加「延伸資料」（報價貨幣、文件、表現快取），以 `factory_id` 關聯；「停用」沿用 PMS `status`。
5. **影響**：DB — 只新增延伸/文件表，不新增 supplier 主表；API — 經 `fetch-factories`／`fetch-manufacturer-directory`；UI — 廠家目錄頁加延伸欄。
6. **需產品負責人確認**：**已決議（C-01：PMS 為唯一主檔）**。

### C-02：PDF 分頁切割 vs 跨頁關係
1. **原始需求**：FDS 2.0 R3.1「AI 自動切割分頁／分區」；F-AI-002「不應單純按固定頁數切割而破壞跨頁產品關係」。
2. **新增需求**：語意分段解析。
3. **衝突原因**：現行 `PAGES_PER_BATCH=1` 逐頁，與 R3.1 的目錄分段目標及跨頁保護不完全一致。
4. **推薦處理**：**合併為同一解析管線**：先頁面分類→再語意分段（semantic segments）→再抽產品；輸出同時供 R3.1（設計師看 PDF 段）與 F-AI-002。
5. **影響**：DB — `document_pages`/段表；API — `parse-supplier-document`；UI — 設計師 PDF 頁、審核頁。
6. **需確認**：是（分段誰覆核）。

### C-03：搜索功能重疊
1. **原始需求**：FDS 2.0 R3.1／D-1（顏色多選、材質、尺寸、常用/最新）。
2. **新增需求**：F-AI-005（全文、語義、混合排序、PDF 溯源）。
3. **衝突原因**：兩者都改同一搜尋器，若分開實作會出現兩套查詢。
4. **推薦處理**：**共用 `search_furniture`**：FTS（tsvector/`pg_trgm`）＋向量；UI 一次到位（D-1 篩選 ＋ F-AI-005 溯源卡片）。
5. **影響**：DB — `search_embeddings`、GIN/tsvector 索引；API — 單一 RPC；UI — `fds2-designer-types`。
6. **需確認**：否（合併即可）。

### C-04：成本可見性 vs 報價比較
1. **原始需求**：FDS 2.0 R3.2／D-8.3「成本價不顯示給設計師，改中間價（賣價八折）」。
2. **新增需求**：F-AI-007 需比較**供應商成本**。
3. **衝突原因**：比較功能需要成本，但成本對設計師／PM 隱藏。
4. **推薦處理〔已決議〕**：**以角色分層**——成本只對 `admin`/`uploader`；PM／設計師看中間價與比較結果（不露原成本）；比較頁做遮蔽。
5. **影響**：DB — 無（靠欄位投影/RLS）；API — RPC 按角色回傳；UI — 比較頁遮蔽。
6. **需確認**：是（PM 可否看成本、中間價公式）。

### C-05：AI 價格 vs 現有報價流程
1. **原始需求**：FDS 2.0 R5.1（快速報價）、BR-10（賣價八折、GP 15–20%）。
2. **新增需求**：F-AI-007「AI 提取報價只是成本參考，未審核不得影響正式報價/毛利」。
3. **衝突原因**：若 AI 成本直接餵入報價 GP，會污染已確認毛利。
4. **推薦處理**：AI 成本入 `supplier_prices`（`verified=false`）→ 審核後 `verified=true` → 只在 PM **手動引用**時影響報價；`bwf_quote_item.cost_price` 仍為人工/已審核值。
5. **影響**：DB — `supplier_prices.verified`；API — 匯入 RPC 不自動覆寫報價；UI — 提示「未審核」。
6. **需確認**：是（是否允許一鍵採用）。

### C-06：SU/3D 模型語意
1. **原始需求**：設計師 PRD D-5／D-6「產品綁定 SU／3D 模型連結」（上載既有模型）。
2. **新增需求**：F-AI-008「AI 生成 SKP」。
3. **衝突原因**：兩者都叫「SU模型」，但一是**上載既有**、一是**AI 生成**。
4. **推薦處理**：`product_models` 加 `source`(uploaded/generated)；UI 分「模型庫」與「AI 生成」兩個入口，共用預覽/下載。
5. **影響**：DB — `product_models.source`；API — `generate-skp`；UI — `fds2-designer-su/3d`。
6. **需確認**：是（優先家具類別）。

### C-07：專業 PDF vs Canva PPT
1. **原始需求**：FDS 2.0 R5.2 專業說明 PDF（七段式）、R5.1「PDF 或 PPT」。
2. **新增需求**：F-AI-009 Canva PPT。
3. **衝突原因**：輸出格式重疊（PDF/PPT），若各做一套模板會不一致。
4. **推薦處理**：**共用同一「方案資料模型」**；`@react-pdf/renderer` 出 PDF（已有），Canva 出可編輯 PPT（新）；模板元素共用。
5. **影響**：DB — 無（沿用報價資料）；API — `generate-canva-presentation`；UI — PM報價。
6. **需確認**：是（Canva 帳戶能力）。

### C-08：A/B 產品分類
1. **原始需求**：FDS 2.0 R3.2／設計師 PRD D-8.2 建議新增 `product_class`。
2. **新增需求**：F-AI-003 標準產品庫。
3. **衝突原因**：A/B 現為隱性（靠所在表）；新增欄位 vs 現有資料來源。
4. **推薦處理**：**不改既有資料來源**；如確需顯式標記，加 view/computed 欄而非改資料流；兩文件定義對齊。
5. **影響**：DB — 可加 generated column 或 view；API — 搜索按來源；UI — 來源切換（已有）。
6. **需確認**：是。

### C-09：背景處理架構
1. **原始需求**：FDS 2.0 未定背景架構（現況 pg_cron＋pg_net）；指令要求「不得依賴 Vercel 長同步請求」，建議 Cloud Run Jobs。
2. **新增需求**：Python Worker／3D Worker。
3. **衝突原因**：現況 edge function 已有 AI 解析，與「引入 Python worker」並存可能重複。
4. **推薦處理**：**Edge 過渡 → Python Worker 承接重型**；`processing_jobs` 為共同介面，兩者都寫同一任務表。
5. **影響**：DB — `processing_jobs`；API — Worker 回呼；UI — 進度顯示。
6. **需確認**：是（選型/預算）。

---

## 4. 資料遷移、兼容性與回滾

| 項目 | 遷移/兼容策略 | 回滾 |
|---|---|---|
| `products` 價格欄位 | **不移除**既有 `cost_price`/`sale_price`；新表 `supplier_prices` 並存 | 停用新表即可 |
| `bwf_quote`/`bwf_quote_item` | **不改既有欄位**；如需新欄只 ADD COLUMN nullable | 保留欄位不影響舊版 |
| `save_bwf_quote_items` RPC | 保持向後兼容（沿用 camelCase fallback 模式） | 保留舊定義 |
| 上載流程 | 新任務式與舊 `AIProcessorView` 並存，功能旗標切換 | 關旗標回舊流程 |
| `gemini-pdf-catalog` | 新增輸出欄位，舊客戶端忽略 | 版本回退 |
| 搜索 | 新增 RPC；舊 `productCatalogQuery` 保留為 fallback | 切換回舊查詢 |
| RLS 收緊 | 先在**新表**啟用嚴格政策；既有 allow-all 表**分階段**收緊並測試 | 還原政策 |
| bucket | 新增 `supplier-documents`，不動 `product-images` | 刪 bucket |
| 型別 | `npm run types:supabase` 重新產生 | git 還原 |

> **兼容原則**：所有新表新欄對舊前端「不存在即忽略」；舊流程在功能旗標關閉時**行為不變**。

---

## 5. 兩份 PRD 一致性檢查（功能 ID / 優先級）

| 需求 | FDS 2.0 檔 | 設計師 PRD | FDS 2.1 檔 | 一致？ |
|---|---|---|---|---|
| 搜尋強化 | R3.1 | D-1 | F-AI-005 | ✅ 合併 |
| 產品 PDF | R3.1 | D-2 | F-AI-001/002 | ✅ 合併 |
| SU/3D | R6.1 | D-5/D-6 | F-AI-008 | ✅ 區分來源 |
| 成本/中間價 | R3.2 | D-8.3 | F-AI-007、F-PLT-002 | ✅ 角色分層 |
| 內部訂單 | R3.2 | D-8.4 | 保留（未變） | ✅ |
| 分區 | R2 | — | 沿用 zone 表 | ✅ |
| 電郵記錄 | R6.5 | — | 保留 | ✅ |
| 廠家互動 | R4 | — | F-AI-001 | ✅ 擴充 |

**無優先級衝突**：FDS 2.0 P0 與 F-AI P0 皆屬第一週；無降級既有需求。
