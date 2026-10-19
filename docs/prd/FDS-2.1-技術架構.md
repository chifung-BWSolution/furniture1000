# FDS 2.1 技術架構

最後更新：2026-10-19

> 相關：`docs/prd/FDS-2.1-完整需求規格.md`、`docs/prd/FDS-2.0-to-2.1-需求差異.md`、`docs/prd/FDS-2.1-開發計劃.md`
> 原則：**沿用現有技術棧**（Vite＋React、Supabase、Edge Functions、`@react-pdf/renderer`、`pdfjs-dist`、Gemini）。新增能力以「擴充」為主，**不擅自全面替換**。
> 標示：**已確認**＝現況/指令明確；**建議**＝本文提出；**待確認**＝需拍板。

---

## 1. 系統組件

```
Furniture1000（FDS 2.1）
│
├── React Frontend（Vite，部署 Vercel）           ← 現有，擴充
│   ├── 既有 FDS 業務（報價/產品/發布/客戶/設定）
│   ├── 供應商文件管理（擴充 AIProcessorView）
│   ├── AI 提取審核頁（新）
│   ├── 智能搜索 / 以圖搜款（擴充 productCatalogQuery）
│   ├── 多供應商比較（新）
│   ├── AI SketchUp 入口（新，併 designer SU/3D）
│   └── Canva PPT 入口（新，併 PM報價）
│
├── Supabase（專案 riaubhtruisbwdlwjzur）          ← 現有，擴充
│   ├── PostgreSQL（+ 新增 AI 表）
│   ├── Auth / Storage / RLS
│   ├── pgvector（新增）
│   └── processing_jobs（新增）
│
├── Background
│   ├── pg_cron + pg_net（現有，觸發 edge）
│   └── processing_jobs 協調（新增）
│
├── PDF/AI Worker（建議：Python on Cloud Run Jobs）
│   ├── PyMuPDF 文字/表格
│   ├── OCR（掃描型）
│   ├── 圖片抽取/裁切/分類
│   ├── AI 結構化（LLM/VLM）
│   └── Schema 校驗
│
├── 3D Worker（建議，PoC）
│   ├── 圖/設計圖 → 參數化 JSON
│   ├── 幾何引擎 → SKP
│   └── GLB 預覽輸出
│
└── External AI
    ├── LLM / VLM（現用 Google Gemini gemini-2.5-flash）
    ├── OCR（**Grok／xAI**，已決議）
    ├── Text / Image Embedding
    └── Canva Connect API
```

### 1.1 與現況的差異（先分析、不替換）

| 層級 | 指令技術方向 | 現況 | 差異處理 |
|---|---|---|---|
| 前端 | Vite+React | **一致** | 不變 |
| 部署 | Vercel | 一致 | 不變 |
| DB | Supabase PG | 一致 | 不變 |
| Auth | Supabase Auth | 一致（＋PMS SSO） | 不變 |
| Storage | Supabase Storage | 一致（僅 `product-images`） | 新增 `supplier-documents` |
| RLS | Supabase RLS | **多表 allow-all** | 收緊（F-PLT-002） |
| 向量 | pgvector | **未啟用** | 啟用 |
| 後端重計算 | 獨立 Python Worker | **無**（edge function） | 新增，Edge 過渡 |
| PDF 解析 | PyMuPDF+OCR+VLM | Edge＋Gemini（逐頁、無 OCR） | 擴充/新增 |
| AI | LLM/VLM/Embedding | Gemini | 續用，必要時加 |
| 3D | SKP 引擎 | **無** | 新增 |
| PPT | Canva API | **無**（`@react-pdf/renderer` 出 PDF） | 新增 |

> **結論**：核心技術棧一致，需新增的是 Worker、pgvector、文件儲存、RLS 收緊、SKP、Canva。

---

## 2. Supabase 資料結構

### 2.1 沿用既有（不重建）
`products`、`shopify_products`、`ready_to_shopify`、`product_category`、`bwf_quote`、`bwf_quote_item`、`bwf_quote_share_links`、`design_projects`、`project_zones`、`zone_products`、`platform_user_profiles`、`factory_correction_patterns`、`upload_log`、`login_log`；外部 `factories`／`bwf_product_master`。

### 2.2 建議新表（DDL 為**技術建議**，非最終）

```sql
-- F-PLT-004：原始文件（私有）
create table supplier_documents (
  id uuid primary key default gen_random_uuid(),
  factory_id text,                    -- 對應 PMS factories.factory_code / id
  factory_name text not null default '',
  doc_type text not null default 'quote' check (doc_type in ('quote','catalog')),
  title text,
  storage_path text not null,         -- bucket supplier-documents
  file_size bigint,
  page_count int,
  currency text,                      -- 人工為主、AI 建議（已決議）
  status text not null default 'uploaded'
    check (status in ('uploaded','parsing','review','ready','failed')),
  error_message text,
  creator_staff_id uuid, editor_staff_id uuid,
  created_date timestamptz default now(), modified_date timestamptz default now(),
  created_at timestamptz default now()
);

-- F-PLT-001：通用任務
create table processing_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,             -- parse_pdf | embed | generate_skp | generate_ppt ...
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','cancelled')),
  payload jsonb not null default '{}',
  document_id uuid references supplier_documents(id) on delete set null,
  progress numeric default 0,
  attempts int not null default 0,
  max_attempts int not null default 3,
  idempotency_key text unique,
  pages int, ocr_pages int, tokens int,
  cost_estimate numeric, cost_actual numeric,
  error text,
  started_at timestamptz, finished_at timestamptz,
  creator_staff_id uuid, created_at timestamptz default now()
);

-- F-AI-002：AI 提取結果（staging，審核用）
create table extraction_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references processing_jobs(id) on delete cascade,
  document_id uuid references supplier_documents(id) on delete cascade,
  page_no int,
  bbox jsonb,                         -- {x,y,w,h}
  raw_json jsonb not null default '{}',
  corrected_json jsonb,
  confidence numeric,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  reviewed_by uuid, reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- F-AI-003：產品身份（沿用 products）＋ 供應商報價（新）
create table supplier_prices (
  id uuid primary key default gen_random_uuid(),
  product_id text references products(id) on delete cascade,
  factory_id text,
  factory_name text,
  document_id uuid references supplier_documents(id) on delete set null,
  page_no int,
  currency text,
  unit text,                          -- 計價單位
  moq numeric,
  cost_price numeric,
  valid_from date, valid_to date,
  verified boolean not null default false,   -- 審核閘門（BR-02）
  raw_ref jsonb,                      -- bbox / 原文片段
  created_at timestamptz default now()
);

-- F-AI-003：價格歷史（可選，或靠 supplier_prices append-only）
create table price_history (
  id uuid primary key default gen_random_uuid(),
  product_id text references products(id) on delete cascade,
  factory_id text, cost_price numeric, currency text,
  captured_at timestamptz default now()
);

-- F-AI-003/004：來源溯源
create table product_source_refs (
  id uuid primary key default gen_random_uuid(),
  product_id text references products(id) on delete cascade,
  document_id uuid references supplier_documents(id) on delete cascade,
  page_no int, bbox jsonb, created_at timestamptz default now()
);

-- F-AI-004：圖片資產（類型/去重/embedding）
create table product_image_assets (
  id uuid primary key default gen_random_uuid(),
  product_id text references products(id) on delete cascade,
  image_type text default 'main'
    check (image_type in ('main','detail','dimension','fabric','logo','other')),
  storage_path text not null,
  thumb_path text,
  document_id uuid references supplier_documents(id) on delete set null,
  page_no int, bbox jsonb,
  content_hash text,                 -- 去重
  created_at timestamptz default now()
);

-- F-PLT-005：向量
create extension if not exists vector;
create table search_embeddings (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,         -- product_text | product_image
  entity_id text not null,
  embedding vector(1536),            -- 維度 1536（已決議）
  model text,
  created_at timestamptz default now()
);
create index on search_embeddings using ivfflat (embedding vector_cosine_ops);

-- 設計師 D-5/D-6（另一份 PRD）＋ F-AI-008
create table product_models (
  id uuid primary key default gen_random_uuid(),
  product_id text references products(id) on delete cascade,
  model_type text not null check (model_type in ('su','3d')),
  source text not null default 'uploaded' check (source in ('uploaded','generated')),
  storage_path text, format text, thumbnail_path text,
  created_at timestamptz default now()
);
```

### 2.3 全文搜索索引（F-AI-005）
```sql
create extension if not exists pg_trgm;   -- 已啟用
alter table products add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('simple', coalesce(title,'')||' '||coalesce(model,'')||' '||coalesce(sku,'')||' '||coalesce(material,''))
  ) stored;
create index on products using gin (search_tsv);
create index on products using gin (title gin_trgm_ops);
```

### 2.4 資料權限（F-PLT-002）
- 新表：`supplier_documents`、`supplier_prices`、`extraction_items`、`processing_jobs`、`search_embeddings`、`product_image_assets`、`product_models` → **不使用 allow-all**。
- 政策模式（建議）：

```sql
-- 角色斷言（擴充既有 bwf_assert_platform_admin 模式）
create or replace function public.bwf_has_role(p_roles text[])
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from platform_user_profiles p
    where p.auth_user_id = auth.uid() and p.active and p.role = any(p_roles)
  );
$$;
```
- 成本/文件/審核表：`using (bwf_has_role(array['admin','uploader']))`；PM 讀取比較結果用欄位投影 RPC，不直接 SELECT 成本。
- 既有 allow-all 表（`products`、`bwf_quote` 等）**分階段**收緊，先在非生產驗證。

---

## 3. Worker 架構

### 3.1 選型（**已決議**：Edge 過渡 → Python Worker）
- **過渡期**：沿用 **Supabase Edge（Deno）＋ pg_cron/pg_net** 觸發，處理中小 PDF。
- **目標**：**Python Worker on Google Cloud Run Jobs**（按需執行、無長期 VPS），處理 OCR／大 PDF／表格／圖片／3D。
- **共同介面**：兩者都讀寫 `processing_jobs`，狀態一致。

### 3.2 任務模型
- 建立：前端/Edge 建 `processing_jobs`（`idempotency_key` 防重）。
- 執行：Worker `claim`（`queued→running`）→ 回報 `progress` → `succeeded/failed`。
- 重試：`attempts < max_attempts` 自動重試；指數退避。
- 取消：`cancelled`；Worker 檢查中止旗標。
- 冪等：同一 `idempotency_key` 不重複建立/寫入。
- 成本：`pages`、`ocr_pages`、`tokens`、`cost_estimate/actual`。

### 3.3 資源限制
- 並行數上限（如每類 2～4）；單任務頁數上限；超時中斷。

---

## 4. PDF 處理流程

```
上傳 PDF → supplier_documents(uploaded) → create processing_job(parse_pdf)
   ↓
[Worker] 下載原檔（私有 bucket，service role）
   ↓
逐頁分析 → 頁面分類：目錄 / 產品 / 報價表 / 條款
   ↓
分流：
  ├─ 文字型 → PyMuPDF 文字 + 表格結構
  └─ 掃描型 → OCR（**可用 Grok／xAI**）＋ VLM
   ↓
（語意分段，保護跨頁關係；非固定頁數切割）
   ↓
識別 產品 / 圖片 / 價格 關係 → LLM/VLM 生成標準化 JSON
   ↓
Schema 驗證（zod / JSON Schema）+ 價格/欄位校驗 + confidence
   ↓
低置信度/異常 → extraction_items(pending) → 人工審核 UI
   ↓
審核通過 → import_extracted_products（交易）：
  products（身份）/ supplier_prices / product_source_refs / product_image_assets
   ↓
建立 tsvector + embedding 索引
```

- **圖片**與文字/價格同步處理（F-AI-004），不後補。
- **原文保留**：PDF 永續存在 `supplier-documents`；每筆價格有 `document_id`＋`page_no`（＋bbox）。

---

## 5. 向量搜索方案（F-PLT-005 / F-AI-005/006）

- 啟用 `pgvector`；`search_embeddings` 存 text 與 image 向量（可分表或 `entity_type` 區分）。
- **文字**：`tsvector`（GIN）＋ `pg_trgm` ＋ 向量；混合排序建議 **RRF**（Reciprocal Rank Fusion）。
- **圖片**：產品圖 embedding → 以圖搜款 cosine 相似 → Top K 候選 → 再用尺寸/材質/價格/供應商過濾。
- **已決議**：維度 **1536**、供應商用 **Google text-embedding**、單表 `entity_type` 區分；embedding 產生走 Worker（批次、成本記錄）。
- 首版可**先復用 `visual-match-images`**（Gemini 評分，無需向量）作 fallback，向量上線後逐步取代。

### 5.1 搜索 RPC（建議）
```
search_furniture(q text, filters jsonb, page int, page_size int)
  → 精確/型號匹配 ∪ FTS(tsvector) ∪ 向量相似 → 混合排序 → 分頁
  → 回傳：product_id, title, model, dimensions, factory_name, price, currency,
          price_valid, source_document_id, page_no, image
```
- 回傳欄位依角色遮蔽成本（F-PLT-002）。

---

## 6. 圖片儲存方案（F-PLT-004 / F-AI-004）

- **bucket**：
  - `product-images`（現有，公開）：產品圖、報價項目圖、設計專案平面圖。
  - `supplier-documents`（**新增，私有**）：原始 PDF。
- **規則**（沿用 `CLAUDE.md`）：**base64 永不寫 DB**，一律上傳 Storage 存 URL。
- **縮圖**：沿用 `src/lib/imageThumb.ts` ＋ Supabase Image Transformations。
- **去重**：`product_image_assets.content_hash` 避免重複佔用。
- **列表查詢**：不得 `.select('*')`（`images` JSONB 過重）。

---

## 7. SKP 建模方案（F-AI-008，PoC）

- **輸入**：家具圖片／設計圖＋（可選）總寬/深/高。
- **AI**：識別結構 → 參數化 JSON（組件、尺寸、層級）。
- **幾何引擎**：由參數生成模型 → **SKP ＋ GLB**（GLB 供瀏覽器預覽）。
- **SKP 產生**：優先評估 **OpenSKP** 等可程式化方案，並並行研究 **SketchUp 官方 SDK**；**不假設 OpenSKP 能穩定生成任意複雜家具**（需先驗證 OpenSKP 商業授權）。
- **組件化**：模型盡量含可獨立編輯組件。
- **驗證**：**必須在實際 SketchUp 開啟、編輯組件、儲存**。
- **限制**：首版只承諾辦公桌/會議桌/書架/儲物櫃；沙發/椅/複雜曲面不承諾。
- **模型格式／儲存（已決議）**：格式 **skp ＋ glb**；存放**新 bucket `product-models`**（`product_models` 表 `source='generated'`）。

---

## 8. Canva 整合（F-AI-009）

- 模式：**結構化產品資料 ＋ 固定模板**（控製品質與品牌一致）。
- 流程：選產品 → 讀 `products`（名稱/圖/尺寸/材質/價，經角色遮蔽）→ AI 整理內容 → Canva Connect API 用模板生成 → 可再編輯 → 匯出 PPTX/PDF（**視 API 能力**）。
- 權限：`admin/uploader`；**未取得有效權限不得使用他人 Canva 資料**；用 OAuth token 綁定使用者。
- **已決議**：使用 **`chifung.login` 賬戶**；其實際方案／API 範圍／配額仍需在 PoC 前確認。
- 與 R5.2 專業 PDF：共用模板元素；PDF 續用 `@react-pdf/renderer`。

---

## 9. 安全與成本控制

### 9.1 安全
- **私有 Storage**：`supplier-documents` 不公開；下載用簽名 URL。
- **RLS**：新表嚴格政策；成本/文件/審核只對授權角色（F-PLT-002）。
- **審計**：上載、審核、匯入、比較、匯出留 `creator/editor_staff_id` 與時間；可擴充 `upload_log` 模式。
- **Edge secrets**（沿用現有名字）：`GEMINI_API_KEY`、`RESEND_API_KEY`、`FACTORY_SERVICE_ROLE_KEY`、`MASTER_SERVICE_ROLE_KEY`、`SUPABASE_SERVICE_ROLE_KEY`；Canva 憑證新增。
- **型別安全**：所有 SQL 用參數化；Edge 用 service role 只做必要寫入。

### 9.2 成本
- 每個任務記錄：**PDF 頁數、OCR 頁數、AI token、執行時間、成功率、預估/實際費用**（`processing_jobs`）。
- 規劃假設：5～10 名內部用戶、每月 1,000～3,000 頁；初步營運 **US$50～220/月**（**非固定報價**，不含人工審核、初次歷史導入、付費授權、超量 AI 調用）。
- 控制手段：並行上限、批次、embedding 只做一次、快取、任務成本上限告警。

### 9.3 可觀測性
- 任務儀表（狀態、失敗率、成本）；失敗可追蹤重試。

---

## 10. 部署與環境

| 組件 | 部署 | 備註 |
|---|---|---|
| 前端 | Vercel（現有） | `vercel.json` 加必要 rewrite 時注意 SPA fallback |
| Supabase | 現有專案 | 新 migration 走 `supabase/migrations` |
| Edge Functions | Supabase | slug 用 `supabase-functions-` 前綴；**部署前確認前端 invoke 的 slug**（`CLAUDE.md` 第 0 節） |
| Python Worker | **建議** Cloud Run Jobs | 按需執行、無長期 VPS |
| 3D Worker | 同上或獨立 | PoC 可本機/短時容器 |
| Cron | pg_cron＋pg_net | 沿用現有模式 |

---

## 11. 技術決議記錄

### 11.1 已決議（2026-10-19）
- **Worker 選型 = Edge 過渡 → Python Worker（Cloud Run Jobs）**，兩者共用 `processing_jobs`（C-09）。
- **成本可見性 = 僅 `admin` ＋ `uploader`**（RLS 依此設定，C-04）。
- **PDF 解析 = 單一管線＋語意分段**（C-02）。
- **搜索 = 單一 `search_furniture`（FTS＋pgvector）**（C-03）。
- **Canva 與專業 PDF 共用資料模型與模板元素**（C-07）。

### 11.2 其餘技術決議（2026-10-19）
- **AI／Embedding**：續用 Google Gemini；Embedding 用 Google text-embedding。
- **向量**：單表 `search_embeddings`（`entity_type` 區分）＋ **維度 1536**。
- **OCR**：**可用 Grok（xAI）**（VLM 為主、雲端 OCR 後備的彈性路線）。
- **審核**：由**傢俬組**負責（對應 `uploader`），支援批次。
- **產品身份鍵**：型號 ＋ 供應商。
- **Canva**：使用 **`chifung.login`** 賬戶（需確認方案／API 範圍）。
- **資料刪除**：原始 PDF 與審核記錄**可人工刪除**（限管理員，需審計）。

### 11.4 第二輪技術決議（2026-10-19）
- **pgvector 索引**：先 **ivfflat**，資料量大再轉 **hnsw**。
- **模型檔**：格式 **skp ＋ glb**；存放**新 bucket `product-models`**。
- **Canva**：**先 PoC 驗證 `chifung.login` 帳戶能力**，不足才考慮付費。
- **私有文件簽名 URL**：**短效 5 分鐘 ＋ 需登入**。
- **RLS 上線**：**先新表嚴格，既有 allow-all 表分批收緊**（每批測試）。
- **OCR**：Grok（xAI）（配合 VLM 為主、雲端後備）。
- **向量維度**：1536。

> 已無技術待確認事項；上列為執行參數。
