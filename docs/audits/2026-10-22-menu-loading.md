# FDS menu 接口載入檢查 — 2026-10-22

## 範圍與方法

- 覆蓋 navConfig.ts 的全部 **59 個二級 menu**（含 pinned 回收桶），沿用 AppShell 實際 mapping。相同 component 的 menu 分別列出。
- 本地分支 develop，HEAD `a7d1effebc952df7dd91965d849f4dfa26e21997`。檢查期間工作區有其他同步 UI 修改；本次不修改業務程式。報告 JSON 記錄交付時來源檔案 SHA256，不能當成所有量測時刻完全相同的快照。
- 真實接口目標是 `.env.local` 的 **FDS2.0 `omxizeukbcqzsnjsuwod`**，不是 Production `riaubhtruisbwdlwjzur`。只驗證這個目標，不推論 Production 同速或同錯。
- 使用既有 quick-login 帳號登入，讀回 platform_user_profiles.role=`uploader`。沒有提高權限，也沒有使用 service_role 繞過 RLS。
- 以 Vite SSR 載入現有資料模組、執行唯讀函數；個別頁面查詢按前端欄位及 filters 重播。量測含網絡、完整 response body 讀取及少量 instrumentation/模組開銷。資料量是未壓縮 response body bytes，MB 採十進位。
- 這是 API／資料鏈測試，**不是瀏覽器首屏、LCP、圖片載入或 React 渲染時間**。瀏覽器沒有既有登入 session，未逐頁點擊所有 menu。沒有觸發 AI 生成、付款、發送電郵、上傳、同步或資料清理。
- 大部分單點只測一次；報價首屏鏈測兩次。沒有足夠樣本給 p95。空結果不能證明大資料量下速度良好。admin 及客戶 token 成功路徑尚未覆蓋。

## 優先問題

1. **P1 — 報表首次載入全量掃描。** `src/lib/quoteUsageReports.ts:83`、`:143`、`:204`：fetchQuoteUsageRankings 每次平行啟動三條掃描鏈，每條逐 1000 筆取完，再於前端過濾最新版本/彙總。實測 **18.733s、15 requests、4.682MB**。影響傢俬報價「產品報告」、分析「廠家報告／報價單產品報告」、廠家「銷售表現」。factory_counts 已有 RPC，目錄 counts 僅 0.824s；不能把 counts 的改善當成排名已改善。應先核對既有 PMS/FDS 彙總能力，再把排名彙總放伺服器並保留排除回收桶及最新版本語義。
2. **P1 — 報價一覽首屏被三段串行查詢阻塞。** `QuotationListView.tsx:216`、`:233`、`:277`：40 筆 header（仍含完整 project_data）→ 同 quote_id 全部版本（含重複主頁資料）→ PMS。兩次資料鏈 **7.621s／6.693s**，約 **1.915MB**。之後 while 自動拉完全部頁，不是按需分頁。初始另測主查詢 2.693s；完整鏈測試主查詢曾達 4.837–6.000s，顯示變異，不能只歸因 PMS。建議伺服器搜尋／篩選／分頁、列表只投影必需 project_data 子欄位、版本展開才取；PMS 補全避免阻塞先顯示已有 header，且保留 live PMS 標題契約。
3. **P1 — AI 提取審核不是慢，而是接口失敗。** `src/lib/extractionReview.ts:142` 使用 `pending:extraction_items(count),total:extraction_items(count)`，真實回應 **HTTP 300**，錯誤是 supplier_documents 與 extraction_items 有多個關聯，PostgREST 無法選擇。需要明確指定正確 FK；先核對資料關聯，不新增重複接口。尚未修正。
4. **P2 — 客戶產品搜尋初始預載 1000 筆並串行補資料。** `CustomerProductSearchView.tsx:262`、`solutionsApi.ts:879`：**6.098s、7 requests、2.480MB**。付款頁同函數只取 24 筆為 0.882s。訂製頁 fetchPortalBrowseProducts(300) 也有 **3.617s、7 requests、1.444MB**。應按頁／輸入搜尋，再只補可見產品所需欄位，避免預載 body_html 等非列表必需資料。
5. **P2 — 用戶管理及登入紀錄共用過大的完整資料查詢。** `src/lib/adminApi.ts:72`、`LoginHistoryView.tsx:82`：**5.539s、3 requests**，Edge 自身 4.828s，還附帶 upload_log/products 補資料。兩頁 mount 各自重新取回 users/logs/trend，無共享結果快取。應按畫面所需讀取／共用短期快取，先核對 Edge 能否沿用既有 action，不能只平行化最後兩個輕量請求便宣稱修好。
6. **P2 — 已上載產品無伺服器分頁，整合相似先全掃。** `PublishedProductsView.tsx:952` 主列表沒有 range，單次 **2.102MB、1.105s**，之後還查成本。`SimilarProductsView.tsx:113` 先 count 再逐 500 筆掃完 **828 筆、3.116s、1.181MB** 才前端配對；此時間不含配對 CPU。異常價錢 B 類分支也會後台掃完整目錄。資料增長會放大延遲；應區分一般列表分頁和需要全量的相似分析。
7. **P2 — Shopify 上載產品紀錄存在長串資料依賴。** `src/lib/uploadLogReport.ts:703`：30 天資料鏈 **4.624s、15 requests**，其中 PMS staff resolve 約 1.994s。應先顯示紀錄／數值、後補顯示名稱，檢查既有彙總是否可重用。
8. **P2 — 共用初始化及重複 store。** `use-app-store.ts:304`、`:375`：這是每次呼叫獨立 useState/effect 的 hook，不是共用 Context store。AppShell 所有頁面都先取產品 count、100 筆 RPC（單測 0.603s / 150KB），之後 variants；即使頁面不用產品也發出請求。`ManufacturerDirectoryView.tsx:46` 又呼叫一次 hook，會再做一套初始化；DesignProjectsView 也有同模式。此為程式確認的重複載入風險，未在瀏覽器量化重複請求。應共用已初始化資料／導航狀態，或按頁面需求載入。
9. **P2 — 客戶報價方案在列表階段預載所有專案家具。** `CustomerQuoteSchemesView.tsx:1631`：fetchProjects 完成後批量載入所有專案 zones/products，用於列表 total。內部報價另取 120 筆 project_data + PMS。雖已 batch，仍是列表下載明細；應核對既有 totals 摘要能力，明細在開啟專案時載入。客戶／分享 token 路徑未實測，不能報成功時延。

## 每個 menu 對照

同一列中的時間通常是所標示的共用函數或主接口，**不是整個頁面的首屏時間**；共用 AppShell、角色查詢、sidebar badge、chunk 及圖片另計。

| Menu ID | Menu | 實際頁面 | 接口／來源 | 結果與限制 |
|---|---|---|---|---|
| `dashboard` | 主頁 | `DashboardView` | products/product_category/shopify_products/bwf_quote count + fetch-manufacturer-directory(count_factories) | 統計資料鏈 2.23s / 6 requests；最慢為報價 exact count 2.22s |
| `fds2-designer-types` | 產品類型 | `FurnitureSearchView` | fds_search_products + fds_product_search_facets | 一般搜尋 3.04s；收藏 0.68s；最新 0.41s；facets 0.43s（單接口） |
| `fds2-designer-pdf` | 產品PDF | `DesignerPdfView` | fds_designer_catalogs | 0.36s；處理中每 5 秒輪詢；本輪工作區有同步修改 |
| `fds2-designer-common` | 常用傢俬 | `FurnitureSearchView` | fds_search_products + fds_product_search_facets | 一般搜尋 3.04s；收藏 0.68s；最新 0.41s；facets 0.43s（單接口） |
| `fds2-designer-latest` | 最新產品 | `FurnitureSearchView` | fds_search_products + fds_product_search_facets | 一般搜尋 3.04s；收藏 0.68s；最新 0.41s；facets 0.43s（單接口） |
| `fds2-pm-budget` | 報價預算 | `PmBudgetView` | bwa_list_furniture_inquiries | 0.35s；目前空集合，非有資料壓測 |
| `fds2-pm-quick` | 快速報價 | `PmQuickView` | searchBwaWorks Edge + bwa_get_furniture_inquiry（有 inquiry ID 才取） | 程式追蹤；建立空表單與開啟既有詢價需分開測 |
| `fds2-pm-pro-pdf` | 專業說明 PDF (常用廠家) | `ProPdfView` | bwa_list_furniture_inquiries / bwa_get_furniture_inquiry | 列表共用 RPC 0.35s；單筆及 PDF 生成未測 |
| `fds2-pm-presentation` | 簡報生成 | `PresentationView` | client_companies + design_projects；Canva status/probe Edge；fds_list_canva_design_sessions | 客戶/工程 0.35s；status 2.25s；sessions 0.35s；probe/生成/匯出未測 |
| `fds2-cases-orders` | 訂單數據 | `CaseOrdersView` | 本地 BW_PUBLIC_CASES + 遠端圖片 | 無頁面專用 DB 接口；圖片下載及瀏覽器渲染未測 |
| `fds2-cases-photos` | 完工相片 | `CasePhotosView` | 本地 BW_PUBLIC_CASES + 遠端圖片 | 無頁面專用 DB 接口；圖片下載及瀏覽器渲染未測 |
| `fds2-cases-clients` | 知名客户 | `CaseClientsView` | 本地 BW_PUBLIC_CLIENT_MARKS + Logo 圖片 | 無頁面專用 DB 接口；圖片下載及瀏覽器渲染未測 |
| `fds2-quote-factories` | 廠家目錄 | `ManufacturerDirectoryView` | supabase-functions-fetch-manufacturer-directory | 0.99s / 365KB；另有 useAppStore 重複產品載入風險 |
| `fds2-quote-quick` | 快速報價 | `QuickQuoteView` | fetch-pms-pitchings → 選定後 fetch-pms-pitching-quote-defaults；既有 bwf_quote + items | 初始 Pitching gate 0.84s；開啟單筆/預填/圖片未測 |
| `fds2-quote-common` | 常用傢俬 | `FurnitureSearchView` | fds_search_products + fds_product_search_facets | 一般搜尋 3.04s；收藏 0.68s；最新 0.41s；facets 0.43s（單接口） |
| `fds2-quote-report` | 產品報告 | `ProductReportView` | quoteUsageReports：bwf_quote_item + products + bwf_quote 全量掃描 | 18.73s / 15 requests / 4.68MB；優先處理 |
| `fds2-quote-list` | 報價一覽 | `QuotationListView` | bwf_quote page → 同 quote_id 版本 → fetch-pms-pitchings | 首屏資料鏈 7.62s / 6.69s；約 1.91MB；後續自動掃全量 |
| `fds2-quote-large` | 大金額投標 (>$50000) | `QuotationListView` | bwf_quote page → 同 quote_id 版本 → fetch-pms-pitchings | 沿用報價一覽流程，額外 total_amount > 50000；本輪未單獨量測此 filter |
| `fds2-quote-trash` | 報價回收桶 | `QuoteTrashView` | bwf_quote status=回收桶 | 0.33–0.64s；目前 0 筆；無分頁，資料增長風險 |
| `fds2-quote-format` | 報價單格式設定 | `QuoteFormatView` | quote_format_settings | 0.34s / 153B |
| `fds2-factory-info` | 廠家資訊 | `ManufacturerDirectoryView` | supabase-functions-fetch-manufacturer-directory | 0.99s / 365KB；另有 useAppStore 重複產品載入風險 |
| `fds2-factory-upload` | 上載產品PDF | `AIProcessorView` | product_category + fetch-product-categories；supplier_documents/processing_jobs（DocumentUploader） | 供應商文件列表 0.33s；分類 0.72s；PMS 分類及檔案解析未測；操作型付費任務未觸發 |
| `fds2-factory-sales` | 銷售表現 | `FactorySalesView` | fetchQuoteUsageRankings + factory_counts ×3 | 排名共用查詢 18.73s；目錄 counts 0.82s，兩者並行；頁面完整時間未測 |
| `fds2-factory-zones` | 廠家分區 | `FactoryZonesView` | factory_zones → factory_zone_members；fetch-manufacturer-directory 並行 | 分區資料鏈 0.97s + 目錄單接口 0.99s；目前分區空集合 |
| `fds2-factory-login` | 廠家登入 | `FactoryLoginView` | supplier_logins + fetch-manufacturer-directory + fds_supplier_review_documents | 各分支 0.34s / 0.99s / 0.37s；未用 supplier 身分驗證 |
| `fds2-products-factories` | 廠家目錄 | `ManufacturerDirectoryView` | supabase-functions-fetch-manufacturer-directory | 0.99s / 365KB；另有 useAppStore 重複產品載入風險 |
| `fds2-products-quote-pdf` | 上載報價PDF | `AIProcessorView` | product_category + fetch-product-categories；supplier_documents/processing_jobs（DocumentUploader） | 供應商文件列表 0.33s；分類 0.72s；PMS 分類及檔案解析未測；操作型付費任務未觸發 |
| `fds2-products-ai-review` | AI 提取審核 | `ExtractionReviewView` | supplier_documents embed extraction_items；選文件後 items/images | 首接口 HTTP 300：關聯歧義，載入失敗；非速度問題 |
| `fds2-products-pending` | 待處理產品 | `ListedProductsView` | products range + count；product_category_counts；廠家 options；variants | 待處理首 20 筆 0.36s/24KB；目錄首 20 筆 0.36s/33KB；輔助查詢未完整量測 |
| `fds2-products-catalog` | 產品目錄 | `ListedProductsView` | products range + count；product_category_counts；廠家 options；variants | 首 20 筆主查詢 0.360s / 33KB；catalog mode；counts/options/variants 另計 |
| `fds2-publish-copy` | 產品文案 | `PublishCopywritingView` | get_publish_rts_rows/count/factories(stage=copywriting) + product_category | rows 0.43s / 41KB；count/facets 未完整量測 |
| `fds2-publish-price` | 產品價錢 | `PublishProductInfoView` | get_publish_rts_rows/count/factories(stage=product-info) + product_category | rows 0.42s / 63KB；count/facets 未完整量測 |
| `fds2-publish-check` | 傢俬組檢查 | `FurnitureGroupCheckView` | get_fg_check_rows/count + get_publish_rts_factories | rows 0.62s；空結果，非有資料性能驗證 |
| `fds2-publish-ready` | 準備上載 | `ReadyToPublishView` | get_ready_to_publish_rows/count + factories + ready_to_shopify 縮圖補查 | 預設 rows 0.39s；空結果，非有資料性能驗證 |
| `fds2-publish-done` | 已上載產品 | `PublishedProductsView` | shopify_products + products cost；B 類異常價錢另掃 products + Shopify links | 已上載主查詢 1.11s / 2.10MB，沒有 range；成本補查及異常分支完整時間未測 |
| `fds2-publish-abnormal` | 異常價錢產品 | `PublishedProductsView` | shopify_products + products cost；B 類異常價錢另掃 products + Shopify links | 程式確認 A 類沿用已上載查詢、B 類掃描 products；完整異常檢測未測 |
| `fds2-publish-similar` | 整合相似 | `SimilarProductsView` | shopify_products count → 500 筆逐頁掃描 → 前端配對 | 掃描 828 筆 3.12s / 3 requests / 1.18MB；CPU 配對未包含 |
| `fds2-report-factory` | 廠家報告 | `FactoryReportView` | quoteUsageReports 全量掃描 + factory_counts ×3 | 排名共用查詢 18.73s；目錄 counts 0.82s，兩者並行 |
| `fds2-report-product` | 報價單產品報告 | `ProductReportView` | quoteUsageReports：bwf_quote_item + products + bwf_quote 全量掃描 | 18.73s / 15 requests / 4.68MB；優先處理 |
| `fds2-report-upload-log` | Shopify 上載產品紀錄 | `UploadProductLogView` | upload_log + 歷史 products/RTS + resolve-pms-staff-by-ids + stage counts | 30 天完整資料查詢 4.62s / 15 requests；頁面渲染未測 |
| `fds2-admin-users` | 用戶管理 | `UserManagementView` | fetch-platform-admin + upload_log + products enrichment | 共用資料查詢 5.54s / 3 requests；下載用戶與登入紀錄等完整資料 |
| `fds2-admin-logins` | 登入紀錄 | `LoginHistoryView` | fetch-platform-admin + upload_log + products enrichment | 共用資料查詢 5.54s / 3 requests；與用戶管理切頁會重取，未共享快取 |
| `fds2-admin-shopify` | Shopify 分類 | `CategoryManagementView` | bwf_product_categories | 程式追蹤；沒有本輪精確同查詢量測；讀取初始化含既有清理寫入，未執行頁面流程 |
| `fds2-admin-categories` | 產品分類 | `ProductCategoryView` | product_category + PMS category sync（操作時） | category 基線讀取 0.72s；同步操作未測 |
| `fds2-admin-settings` | 系統設定 | `SettingsView` | 本地 settings / localStorage；連線測試需使用者操作 | 無頁面專用首次 DB 查詢；仍受共用 AppShell 載入影響 |
| `fds2-admin-prd` | PRD功能描述 | `PrdDescriptionsView` | 本地 prd-docs/Markdown | 無頁面專用 DB 查詢；文字渲染及 chunk 載入未測 |
| `fds2-admin-command-logs` | 每日指令記錄 | `DailyCommandLogsView` | bwf_dev_command_logs_list + bwf_dev_command_logs_analytics | 目前 uploader 身分 HTTP 403；無法驗證 admin 成功路徑 |
| `fds2-admin-dev-cost` | 開發成本 | `DevelopmentCostView` | bwf_development_cost_overview | 目前 uploader 身分 HTTP 403；無法驗證 admin 成功路徑 |
| `fds2-admin-email` | 電郵通知 | `EmailNotificationsView` | email_notification_logs limit 200 | 0.35s；目前 0 筆；發送/重發未觸發 |
| `fds2-customer-quotes` | 報價方案 | `CustomerQuoteSchemesView` | 依身分 list_customer_quotes / get_shared_quote；內部 bwf_quote limit120 + PMS；projects + 批量 zones/products | 程式追蹤；列表同時預載所有專案分區/產品；未用真實客戶及分享 token 量測 |
| `fds2-customer-search` | 產品搜尋 | `CustomerProductSearchView` | fetchActiveShopifyProducts(1000)：shopify_products → products 分批補資料 | 6.10s / 7 requests / 2.48MB；列表在客戶端篩選 |
| `fds2-customer-custom` | 傢俬訂製 | `CustomerCustomFurnitureView` | fetchPortalBrowseProducts(300)：products → Shopify matching → active products | 3.62s / 7 requests / 1.44MB；進表單就預載全部候選 |
| `fds2-customer-pay` | 付款+送貨 | `CustomerPaymentDeliveryView` | fetchActiveShopifyProducts(24) | 0.88s / 2 requests / 72KB；未執行付款 |
| `fds2-customer-orders` | 訂單狀況 | `CustomerOrderStatusView` | 本地頁面內容 | 無頁面專用資料接口；不等同實際訂單查詢已實作 |
| `fds2-customer-cases` | 成功案例 | `CustomerCaseStudiesView` | 本地 BW_PUBLIC_CASES + 遠端圖片/影片 | 無頁面專用 DB 接口；媒體載入未測 |
| `fds2-customer-services` | 服務一覽 | `CustomerServicesView` | 本地 BW_SERVICE_MODULES | 無頁面專用 DB 接口 |
| `fds2-customer-company` | 公司資料 | `CustomerCompanyInfoView` | 本地公司/品牌內容 | 無頁面專用 DB 接口 |
| `fds2-customer-contact` | 聯絡我們 | `CustomerContactView` | useClientZoneContext：fetchInvitedProjects + fetchClientCompany | 程式追蹤；即使主要展示聯絡資訊仍取客戶/邀請資料；客戶身分未測 |
| `fds2-customer-org` | 機構採購帳號 | `CustomerOrgAccountView` | useClientZoneContext：fetchInvitedProjects + fetchClientCompany | 程式追蹤；客戶身分未測；未修改機構帳戶 |

## 所有量測摘要

下表是唯讀 probe，若 HTTP error 或 empty 已註明，絕不當作成功畫面的速度。實際 request path、bytes、status 見相鄰 JSON，沒有保存 headers、token、密碼或業務原文。

| Probe | 秒 | Requests | Response MB | 結果 |
|---|---:|---:|---:|---|
| `designer-facets` | 0.429 | 1 | 0.004 | 完成；結果量/空集合限制見上表 |
| `designer-pdf` | 0.355 | 1 | 0.004 | 完成；結果量/空集合限制見上表 |
| `pm-budget` | 0.350 | 1 | 0.000 | 完成；結果量/空集合限制見上表 |
| `quote-trash` | 0.331 | 1 | 0.000 | 完成；結果量/空集合限制見上表 |
| `factory-report-counts` | 0.824 | 3 | 0.004 | 完成；結果量/空集合限制見上表 |
| `product-report-usage` | 18.733 | 15 | 4.682 | 完成；結果量/空集合限制見上表 |
| `factory-zones` | 0.966 | 2 | 0.000 | 完成；結果量/空集合限制見上表 |
| `supplier-logins` | 0.343 | 1 | 0.000 | 完成；結果量/空集合限制見上表 |
| `supplier-review` | 0.365 | 1 | 0.003 | 完成；結果量/空集合限制見上表 |
| `email-logs` | 0.352 | 1 | 0.000 | 完成；結果量/空集合限制見上表 |
| `quote-format` | 0.337 | 1 | 0.000 | 完成；結果量/空集合限制見上表 |
| `ai-review-documents` | 1.237 | 1 | 0.001 | Could not embed because more than one relationship was found for 'supplier_documents' and 'extraction_items' |
| `supplier-documents` | 0.329 | 1 | 0.002 | 完成；結果量/空集合限制見上表 |
| `development-cost` | 0.331 | 1 | 0.000 | permission_denied |
| `platform-admin` | 5.539 | 3 | 0.103 | 完成；結果量/空集合限制見上表 |
| `manufacturer-directory` | 0.990 | 1 | 0.365 | 完成；結果量/空集合限制見上表 |
| `search-browse` | 3.041 | 1 | 0.032 | 完成；結果量/空集合限制見上表 |
| `search-favorites` | 0.680 | 1 | 0.001 | 完成；結果量/空集合限制見上表 |
| `search-latest` | 0.410 | 1 | 0.000 | 完成；結果量/空集合限制見上表 |
| `shell-products` | 0.603 | 1 | 0.150 | 完成；結果量/空集合限制見上表 |
| `publish-copywriting` | 0.427 | 1 | 0.041 | 完成；結果量/空集合限制見上表 |
| `publish-product-info` | 0.420 | 1 | 0.063 | 完成；結果量/空集合限制見上表 |
| `quote-first-visible-1` | 7.621 | 3 | 1.915 | 完成；結果量/空集合限制見上表 |
| `quote-first-visible-2` | 6.693 | 3 | 1.914 | 完成；結果量/空集合限制見上表 |
| `command-logs` | 0.374 | 1 | 0.000 | permission_denied |
| `command-analytics` | 0.340 | 1 | 0.000 | permission_denied |
| `customer-custom-catalog` | 3.617 | 7 | 1.444 | 完成；結果量/空集合限制見上表 |
| `published-list` | 1.105 | 1 | 2.102 | 完成；結果量/空集合限制見上表 |
| `fg-check` | 0.620 | 1 | 0.000 | 完成；結果量/空集合限制見上表 |
| `ready-list-default` | 0.388 | 1 | 0.000 | 完成；結果量/空集合限制見上表 |
| `home-metrics` | 2.227 | 6 | 0.000 | 完成；結果量/空集合限制見上表 |
| `presentation-clients` | 0.354 | 2 | 0.001 | 完成；結果量/空集合限制見上表 |
| `canva-status` | 2.249 | 1 | 0.000 | 完成；結果量/空集合限制見上表 |
| `canva-sessions` | 0.350 | 1 | 0.006 | 完成；結果量/空集合限制見上表 |
| `upload-log-report` | 4.624 | 15 | 0.006 | 完成；結果量/空集合限制見上表 |
| `customer-search-1000` | 6.098 | 7 | 2.480 | 完成；結果量/空集合限制見上表 |
| `customer-payment-24` | 0.882 | 2 | 0.072 | 完成；結果量/空集合限制見上表 |
| `products-pending` | 0.363 | 1 | 0.024 | 完成；結果量/空集合限制見上表 |
| `products-catalog` | 0.360 | 1 | 0.033 | 完成；結果量/空集合限制見上表 |
| `quick-pitching-gate` | 0.836 | 1 | 0.029 | 完成；結果量/空集合限制見上表 |
| `similar-scan` | 3.116 | 3 | 1.181 | 完成；結果量/空集合限制見上表 |

## 未完成的驗證與建議順序

- 先修 AI 審核明確失敗，再處理報表全掃與報價首屏串行／全量預載，再處理客戶搜尋、管理頁及發布列表。
- 本次只檢查及保存報告，**沒有修復、提交、merge、migration 或部署**。既有回收桶修改和其他同步 UI 修改保留。
- Production、admin 成功路徑、真實客戶／supplier／分享 token、瀏覽器逐 menu 冷暖載入及圖片／CPU 渲染尚未驗證。不要把本報告視為 Production 監測結果。
- 後續修正用相同身分、相同目標、相同資料條件重跑至少 3 次，分開記錄首次 rows 可見、完整補資料、背景載入及取消離頁請求；不可只比空資料或 403。
