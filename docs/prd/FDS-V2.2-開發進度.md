# FDS V2.2 開發進度

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
