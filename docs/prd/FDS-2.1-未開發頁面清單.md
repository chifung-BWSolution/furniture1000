# FDS 2.1 未開發頁面清單

盤點日：2026-10-21  
來源：`src/components/dashboard/navConfig.ts` 的 `NAV_CONFIG`、`src/lib/appSectionRoutes.ts`、`AppShell.renderView()`。

未掛上既有頁、也沒有在 `renderView()` 另行接上的 `fds2-*` 會進 `PlannedPage`，畫面文字是「此頁面待開發」。`AppShell` 裡的 `PlaceholderView`（「即將推出 · Coming Soon」）目前沒有被任何路由呼叫。

已接上真頁、不在下表：設計師的產品類型／產品 PDF／常用傢俬／最新產品、PM 快速報價與簡報生成、報價一覽與大金額投標、廠家資訊與上載產品 PDF、產品管理與網上發布（含整合相似）、三份分析報表、系統設定裡除電郵通知以外的項目、全部客戶專區。`/fds/designer/su` 與 `/fds/designer/3d` 已不在側欄，舊網址回到產品類型。

規格第 12 節仍寫「產品類型／產品 PDF 待開發」。程式已接上，以這份清單為準。

| 路由 | 側欄名稱 | 模組 | 規格 | 需要的資料與表 | 規模 | 優先級 |
|---|---|---|---|---|---|---|
| `/fds/quote/trash` | 報價回收桶 | 傢俬報價 | FDS 2.0 R2.4；差異對照「回收桶保留並加確認」 | 現有 `bwf_quote.status`＝`回收桶`，原狀態寫進 `project_data._fdsTrash`。列表、用量統計、客戶報價方案排除此狀態。已接上，報價一覽改為移入而非永久刪除 | 小 | P0 |
| `/fds/quote/format` | 報價單格式設定 | 傢俬報價 | FDS 2.0 R1.1 QR 文案、R1.2 修訂日期、R2.2 分區小計；決議第 1、2 項 | 尚無格式設定表。版面現在散落在報價編輯器與 `quotationLocale` | 大 | P0 |
| `/fds/pm/budget` | 報價預算 | PM報價 | FDS 2.0 R5.1 預算報價／正式報價 | PMS `bwf_pitchings.estimated_income`（edge `fetch-pms-pitchings`）與 Furniture `bwf_quote` 的 `total_amount` | 中 | P1 |
| `/fds/pm/pro-pdf` | 專業說明 PDF (常用廠家) | PM報價 | FDS 2.0 R5.2 七段式；FDS 2.1 §12、決議第 16 項；F-AI-009 只共用內容 | `bwf_quote`、`bwf_quote_item`（售價，不含成本）、`bwf_quote_share_links`、報價用量裡的常用廠家、`src/content/bwCorporate.ts` 的公開案例 | 大 | P1 |
| `/fds/settings/email` | 電郵通知 | 系統設定 | FDS 2.0 R6.5；決議第 18 項。記錄時間、收件人、類型、關聯單、成功／失敗、可重發 | 尚無發送紀錄表。現有 `send-upload-log-report-email` 寄出後不落庫 | 中 | P1 |
| `/fds/cases/orders` | 訂單數據 | 成功案例 | FDS 2.0 R5.2 第 4 段、R6.3 | 沒有內部訂單表。公開工程在 `BW_PUBLIC_CASES`（名稱、地區、面積、相片） | 中 | P1 |
| `/fds/cases/photos` | 完工相片 | 成功案例 | 同上 | 同上，公開案例圖片 URL | 小 | P1 |
| `/fds/cases/clients` | 知名客户 | 成功案例 | FDS 2.0 R6.3 成功案例展示 | `bwCorporate` 的客戶 Logo 牆（公開站資料） | 小 | P1 |
| `/fds/factories/sales` | 銷售表現 | 廠家目錄 | FDS 2.0 R4.2、R6.3 | `bwf_quote_item.factory_name` 與最新報價版本（`quoteUsageReports`） | 中 | P1 |
| `/fds/factories/zones` | 廠家分區 | 廠家目錄 | FDS 2.0 R4 廠家目錄 | 沒有廠家分區表。`project_zones` 是設計專案分區，不是廠家分區 | 中 | P1 |
| `/fds/factories/login` | 廠家登入 | 廠家目錄 | FDS 2.0 R4.1；決議第 7 項 `supplier` 角色，上載先入審核 | 需新角色與廠家帳號。現有上載入口是職員的 `ai-processor` | 大 | P1 |
| `/fds/quote/report` | 產品報告 | 傢俬報價 | FDS 2.0 側欄有此項；用量口徑與分析報表「報價單產品報告」相同 | `bwf_quote_item`、`products`（`ProductReportView` 已讀這些表） | 小 | P2 |

規模：小＝接上現有查詢與一頁列表；中＝新頁加上篩選、空狀態與跨表對照；大＝新流程或新角色。優先級跟 FDS 2.0 第 6 節與 FDS 2.1 對照，不把已跳過的 T-802／T-803／Canva 驗收算進這些頁。
