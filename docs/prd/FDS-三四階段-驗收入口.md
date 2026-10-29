# FDS 第三／四階段：完成清單與驗收入口

日期：2026-10-29
環境：**FDS 2.0 分支** `omxizeukbcqzsnjsuwod`（Production 未套、未部署、前端未發布）
狀態說明：「本地／分支完成」不等於 Production 或真人驗收完成。

## 驗收進度（2026-10-29）

- ✅ **FDS-11 成功案例**：三頁、多條件交集、無結果、客戶版匯出（使用者驗收 PASS）
- ✅ **FDS-13 分區示範圖**：正式報價 → 平面圖 → 拉框 → 確認 → 生成透視圖；快速報價沒有「AI 生成」（使用者驗收 PASS；GLB 場景決定不做）
- ✅ **FDS-06 SKP／FBX**：改由 Codex 開發／驗收（使用者 2026-10-29 決定），本階段不再驗收實機
- ✅ **FDS-15 郵件**：填模板（電話必填）→ 排入發送 → 收信 → 點「加單授權連結」（使用者驗收 PASS；有效查看後停該單跟進，已排隊跟進信實測被取消）
- ✅ **FDS-14 客戶互動**：客戶分享連結提交＋報價一覽「客戶提交」面板；PM 通知實寄（使用者驗收 PASS）
- ✅ **FDS-10 設計專案分區**：多區、改名、排序、產品移區後重開（使用者驗收 PASS）

- Migration：17 支已套分支（見 `supabase/migrations/20261029*`）
- Edge Function：`send-quote-email`、`notify-customer-quote-request`、`sync-asana-factories` 已部署分支（worker-secret 模式）
- Cron：`fds-send-quote-email`（15 分鐘）、`fds-notify-customer-request`（10 分鐘）、`fds-sync-asana-factories`（每日 02:41），host 已確認指向分支
- Secrets：`FDS_EMAIL_FROM`、`RESEND_API_KEY`、`FDS_APP_URL`、`ASANA_ACCESS_TOKEN`
- 品質閘：`tsc --noEmit` 0、`npm run build` 通過、`npm run audit:ui` 0 違規

---

## A. 已完成的程式與可驗收入口

| # | 功能 | 完成內容 | 驗收入口（UI） | 驗收入口（自動） |
|---|---|---|---|---|
| 1 | **FDS-08 參考計價** | 數量／價格驗證、金額以仙一致、來源追溯、快照隔離、分享 token、PDF | 導航「PM報價 → 報價預算 → **參考報價**」分頁：選項目 → 選 QMS 報價 → 讀傢俬明細 → 匹配 2026 價目 → 儲存／客戶連結／下載 PDF | `node scripts/test-package-pricing.mjs`、`node scripts/test-package-pricing-live.mjs` |
| 2 | **FDS-07 圖冊附件** | 多圖冊、整頁／上下半頁／左半頁／右半頁／框選、排序；跨頁圖冊自動拆成左、右兩個直向頁；三步式縮圖選擇器（頁面縮圖 360px JPEG＋IndexedDB 快取）；PDF 只用圖冊頁、不印來源標籤；edge 只回抽取頁 | 報價編輯器 → 圖冊附件對話框：搜尋／廠家 chip → 點頁面縮圖加入 → 重排、拖框；跨頁圖冊點一頁會得到「左半」「右半」兩列 | `node scripts/test-quote-catalog-pages.mjs`（純邏輯） |
| 3 | **FDS-06 SKP／FBX** | 既有生成／下載流程、版本、私有儲存 | 產品搜索 → 開啟型號 → 「生成／下載 SKP」「生成／下載 FBX」 | `node scripts/test-skp-review-regressions.mjs`（PASS）；`test-skp-device-auth.mjs` 受分支殘留 queue 影響 |
| 4 | **FDS-10 設計專案分區** | 既有分區、空白區保留 | 設計專案 → 分區面板：改名、排序、刪除、產品移區 | `node scripts/test-empty-zone-prune.mjs` |
| 5 | **FDS-11 成功案例** | 三頁即時讀 PMS、篩選、權限、匯出；兩級行業已按確認關閉 | 導航「成功案例」三頁；多條件篩選 → 客戶版匯出 | `node scripts/case-showcase.test.mjs`、`node scripts/case-list-filters.test.mjs` |
| 6 | **FDS-12 Asana 唯讀同步** | link／comment 表、RPC、worker（分頁＋去重）、cron、CLI、廠家詳情頁面板 | 導航「廠家目錄」→ 開任一廠家 → **資訊** 分頁 → 「Asana 廠家同步」：貼 task gid → 綁定 → 立即同步 → 看 Comment 數／上次同步 | `node scripts/test-asana-factory-sync.mjs`、`node scripts/test-asana-factory-link-live.mjs`；CLI：`node scripts/link-asana-factory.mjs --list` |
| 7 | **FDS-13 BWF 分區示範圖** | 平面圖／24 區／框選／確認、4:3 透視圖、伺服器範圍檢查、前端隱藏按鈕 | 報價一覽 → 開正式報價 → 平面圖上傳 → 拉框／確認 → 分區圖片 → 「AI 生成」（快速報價／`DP-` 應沒有按鈕） | `node scripts/test-quote-floor-plan.mjs`、`node scripts/test-quote-zone-scope.mjs`、`node scripts/test-quote-zone-scope-live.mjs` |
| 8 | **FDS-14 客戶互動** | 提交另存（不改正式報價）、冪等、跨報價拒絕、PM 面板、狀態處理、有效查看記錄 | 客戶分享連結 `/customer?quote_share=<token>` → 選品／數量／提交；報價一覽 → 該單「**客戶提交**」按鈕 | `node scripts/test-customer-quote-request-live.mjs`、`node scripts/test-customer-quote-requests.mjs` |
| 9 | **FDS-15 郵件模板／跟進** | 三固定段＋自訂段、立即發送（即時觸發 worker）、3 天跟進、有效查看停信、掃描器排除、`confirm_send`、Resend 實寄、central log | 報價一覽 → 該單「**郵件模板與跟進**」：填電話／收件人／引言 → 儲存模板 → 立即發送 → 看發送與查看紀錄 | `test-quote-email-template.mjs`、`test-quote-email-followup-live.mjs`、`test-quote-email-staff-live.mjs`、`test-quote-email-isolation-live.mjs`、`test-quote-email-retry-live.mjs` |

## B. 快速驗收順序（建議 20 分鐘）

1. **郵件（FDS-15）**：報價一覽 → 測試單 → 郵件模板與跟進 → 收件人填你的測試信箱、電話必填 → 儲存 → 立即發送。（按鈕即時叫醒 worker，約 1 秒寄出；叫不到時留在隊列，cron 15 分鐘內補寄）
2. 收到信 → 點「加單授權連結」→ 回報我，我查 `bwf_quote_share_view` 與 `bwf_quote_email_settings` 是否 `viewed`、跟進信是否 `cancelled`。
3. **客戶提交（FDS-14）**：用同一分享連結 → 選品／改數量／填需求 → 提交 → 到報價一覽「客戶提交」看紀錄與狀態；確認正式報價金額／明細沒有被改。
4. **Asana（FDS-12）**：廠家目錄 → 廠家詳情 → Asana 面板 → 貼一個真實 task gid → 綁定 → 立即同步 → 看 Description／Comment 數；測完按「移除」。
5. **分區示範圖（FDS-13）**：正式報價 → 平面圖 → 拉框 → 確認 → 生成透視圖；再到快速報價確認沒有「AI 生成」。
6. **參考計價（FDS-08）**：PM報價 → 報價預算 → 參考報價 → 導入 → 儲存 → 改數量 → 重開；改基準價後確認舊單不變、新單用新價。
7. **圖冊（FDS-07）**：報價編輯器 → 圖冊附件 → 搜尋（可多關鍵字／年份）→ 三份圖冊混選整頁／框選 → 重排 → 下載 PDF 檢查（附錄不應有頁底來源字；跨頁圖冊每一張附錄頁都應是直向）。
8. **案例（FDS-11）**：成功案例三頁 → 多條件交集 → 無結果 → 匯出客戶版。

## C. 全部自動測試指令

```powershell
# 離線（不需要 DB）
node scripts/test-package-pricing.mjs
node scripts/test-quote-email-template.mjs
node scripts/test-asana-factory-sync.mjs
node scripts/test-quote-floor-plan.mjs
node scripts/test-quote-catalog-pages.mjs
node scripts/test-customer-quote-requests.mjs
node scripts/test-quote-zone-scope.mjs
node scripts/test-empty-zone-prune.mjs
node scripts/case-showcase.test.mjs
node scripts/case-list-filters.test.mjs

# 分支（會自建自刪測試資料；不向真實客戶／Asana 寫入）
node scripts/test-package-pricing-live.mjs
node scripts/test-customer-quote-request-live.mjs
node scripts/test-quote-email-followup-live.mjs
node scripts/test-quote-email-staff-live.mjs
node scripts/test-quote-email-isolation-live.mjs
node scripts/test-quote-email-retry-live.mjs
node scripts/test-quote-zone-scope-live.mjs
node scripts/test-asana-factory-link-live.mjs

# 品質閘
npx tsc --noEmit
npm run build
npm run audit:ui
```

## D. 驗收時的注意事項

- **測試資料**：兩張 `FDS15-SEND-TEST-*` 報價仍保留（信內連結要有效）；驗收完告知我刪除。
- **不要向真實客戶發信**：目前只用 `cfb.app02@chifung.net` 測過。
- **Asana**：目前的介面與 worker 只做唯讀同步；未經你授權不會向真實 task 發留言。
- **Production**：完全未變（11 支 migration、3 支 worker、前端都只在分支）。
- **已知限制**：`test-skp-device-auth.mjs` 因分支殘留 `preview_skp` 任務而失敗（非程式缺陷）；FDS-13 GLB 場景供應商未定，透視圖與確認流程已完成。
