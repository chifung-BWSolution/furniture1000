# FDS V2.2 開發進度

## 2026-10-28 — V2.2.1 圖片流程範圍修訂

使用者確認：指定圖片自動放進 Canva 對應頁面移出本版開發及驗收清單。保留圖片選擇、示例圖、Storage 保存、Canva 素材庫上傳與對應清單；由使用者在 Canva 手動放入或替換圖片，交付前核對產品外觀。

此修訂不代表整版完成。仍需真實上傳、AI 文案、草稿還原、Canva 生成與匯出、報價 PDF 頁數比較，以及部署後驗證。這些項目尚未完成，不將自動放圖列作剩餘阻塞。

## 2026-10-27 — FDS-08 套餐計價（2026）

完成：PM 報價新增「套餐計價」，項目與平均價來自 Quick Pricing 2026 工作表。小計 = 數量 × 平均價，總額是各區小計相加。標準價錢與高品質價錢只顯示區間，不計入總額。這一頁沒有運輸或安裝加成。儲存後的單用當時的單價；管理員改基準價只影響之後新開的單。已建立客戶連結的 PDF 才帶 QR。
阻塞：尚未用已登入的管理員改一筆基準價後，核對舊單數字不變。
下一項：成功案例篩選仍等 Leo 確認 PMS 行業結構。其餘阻塞：置信度門檻、Amy 的 SKP／FBX、Asana 權限。

## 2026-10-27 — FDS-09 五段簡報

完成：簡報生成的大綱改成固定順序：封面、公司介紹、平面圖、方案、參考案例。沒有平面圖就略過該段。公司介紹存在一列共用資料，下一份簡報繼續用。參考案例從現有成功案例品牌挑選，最多 8 個。仍由 Canva 排版並下載 PPTX，沒有另做自由編輯器。
阻塞：尚未用一份真實項目走完 Canva 生成與 PowerPoint 打開。套餐公式仍未對 Google Sheet。
下一項：套餐快速報價。

## 2026-10-29 — FDS-07 夜間解析順便產縮圖（伺服器端）

使用者要求：「改成夜間解析時順便產縮圖」，即不要再讓瀏覽器為了一屏縮圖下載十幾 MB 的圖冊頁。

完成（伺服器端）：

- `supabase/functions/_shared/catalogThumbs.ts`：用 pdfium（`@hyzyla/pdfium` WASM）把頁畫成 360px JPEG（q72，一頁約 9–25 KB），存到**公開** bucket `product-images/catalog-thumbs/<document_id>/<page>.jpg`（`Cache-Control: immutable`）。抽頁交現有的 `quote-catalog-pages`（新增 service-role 呼叫；它本來就會回指定頁），不在縮圖程序裡自己載入 70–120MB 的整份 PDF。
- 新 edge function `catalog-thumbs`（slug `catalog-thumbs`，CLI 部署）：
  - `{ documentId, action: "status" }` → 已有哪些頁
  - `{ documentId, pages?, limit? }` → 補畫（前端背景叫）
  - `{}`（pg_cron 帶 `x-worker-secret`）→ 找下一份還有缺頁的圖冊，畫一批
- 夜間兩條路：
  1. **解析時**：`process-jobs`（slug `supabase-functions-process-jobs`）在 `parse_pdf` 抽字那一批之後，用 service role 背景叫 `catalog-thumbs` 畫同一批頁（`EdgeRuntime.waitUntil`，不阻塞抽字；不把 pdfium 拉進 worker 記憶體）。
  2. **補畫**：pg_cron `fds-catalog-thumbs`（上海時間 23:00–09:00，每 2 分鐘）每次畫 1 頁，覆蓋舊圖冊；92 頁約 3 小時補完。
- 前端：`src/lib/catalogPageThumbs.ts` 先探 Storage 縮圖（命中即用，`LoadingImage` 會再轉 320px webp），沒有才回退舊做法（下載整頁 PDF + pdf.js 畫 + IndexedDB），並順便叫一次背景補畫。

實測（headless Chrome、本機靜態 build、分支資料）：開圖冊附件後 **0.8 秒 5 張、2 秒 13 張全部由 Storage 載入**（0 個 data URL、0 次 `quote-catalog-pages` 請求）；同一畫面之前要 19 秒、約 20MB。

限制：Edge CPU 上限令一次呼叫只穩定畫 **1 頁**（2 頁偶爾、4 頁一定 546 `WORKER_RESOURCE_LIMIT`），所以補畫是分批慢慢做，不是一次畫完整本；分支已部署 function＋cron，**正式庫（`riaubhtruisbwdlwjzur`）未部署、未套 migration**。

## 2026-10-29 — FDS-07 圖冊附件改成縮圖選擇器（含縮圖壓縮）

使用者要求：把圖冊選擇彈窗改成三步式＋頁面縮圖，並反映「頁面縮圖載入很慢」。

完成：`QuoteCatalogPagesDialog` 重做成三步（選擇圖冊 → 選擇頁面 → 確認加入）：左邊圖冊卡（封面縮圖、年份／頁數／系列、廠家 chips、搜尋、重新整理）、中間一屏 12 張頁面縮圖＋分頁＋「第 N 頁」工具列（預覽／框選、上下半頁或左右半頁），右邊已選清單（縮圖、`整頁／上半頁／下半頁／左半／右半／框選` 標籤、排序、刪除、點縮圖預覽）。跨頁圖冊照前一條規則拆左半／右半。

縮圖效能：新增 `src/lib/catalogPageThumbs.ts` 與 `renderQuotePdfThumbnails`（`quotationPdfCanvas.ts`）。之前完全沒有縮圖管線；現在每頁由 edge 取一次抽取頁（同一頁左／右半、重複開啟都只取一次），pdf.js 以最大寬 360px 畫成 JPEG（q0.72），一頁約 9–25 KB，而整頁 PDF 是 0.3–1.3 MB。縮圖存 IndexedDB `fds-catalog-thumbs`（30 天、最多 400 張）＋記憶體；同一文件 60ms 內的多個請求合成一批（**每批 3 頁**，edge 上限 24），批次失敗會逐頁重試一次。**不做下一屏預取**（一頁 1.3 MB，背景預取只會拖慢當前這一屏）。

「會載入失敗圖片」的處理：`fetchQuoteCatalogPdf` 之前每批都重新 `getUser()`＋`getSession()`，登入狀態剛恢復或 token 剛過期時會直接失敗，縮圖就變成破圖示。現在 token 記 60 秒、401 自動換 token 重試一次；真的失敗會保留原因（`catalogThumbFailure`），對話框顯示「縮圖載入失敗：<原因>〔重試〕」，不再只出一個壞掉圖片。

驗證：`scripts/test-quote-catalog-pages.mjs` PASS（新增清單短標籤）；`tsc --noEmit`、`npm run audit:ui`、`vite build` 通過。**headless Chrome 實測**（本機靜態 build、開發分支、1600×1000、冷快取）：開啟後約 4 秒第一排 4 張、約 19 秒 12 張全部出齊，`<img>` 13 張（12 頁＋封面）、破圖 0、沒有失敗提示；點第 3 頁（跨頁）→ 已選頁面（2）＝「第 3 頁 左半」「第 3 頁 右半」。

位置（2026-10-29 使用者指示「放在報價單圖片下面」）：報價編輯器的「圖冊附件」不再放在「報價內容」上方，改為 `#quote-sec-photos`（報價單圖片）卡片底部、`QuotePhotoPages` 之後，位於「條款及付款」之前；同樣的「選擇頁面」按鈕。headless Chrome 核對四個 section 的順序：報價內容 → 費用與總價 → 報價單圖片（含圖冊附件）→ 條款及付款。

阻塞：縮圖第一次開啟仍要下載當前 12 頁的 PDF（這份圖冊一頁 1.3 MB，約 15 MB／15–20 秒），第二次起由 IndexedDB 即時。要第一次就即時，需要把縮圖預先產生好存進 Storage（新的 edge 工作，edge 端要能 rasterize PDF），未排入本輪。

## 2026-10-29 — FDS-07 跨頁圖冊按直向輸出

使用者驗收意見：「圖冊都是垂直的，不要水平放」。查開發庫的「向氏产品图册2026」：整份 PDF 每頁 1207.6 × 824.9，是左右兩個直向版面並排的跨頁，所以附錄也跟着出橫向頁。

完成：圖冊附件開啟時先讀第一頁尺寸，寬高比 > 1.15 判為跨頁；跨頁選一頁＝加入「左半」「右半」兩個直向版面（24 項上限照算），半頁按鈕改成「左半頁／右半頁」，已存舊單的整頁附件會自動換成左、右兩列。附錄合併時再按實際頁面寬高拆頁（同一頁左右半只下載一次），並依來源頁 `/Rotate` 換算裁切框、把同一 `/Rotate` 套回輸出頁；清單「預覽」改成顯示附錄裡那一張（已裁切、已轉正），不再看到整張橫向跨頁。

驗證：`scripts/test-quote-catalog-pages.mjs` PASS（新增跨頁判斷、左右半、`/Rotate` 90／180／270、舊單轉換、24 項上限）；用「向氏产品图册2026」第 8、30 頁實跑合併，整頁跨頁出 2 張 603.8 × 824.9 直向頁、左／右半各 1 張，逐頁渲染核對左右版面對應正確；`tsc --noEmit`、`npm run audit:ui` 通過；`vite build` 轉譯全部 4879 個模組後，在清空 `dist` 時因 `dist\skp-worker-review-v2\FDS-SKP-Worker-Setup.exe` 被其他程序佔用而失敗（既有環境問題，與本次改動無關）。
阻塞：仍需在瀏覽器用三份真實已授權圖冊混選整頁與局部圖驗收。真正橫向的單頁圖冊也會被當成跨頁（用寬高比判斷，沒有偵測裝訂線）。

## 2026-10-29 — FDS-07 移除來源標籤、修搜尋

完成：對外報價 PDF 的圖冊附錄不再印「頁底顯示來源」，對話框的開關與草稿／PDF 型別一併移除（舊單的舊值忽略）。圖冊搜尋改為多關鍵字（AND，含年份／版本）、每次開啟重設搜尋字、加「重新整理」；空結果會說明只列「圖冊」類型，並可在「廠家詳情 → 廠家文件」把標錯成報價單的文件改成圖冊。`fds_list_quote_catalogs` 已重新套用到 prod 與分支。
發現：分支開發庫唯一上載的 92 頁「向氏产品图册2026」被登記成 `doc_type=quote`（prod 同一份檔案是 `catalog`），所以圖冊附件一直顯示「沒有可選的圖冊」。已用 RPC 改成 `catalog`。
阻塞：仍需用三份真實 PDF 在瀏覽器驗收整頁／框選合併。

## 2026-10-27 — FDS-07 框選，並移除 FDS-05

完成：圖冊附件可在預覽上拖出範圍，也可直接加上下半頁。裁切只作用在已抽出的那一頁，輸出保持原比例，來源標籤加在框外。FDS-05 設計師產品分享已從 PRD 移除，產品搜尋與 SKP／FBX 仍在。
阻塞：開發庫沒有圖冊，尚未用三份真實 PDF 驗收整頁與框選合併。
下一項：五段 PPT，然後套餐快速報價。

## 2026-10-27 — FDS-07 圖冊整頁併入報價

完成：報價內容可選圖冊整頁（可跨多份、可不連續），順序即附件順序，可選是否在頁底標來源。報價 PDF 預覽與下載會把這些頁接在後面。只抽所選頁，不把整份圖冊的簽名網址交給 PM。框選裁剪未做。
阻塞：尚未用三份真實圖冊在已登入的報價單走完預覽。置信度數字、套餐公式、Amy 模型實檔、Leo 多行業、Asana 權限仍未確認。
下一項：框選裁剪。設計師產品分享（原 FDS-05）已從本版本移除。其後為五段 PPT、套餐快速報價。

## 2026-10-27 — FDS-04 清楚項目自動入庫

完成：解析結束後，沒有待審標記、也沒有缺型號／缺價格／顏色未對上／同年價格衝突等阻擋旗標的項目會自動通過並入庫。有待審標記的仍留在人工審核，不會變成正式產品。沒有新定一個置信度數字，沿用現有 needs_attention。
阻塞：置信度數字仍要等真實文件再定。拆檔的每一段合併進主檔後才自動入庫。
下一項：本週切片裡圖冊整頁併入報價附件；框選裁剪仍排在整頁之後。

## 2026-10-27 — FDS-03 價格年份與正式顏色

完成：同廠同型號、同年、同規格出現不同價格時，兩筆都標成衝突，搜尋不自動採用；產品詳情可指定採用哪一筆，歷史報價保留。有效價改為最新年份且未衝突的報價。抽出的顏色只映射到既有色表，對不上進審核，「訂造」不寫成新色。
阻塞：尚未用真實多年份報價單跑完解析；AI 置信度門檻、套餐公式、Amy 模型實檔、Leo 多行業、Asana 權限仍未確認。
下一項：FDS-04 高置信度入庫與低置信度審核的置信度門檻，需用真實文件再定。

## 2026-10-26

完成：第一批程式已實作夜間文件任務領取（上海時間 23:00–09:00）、上傳只保存及排隊、大檔沿用 needs_split、AI 呼叫前檢查時段及斷點暫停；未部署。時段邊界、既有分段測試、TypeScript 與 UI 稽核通過。
阻塞：尚未套用 migration／部署 worker，未用真實文件完成跨時段驗收；SKP／FBX 需 Amy 實檔確認、PMS 多行業需 Leo 確認，套餐公式與 Asana 權限仍須核實。
下一項：FDS-01 第一批整合見下方續篇；接著核對價格年份衝突及顏色映射。

## 本輪範圍與部署順序

沿用 FDS 的 supplier_documents、processing_jobs、fds_processing_jobs_claim 及 checkpoint，不改 PMS 契約。已查 PMS3.0 的 src 與 migrations，未找到對應的 parse_pdf／supplier_documents 流程。

1. 在目標環境套用 `20261026010000_fds22_document_parse_window.sql`。
2. 將 process-jobs 與其相依模組部署到既有 slug `supabase-functions-process-jobs`。
3. 發布前端；現有 cron 繼續喚醒，資料庫只在夜間允許領取 parse_pdf／needs_split。其他任務不受時段限制。
4. 驗證白天上傳不發解析請求、23:00 可領取、09:00 不再發下一次 AI 請求、下一晚從斷點恢復。已送出的外部請求允許收尾；OCR 並行請求收尾後才保存暫停狀態。

大型文件改為等待既有 Vercel 拆檔服務；部署前需確認該服務的 runtime secrets、保護繞過與排程可用，不以瀏覽器同步拆檔掩蓋服務故障。

首批只處理解析時段；下方續篇已接上文件 metadata、證書與統一入口。此批不代表 Phase 1 或 V2.2 完成；價格衝突、顏色審核、自動入庫等仍待實作。未執行真實 AI 解析、資料庫 migration、部署、commit 或 push。


## 2026-10-26 續篇 — FDS-01 文件整合

完成：沿用 FactoryCatalogPanel 及既有 metadata 欄位，加入批量／分片上傳、逐檔錯誤與重試、證書只保存；透過既有 create RPC 的 metadata overload 寫入，保留舊 signature。圖冊／報價單接到 processing_jobs；停用只計數的舊 cron，保留舊 job 歷史，補排未接到真實隊列的歷史待處理文件。任務狀態同步到文件狀態，大檔子文件繼承 metadata。移除獨立「上載報價PDF」選單、保留舊路由；修正廠家查看返回主頁及年份誤用上傳年份。原始文件仍只限 admin／uploader。
阻塞：migration 與 worker 尚未部署，沒有實際上傳或 AI 解析驗收。本機頁面顯示產品分類選項為空，已提示並停用圖冊保存，不臆造分類；需核實開發環境分類資料。Amy 模型實檔、Leo 多行業、Asana 權限及套餐公式仍未確認。
下一項：部署前核對 migration 依賴及目標環境；再做同廠同型號的年份價格衝突與正式顏色映射。Phase 1 尚未完成。

### 本輪驗證

- 完整 `npm run build` 通過（TypeScript + Vite）；UI audit 及 Impeccable detector 通過。
- PGlite 隔離 PostgreSQL 測試通過：migration 執行、保留舊 RPC overload、歷史文件補排、重複上傳不覆蓋／不重複任務、證書禁止入隊、metadata 必填、大檔 needs_split、狀態投影、子文件 metadata、未授權呼叫拒絕。
- 既有分片上傳／斷線續傳、時段邊界及 PDF 分段測試通過。
- 瀏覽器確認：廠家目錄無獨立上傳選單，查看廠家能進入 `/manufacturers/:code`，廠家文件分頁有三類文件、年份／系列／版本／分類／備註及分類缺失提示。未點保存、未上傳真實文件。
- 資料庫測試套件在暫存目錄安裝，未更改專案 package.json 或 lockfile。重跑 `scripts/test-unified-document-upload.mjs` 需安裝 `@electric-sql/pglite`，或以 `FDS_PGLITE_MODULE` 指向該套件的 `dist/index.js`。

### 部署依賴

先有 `20261026054535_supplier_catalog_documents.sql` 及 `20261026055625_supplier_price_list_documents.sql`，再套 `20261026070000_fds22_unified_document_upload.sql`。夜間領取限制還需首批 `20261026010000_fds22_document_parse_window.sql` 與 process-jobs worker。新前端使用 metadata overload，必須先套 migration 才發布。舊的 `process-supplier-catalogs` 不再由排程呼叫，不另做解析 pipeline。

本輪未變更 PMS 契約；未修改其他同時進行的模型檔案工作。未執行線上 migration、部署、commit 或 push。
