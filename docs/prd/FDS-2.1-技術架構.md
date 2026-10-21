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
- **大檔 PDF（2026-10-21）**：不把超過 60MB 的檔留在佇列等 Python。瀏覽器或 Windows `workers/pdf-split`（`needs_split`）把原檔拆成約 40MB 的子文件（`page_offset`），Edge 只解析分段，再合併回父文件。父文件狀態顯示 X/N 段。部署新 worker 程式後要重啟該 Windows 行程。

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
- **幾何引擎**：由參數生成組件 → **SKP ＋ GLB**。設計師 SU 下載 SKP；GLB 只供 3D 頁瀏覽器預覽。
- **SKP 產生**：**不用 OpenSKP**。幾何引擎算出組件，Windows SKP Worker 用 **SketchUp 官方 C SDK** 寫成 SKP（2026-10-20 決議）。
- **組件化**：模型盡量含可獨立編輯組件。
- **驗證**：**必須在實際 SketchUp 開啟、編輯組件、儲存**。
- **範圍（2026-10-20 修正）**：取消四類硬性限制；沙發、辦公椅及曲面家具也可提交生成。按圖面完整度與幾何能力逐件評估，無法還原時指出具體部件／缺失資料，不以類別直接拒絕。
- **模型格式／儲存（已決議）**：格式 **skp ＋ glb**；存放**新 bucket `product-models`**（`product_models` 表 `source='generated'`）。

### 7.1 實作基礎與資料契約（2026-10-20 修正）

上述為目標架構，不表示已實作。FDS 已有 `furniture_models` 及保存／列表 RPC；`product_models` 是早期草案名稱，後續先擴充既有模型資料關係，不新增重複主表。PMS 本機 `src`／`supabase` 搜尋未找到 SKP 生成實作，此結果不代表已盤點全部線上服務。

- 沿用前端實際呼叫的 `supabase-functions-generate-furniture-model` 擴充圖面分析；不用另開相同用途接口。現有圖片分析只有類型及總尺寸估算，組件仍由固定模板生成。
- `parametric` 增加 Schema／引擎版本、來源圖引用、視圖、逐參數來源與確認資料；保留既有總寬深高欄位。AI 草稿與人工修正分開保存。`estimated_axes`／`estimated` 依來源推導，不能因存在數值便清除。
- 延續 `components[].id/name/size_mm/position_mm`，補結構參數、必要層級及材質。使用受控幾何操作，擴充曲線輪廓、拉伸／旋轉及曲面／網格部件描述，按形狀選擇建模器；取消四類 enum 作為拒絕閘門。不執行 AI 輸出的程式。總尺寸、板厚、內部淨寬及間距需通過幾何約束；現有靜默 clamp 改成待確認錯誤。
- 內部 mm、X 寬／Y 深／Z 高、地面中心原點；GLB exporter 轉成米及 Y-up。測試座標轉換手性、面朝向及不對稱結構，避免左右鏡像。SKP exporter 自行轉換至寫檔器需要的單位。
- 不可變版本 hash 涵蓋來源圖、確認參數、Schema／引擎／匯出器版本；預覽、SKP 與驗證報告綁同版本。

### 7.2 SKP 寫檔器是獨立前置關卡

```text
設計圖／PDF 選頁 → AI 結構及尺寸證據 → 校驗 → 人工確認
  → 參數化幾何引擎 → 具名組件模型
      ├─ GLB exporter → 預覽
      └─ SKP writer（Windows＋SketchUp C SDK）→ 重讀驗證 → 下載
```

幾何引擎負責組件形狀／位置；writer 負責真實 SKP 格式序列化。SKP 是封閉格式，只有 [SketchUp C SDK](https://developer.trimble.com/docs/sketchup/tools/sdk/) 或 SketchUp 本體能可靠寫出，且只支援 Windows／macOS，所以 writer 不放 Edge Function 或 Linux Cloud Run，而是一台 Windows 機器上的背景 worker。

實作（2026-10-20）：`workers/skp-writer/`
- `skp_writer.cpp`：讀 Tab 分隔的組件清單（mm、Z 向上、每件最小角座標），建一個頂層家具組件，內含每個部件各自一個組件（可獨立編輯），單位設為 mm，存成 SketchUp 2020 格式。CMake 以 `-DSKETCHUP_SDK_DIR=<SDK>` 編譯，SDK DLL 隨 exe 複製。
- `worker.mjs`：以 service role 輪詢 `fds_processing_jobs_claim(['generate_skp'])`，讀 `furniture_models.parametric`，執行 `skp_writer.exe`，上傳 `product-models/generated/<model_id>/<sha256>.skp`，呼叫 `fds_skp_job_finish` 登記並完成任務；失敗走 `fds_processing_job_fail` 重試。執行：`SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node workers/skp-writer/worker.mjs`（`--once` 只跑一個）。
- 尚未驗證：本機沒有 SDK，`skp_writer.exe` 未編譯；T-802a 要在 Windows 機器下載 SDK、編譯、產出樣本並在 SketchUp 開啟、編輯組件、另存。

SketchUp Ruby 桌面擴充不採用。

### 7.3 任務、產物及權限

- 已接 `processing_jobs` 的 `generate_skp`（migration `20261020120000`）：`fds_request_skp` 建任務（本人或 admin／uploader，同一模型只有一個進行中任務），Windows worker 領取；Edge `process-jobs` 只領 `parse_pdf`，不會搶走。`fds_skp_status` 給 SU 頁輪詢。
- `product-models` bucket 已建，私有；`product_models` 表登記上載與生成的 SKP／GLB（`source=uploaded|generated`），表不開 select，只經 `fds_product_models`／`_flags`／`_register`／`_delete` RPC。上載限 admin／uploader 寫 `uploaded/<product_id>/`；`generated/` 只有 service role 能寫。下載用 5 分鐘簽名 URL。
- 模型產物區分 preview_ready、skp_pending、skp_failed、skp_ready；job 成功不等於實機驗收。寫入與重讀通過才 ready；實機驗收另記版本、操作者及結果。
- 模型版本 hash 控制冪等；先寫暫存，成功後才發布。取消／過期 worker 不可掛正式產物；失敗保留確認資料與可用 GLB。重試及參數修改不可覆蓋其他版本。
- 按完整需求 F-AI-008 驗收桌／櫃真實圖、尺寸 ≤1mm 誤差、結構一致性，以及 SketchUp 開啟、編輯、另存、重開。

---

### 7.4 上傳 SKP、生成前檢查與預覽

```text
上傳 SKP → 私有原檔／hash／版本 → SKP 驗證與讀取 → GLB 衍生預覽 → 系統 3D viewer
點擊生成 → 查明確關聯且有權存取的上傳／生成版本
  ├─ 使用既有版本 → 保存選用關聯，不執行生成
  └─ 明確重新生成 → 新版本／生成任務 → SKP＋GLB
```

- 沿用 `furniture_models`／保存與列表 RPC，擴充 `source=uploaded|generated`、原檔引用、hash、檔名、版本、預覽引用與狀態。已上傳模型不必有參數化 JSON；調整現有必填 `parametric`／kind 約束，不能虛造桌類或空模型以通過保存。既有參數模型資料維持相容。
- 沿用 `product_id` 及可對應的既有工作項關係；若缺工作項關係才補充 FDS 欄位。列表 RPC 擴充指定關聯的查詢／分頁，不能用現有最近 12 筆列表判定「沒有文件」。來源資料表與既有模型資產關係先核對，不新建重複模型主表。
- 生成前檢查與確認在昂貴 AI 呼叫之前完成；建立任務時後端再核對選用版本、權限與進行中任務。若檢查後已有新模型完成，回傳候選讓使用者重新選擇，避免競態重複生成。沿用保存明確 model/version 關聯，不複製原檔、不改來源歸屬。
- 原檔按內容 hash 去重實體儲存，但產品／工作項關聯及權限各自保留；同 hash 不代表可以跨使用者共享。重試預覽以原檔 hash＋轉換器版本作冪等鍵，產物必須綁定同一原檔版本。
- 新增 `preview_skp` handler 至既有任務體系，沿用 claim／heartbeat／complete／fail；SKP 讀取／轉換 worker 的路由需實作，不能送給只有 PDF handler 的 worker。解析不可信檔案需有資源／時間限制及檔案有效性檢查。
- **獨立可行性關卡**：上傳 SKP 沒有參數 JSON，不能沿用固定模板重建預覽。須驗證可讀入真實 SKP 的 parser／轉換通路，轉成瀏覽器可顯示的 GLB；現有 GLB exporter 只能處理自產模型，不能視為已支援 SKP 讀取。讀取 SKP 也可用同一套 SketchUp C SDK，在 Windows SKP Worker 加 `preview_skp` handler 轉 GLB（待做）。
- 原檔驗證、SKP 可用性及 preview 狀態分開保存；失敗顯示原因並可重試。簽名預覽與原檔下載皆檢查相同模型權限，GLB 衍生檔不得公開繞過原件權限。
- Viewer 支援旋轉／縮放／平移／重設視角，無載入成功的 3D 內容不顯示「可預覽」。預覽品質 PoC 包含上傳的桌、沙發／椅、曲面樣本與含材質模型，核對座標、比例、外觀；不以縮圖驗收 3D 預覽。

---

## 8. Canva 原生客戶簡報設計（F-AI-009，2026-10-20 重訂）

```text
使用者匯報內容＋圖片／素材＋設計要求（產品資料可選）
  → 可編輯內容草稿／大綱 → 使用者確認
  → Canva 原生設計通路（先 PoC 驗證）
  → Canva 設計 ID／編輯入口 → 在 Canva 修改內容及版面
  → Canva 保存／下載 PPTX → PowerPoint 可編輯驗收
```

- FDS 負責內容收集、必要的大綱整理、素材引用、授權及設計狀態；Canva 負責簡報的視覺設計。不得預先以 PptxGenJS／本機固定模板產生 PPTX 再 Design Import；舊流程不符合需求。
- 內容草稿包括原文、客戶／專案、匯報目的、關鍵重點、語言、風格、期望頁數、素材及可選產品引用。保留確認版本及資料來源；不虛構報價／事實、不輸出未授權成本。
- 沿用 `canva_connections` 與 OAuth，前端現有 slug 為 `supabase-functions-generate-canva-presentation`；依新通路調整能力，不另開重複連接服務。帳戶維持 `chifung.login`，實際授權及 scopes 需按 PoC 核實。
- PoC 必須確認適用的 API／MCP／Canva 內操作途徑，並記錄其中需要人工完成的步驟，不能把可手動完成視為已自動化。Connect 的 Design Imports 是匯入。已實作通路是 Canva AI `POST /v1/generations`（見 `docs/prd/FDS-2.1-Canva-AI生成.md`），不是品牌模板 Autofill。
- 核對來源：[Canva REST API 能力分類](https://www.canva.dev/docs/apps/rest-apis/reference/)、[Autofill 指引](https://www.canva.dev/docs/apps/rest-apis/autofill-guide/)（2026-10-20）。原生設計通路與帳戶的 PPTX 下載仍須實測，不能只憑 OAuth 成功宣稱功能完成。
- 保存內容版本、Canva design ID、編輯連結及狀態；不把 PPTX base64 當作生成輸入。重新設計建立新版本，不覆蓋 Canva 手動修改；失敗保留草稿，可重試並防重複建立。
- 編輯在 Canva 進行，PPTX 由 Canva 保存／下載；可選 API 匯出只作補充，不是必要前置。驗收須下載含最後修改的檔案，在 PowerPoint 開啟並繼續編輯。
- 專業 PDF 可共用內容／品牌資料，但由各自渲染通路處理版面；不要求 Canva 沿用 FDS 固定產品清單模板。

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
- **Canva 與專業 PDF 可共用內容／品牌資料，Canva 負責客戶簡報設計，不共用固定頁面渲染器**（C-07，2026-10-20 修正）。

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
